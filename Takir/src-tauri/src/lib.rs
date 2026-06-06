use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
struct LoadResult {
    data: String,
    path: String,
}

const ORG_DIR: &str = "Stuf_y";
const APP_DIR: &str = "Takir";
const STATE_FILE: &str = "takir_state.json";

const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (compatible; TakirBot/1.0)";
const HTTP_TIMEOUT_SECS: u64 = 15;
const MAX_FETCH_BYTES: usize = 1_500_000; // ~1.5 MB cap so huge pages don't tank memory

/// Returns the platform-specific base directory for app data.
/// - Windows:  %APPDATA%
/// - macOS:    $HOME/Library/Application Support
/// - Linux:    $XDG_DATA_HOME or $HOME/.local/share
fn data_base_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA")
            .map_err(|_| "APPDATA environment variable is not set".to_string())?;
        Ok(PathBuf::from(appdata))
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME")
            .map_err(|_| "HOME environment variable is not set".to_string())?;
        Ok(PathBuf::from(home).join("Library").join("Application Support"))
    } else {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return Ok(PathBuf::from(xdg));
            }
        }
        let home = std::env::var("HOME")
            .map_err(|_| "HOME environment variable is not set".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("share"))
    }
}

fn get_state_dir() -> Result<PathBuf, String> {
    let dir = data_base_dir()?.join(ORG_DIR).join(APP_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

fn get_state_path() -> Result<PathBuf, String> {
    Ok(get_state_dir()?.join(STATE_FILE))
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(DEFAULT_USER_AGENT)
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .expect("reqwest client build")
}

fn normalize_base(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{}/", trimmed)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
    engine: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SearchResponse {
    query: String,
    engine_url: String,
    results: Vec<SearchResult>,
}

#[derive(Debug, Deserialize)]
struct SearxngResult {
    title: Option<String>,
    url: Option<String>,
    content: Option<String>,
    engine: Option<String>,
}

#[tauri::command]
async fn web_search(
    _app: AppHandle,
    query: String,
    searxng_url: Option<String>,
    max_results: Option<usize>,
) -> Result<SearchResponse, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("Query is empty".to_string());
    }

    // Prefer the user-supplied URL; fall back to default.
    let base = if let Some(u) = searxng_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        normalize_base(u)
    } else {
        default_searxng()
    };

    if base.is_empty() {
        return Err("No SearXNG URL configured".to_string());
    }

    let url = format!("{}search?q={}&format=json", base, urlencode(&q));
    let max = max_results.unwrap_or(8).clamp(1, 20);

    let client = http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("SearXNG request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("SearXNG returned HTTP {}", resp.status()));
    }
    let raw: Vec<SearxngResult> = resp
        .json()
        .await
        .map_err(|e| format!("Could not parse SearXNG JSON: {e}"))?;

    let results = raw
        .into_iter()
        .filter_map(|r| {
            let url = r.url?;
            if url.is_empty() {
                return None;
            }
            Some(SearchResult {
                title: r.title.unwrap_or_default().trim().to_string(),
                url,
                snippet: r.content.unwrap_or_default().trim().to_string(),
                engine: r.engine,
            })
        })
        .take(max)
        .collect();

    Ok(SearchResponse {
        query: q,
        engine_url: base,
        results,
    })
}

fn default_searxng() -> String {
    "http://141.147.118.157:8926/".to_string()
}

#[tauri::command]
async fn web_fetch(url: String, max_chars: Option<usize>) -> Result<FetchResponse, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("URL must start with http:// or https://".to_string());
    }
    let cap = max_chars.unwrap_or(20_000).clamp(500, 200_000);

    let client = http_client();
    let resp = client
        .get(&trimmed)
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Fetch returned HTTP {}", resp.status()));
    }
    let final_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Could not read response body: {e}"))?;
    let truncated = bytes.len() > MAX_FETCH_BYTES;
    let body = if content_type.contains("text/html") || content_type.is_empty() || content_type.contains("xml") {
        let html = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FETCH_BYTES)]).to_string();
        strip_html_to_text(&html, cap)
    } else {
        String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FETCH_BYTES)]).to_string()
    };

    Ok(FetchResponse {
        url: final_url,
        content_type,
        truncated,
        body,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FetchResponse {
    url: String,
    content_type: String,
    truncated: bool,
    body: String,
}

/// Very small HTML → text converter. Not perfect, but removes scripts/styles
/// and tags, then collapses whitespace. Good enough for an LLM to read.
fn strip_html_to_text(html: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(html.len() / 4);
    let bytes = html.as_bytes();
    let mut i = 0;
    let mut in_tag = false;
    let mut in_script_or_style = false;
    let mut tag_name = String::new();
    let mut last_was_space = false;

    while i < bytes.len() {
        let c = bytes[i] as char;
        if !in_tag {
            if c == '<' {
                in_tag = true;
                tag_name.clear();
            } else if in_script_or_style {
                // skip
            } else {
                if c == '&' {
                    // decode a few common entities
                    let rest = &html[i..];
                    if rest.starts_with("&amp;") { out.push('&'); i += 5; last_was_space = false; continue; }
                    if rest.starts_with("&lt;")  { out.push('<'); i += 4; last_was_space = false; continue; }
                    if rest.starts_with("&gt;")  { out.push('>'); i += 4; last_was_space = false; continue; }
                    if rest.starts_with("&quot;"){ out.push('"'); i += 6; last_was_space = false; continue; }
                    if rest.starts_with("&#39;") { out.push('\'');i += 5; last_was_space = false; continue; }
                    if rest.starts_with("&nbsp;"){ out.push(' '); i += 6; last_was_space = true;  continue; }
                }
                if c.is_whitespace() {
                    if !last_was_space { out.push(' '); last_was_space = true; }
                } else {
                    out.push(c);
                    last_was_space = false;
                }
            }
        } else {
            if c == '>' {
                in_tag = false;
                let lower = tag_name.to_lowercase();
                if lower == "script" || lower == "style" {
                    in_script_or_style = true;
                } else if in_script_or_style
                    && (lower == "/script" || lower == "/style")
                {
                    in_script_or_style = false;
                } else if !in_script_or_style
                    && (lower == "p" || lower == "/p"
                        || lower == "br" || lower == "li"
                        || lower == "h1" || lower == "h2" || lower == "h3"
                        || lower == "h4" || lower == "h5" || lower == "h6"
                        || lower == "/h1" || lower == "/h2" || lower == "/h3"
                        || lower == "/h4" || lower == "/h5" || lower == "/h6"
                        || lower == "tr" || lower == "div" || lower == "/div"
                        || lower == "section" || lower == "/section"
                        || lower == "article" || lower == "/article")
                {
                    if !last_was_space { out.push('\n'); last_was_space = true; }
                }
            } else if c.is_ascii_alphanumeric() || c == '/' {
                tag_name.push(c);
            }
        }
        i += 1;
        if out.len() >= max_chars { break; }
    }
    out.truncate(max_chars);
    out.trim().to_string()
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[tauri::command]
fn save_state(data: String) -> Result<String, String> {
    let path = get_state_path()?;
    fs::write(&path, data).map_err(|e| format!("Failed to write state file: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_state() -> Result<LoadResult, String> {
    let path = get_state_path()?;
    if !path.exists() {
        return Ok(LoadResult {
            data: String::new(),
            path: path.to_string_lossy().to_string(),
        });
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read state file: {e}"))?;
    Ok(LoadResult {
        data,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn state_path() -> Result<String, String> {
    Ok(get_state_path()?.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_state,
            load_state,
            state_path,
            web_search,
            web_fetch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
