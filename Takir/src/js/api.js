/* ==========================================================
   api.js
   Thin client over OpenRouter's chat-completions API.
   Supports text + image inputs (vision). Falls back to text
   for non-image attachments.
   ========================================================== */

import { extractJSON } from './utils.js';
import { store } from './state.js';

function isDebug() {
    try { return !!(store && store.state && store.state.aiDebug); }
    catch { return false; }
}

/**
 * Log to the console with a [Takir AI] prefix. When aiDebug is on, uses
 * console.debug (verbose, hidden by default in DevTools). When off, this
 * is a no-op. Use this for high-volume trace output (every request,
 * every step, every tool call).
 */
function debugLog(...args) {
    if (!isDebug()) return;
    try {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Takir AI]', ...args);
        } else if (typeof console !== 'undefined' && console.log) {
            console.log('[Takir AI]', ...args);
        }
    } catch { /* never let logging crash the app */ }
}

/**
 * Always-on warning. Use for things the user should see if they open the
 * console: API errors, malformed responses, parse failures, etc.
 */
function warnLog(...args) {
    try {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Takir AI]', ...args);
        }
    } catch { /* ignore */ }
}

/**
 * Always-on error. Use for unhandled exceptions in the AI flow that the
 * user might want to report.
 */
function errorLog(...args) {
    try {
        if (typeof console !== 'undefined' && console.error) {
            console.error('[Takir AI]', ...args);
        }
    } catch { /* ignore */ }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 120_000;

function trimTrailingSlash(s) { return (s || '').replace(/\/+$/, ''); }

export function isApiKeyConfigured(state) {
    return !!(state?.apiKey && state.apiKey.length >= 10);
}

function buildHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://takir.local',
        'X-Title': 'Takir',
    };
}

/* ---------------- core call ---------------- */

// Status codes that warrant an automatic retry (transient failures).
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 1200;

function isApiKeyPresent(apiKey) {
    return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function maskApiKey(apiKey) {
    if (!apiKey) return '(missing)';
    if (apiKey.length <= 8) return '****';
    return apiKey.slice(0, 4) + '…' + apiKey.slice(-4);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Parse a Retry-After header value. Supports both seconds ("3") and
 * HTTP-date ("Wed, 21 Oct 2015 07:28:00 GMT"). Returns ms or null.
 */
function parseRetryAfter(headerValue) {
    if (!headerValue) return null;
    const s = String(headerValue).trim();
    // Numeric seconds
    if (/^\d+(\.\d+)?$/.test(s)) {
        return Math.max(0, Math.round(parseFloat(s) * 1000));
    }
    // HTTP-date
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
        return Math.max(0, t - Date.now());
    }
    return null;
}

export async function chat({
    apiKey,
    model,
    messages,
    tools,           // optional array of OpenRouter tool definitions
    toolChoice,      // optional 'auto' | 'required' | 'none' | { type: 'function', function: { name } }
    temperature = 0.6,
    maxTokens = 1500,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseFormat, // optional { type: 'json_object' } if supported
    maxRetries = DEFAULT_MAX_RETRIES, // retry on 429/5xx with backoff
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    // When the primary model returns a terminal 429 (or is rate-limited
    // before we even call it), automatically fall back to this model
    // (if provided) before giving up. Defaults to the user's
    // `state.modelHint`.
    fallbackModel = null,
    // If true, never auto-fallback — fail loudly. Useful for tests and
    // for callers that want to handle rate limits themselves.
    disableAutoFallback = false,
}) {
    if (!isApiKeyPresent(apiKey)) {
        throw new Error('OpenRouter API key is not set. Open Runes (settings) to set it.');
    }
    if (!model) throw new Error('No model configured.');

    // If the primary model is currently rate-limited, skip straight to a
    // fallback. This avoids burning the retry budget on a known-bad model.
    let chosenModel = model;
    if (store && typeof store.isRateLimited === 'function' && store.isRateLimited(chosenModel)) {
        // Prefer the explicit fallback, then modelHint, then the first
        // non-rate-limited curated freeModel.
        const candidates = [];
        if (fallbackModel) candidates.push(fallbackModel);
        if (store.state && store.state.modelHint) candidates.push(store.state.modelHint);
        if (typeof store.pickFallbackModel === 'function') {
            const fromList = store.pickFallbackModel(chosenModel);
            if (fromList) candidates.push(fromList);
        }
        for (const cand of candidates) {
            if (cand && cand !== chosenModel && !store.isRateLimited(cand)) {
                warnLog(`primary model ${chosenModel} is rate-limited, switching to ${cand}`);
                chosenModel = cand;
                break;
            }
        }
    }

    // Resolve the auto-fallback target. If the caller supplied an
    // explicit fallbackModel, use that. Otherwise consult the store's
    // curated freeModels list and pick the first non-rate-limited one
    // (excluding the current model).
    let autoFallback = null;
    if (!disableAutoFallback) {
        if (fallbackModel && fallbackModel !== chosenModel && !(store && typeof store.isRateLimited === 'function' && store.isRateLimited(fallbackModel))) {
            autoFallback = fallbackModel;
        } else if (store && typeof store.pickFallbackModel === 'function') {
            autoFallback = store.pickFallbackModel(chosenModel);
        }
    }

    const body = {
        model: chosenModel,
        messages,
        temperature,
        max_tokens: maxTokens,
    };
    if (responseFormat) body.response_format = responseFormat;
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const headers = buildHeaders(apiKey);
    // Debug logging (toggle via store.state.aiDebug)
    const startedAt = Date.now();
    debugLog(`→ request to ${chosenModel}`, summarizeRequest(body));
    debugLog(`headers: Authorization=Bearer ${maskApiKey(apiKey)}, HTTP-Referer=${headers['HTTP-Referer']}`);

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);

        let res;
        try {
            res = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
        } catch (e) {
            clearTimeout(timer);
            if (e.name === 'AbortError') {
                errorLog('← request timed out', { model, timeoutMs, attempt });
                lastErr = new Error('The AI did not answer in time. Try again.');
            } else {
                errorLog('← network error', { model, message: e.message || String(e), attempt });
                lastErr = new Error(`Network error: ${e.message || e}`);
            }
            // Network errors are retryable
            if (attempt < maxRetries) {
                const wait = baseBackoffMs * Math.pow(2, attempt);
                warnLog(`← retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
                await sleep(wait);
                continue;
            }
            throw lastErr;
        }
        clearTimeout(timer);

        let payload;
        try { payload = await res.json(); } catch (parseErr) {
            warnLog('← response body is not JSON', { status: res.status, statusText: res.statusText });
        }

        if (!res.ok) {
            const msg = payload?.error?.message
                || payload?.message
                || res.statusText
                || `HTTP ${res.status}`;

            // 429 from the model — record a cooldown and (if we have one
            // configured) try the fallback model.
            if (res.status === 429 && autoFallback && attempt === maxRetries) {
                if (store && typeof store.markRateLimited === 'function') {
                    store.markRateLimited(chosenModel, 60_000);
                }
                warnLog(`← ${chosenModel} rate-limited — switching to fallback ${autoFallback}`);
                try {
                    return await chat({
                        apiKey, model: autoFallback, messages, tools, toolChoice,
                        temperature, maxTokens, timeoutMs, responseFormat,
                        maxRetries: 1, baseBackoffMs,
                        disableAutoFallback: true, // don't cascade
                    });
                } catch (fallbackErr) {
                    // Both failed — surface the original 429 with the
                    // fallback model name in the message.
                    errorLog('← fallback also failed', { primary: chosenModel, fallback: autoFallback, fallbackErr: fallbackErr.message });
                    lastErr = buildHttpError(res.status, msg + ` (fallback ${autoFallback} also failed: ${fallbackErr.message})`);
                    throw lastErr;
                }
            }

            if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
                // Honor Retry-After if the server provides it
                const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
                const backoff = retryAfterMs != null
                    ? retryAfterMs
                    : baseBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                warnLog(`← HTTP ${res.status} ${msg} — retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`, {
                    status: res.status,
                    message: msg,
                    model: chosenModel,
                    retryAfterHeader: res.headers.get('retry-after') || null,
                });
                lastErr = new Error(`OpenRouter error (${res.status}): ${msg}`);
                await sleep(backoff);
                continue;
            }

            // Non-retryable or out of attempts — log + throw with a clear
            // message tailored to the status.
            errorLog('← HTTP error', { status: res.status, message: msg, model: chosenModel, attempt });
            throw buildHttpError(res.status, msg);
        }

        const choice = payload?.choices?.[0];
        const message = choice?.message || {};
        const text = message.content ?? '';
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        // Treat "no usable content" as a transient error: no choice, OR a
        // choice with no text and no tool calls. Free models sometimes
        // return an empty choice on 200; retrying usually fixes it.
        const isEmpty = !text && toolCalls.length === 0;
        if (isEmpty) {
            const hint = payload?.error ? ` (${payload.error.message || 'unknown error'})` : '';
            errorLog('← empty response', { model, attempt, payload: safePayloadForLog(payload) });
            if (attempt < maxRetries) {
                const wait = baseBackoffMs * Math.pow(2, attempt);
                warnLog(`← empty response — retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
                lastErr = new Error(`The AI returned an empty response${hint}.`);
                await sleep(wait);
                continue;
            }
            throw lastErr || new Error(`The AI returned no response${hint}. Check your model name and try again.`);
        }

        const elapsedMs = Date.now() - startedAt;
        debugLog(`← response in ${elapsedMs}ms${attempt > 0 ? ` (after ${attempt} retries)` : ''}`, {
            model: payload?.model || chosenModel,
            textLength: text.length,
            toolCallCount: toolCalls.length,
            usage: payload?.usage,
            finishReason: choice?.finish_reason,
            textPreview: text.length > 200 ? text.slice(0, 200) + '…' : text,
        });
        return { text, toolCalls, raw: payload };
    }

    // Loop exhausted — surface the last error
    throw lastErr || new Error('The AI request failed after multiple retries.');
}

/**
 * Build a user-friendly Error for a given HTTP status. Distinguishes
 * 401/403 (auth), 404 (bad model), 429 (rate limit), and others.
 */
function buildHttpError(status, msg) {
    if (status === 401 || status === 403) {
        return new Error(
            `OpenRouter rejected your API key (${status}): ${msg}. ` +
            `Check Settings → API Key.`
        );
    }
    if (status === 404) {
        return new Error(
            `OpenRouter error (404): model not found (${msg}). ` +
            `Check Settings → Model.`
        );
    }
    if (status === 429) {
        return new Error(
            `OpenRouter rate limit hit (429): ${msg}. ` +
            `Free models are shared across all users and frequently throttle. ` +
            `Wait a minute, switch to a different model in Settings → Model, ` +
            `or upgrade your OpenRouter plan.`
        );
    }
    if (status >= 500) {
        return new Error(
            `OpenRouter server error (${status}): ${msg}. ` +
            `The provider is having trouble. Try again in a moment, or switch models.`
        );
    }
    return new Error(`OpenRouter error (${status}): ${msg}`);
}

/**
 * Strip image data from a request body for logging. Keeps the structure
 * intact but replaces image_url payloads with a short marker so the dev
 * console doesn't get flooded with base64.
 */
function summarizeRequest(body) {
    try {
        const clone = { ...body };
        if (Array.isArray(clone.messages)) {
            clone.messages = clone.messages.map(m => {
                if (Array.isArray(m.content)) {
                    return {
                        ...m,
                        content: m.content.map(c => {
                            if (c && c.type === 'image_url') {
                                return { ...c, image_url: { url: '[image data omitted]' } };
                            }
                            return c;
                        }),
                    };
                }
                // If content is a long string, truncate for readability
                if (typeof m.content === 'string' && m.content.length > 400) {
                    return { ...m, content: m.content.slice(0, 400) + '…' };
                }
                return m;
            });
        }
        if (Array.isArray(clone.tools)) {
            clone.tools = `[${clone.tools.length} tool definitions]`;
        }
        return clone;
    } catch (e) {
        return '[unserializable request]';
    }
}

function safePayloadForLog(payload) {
    try {
        const s = JSON.stringify(payload);
        return s.length > 1000 ? s.slice(0, 1000) + '…' : s;
    } catch {
        return '[unserializable payload]';
    }
}

/* ---------------- content helpers ---------------- */

/**
 * Build a user message that can include both text and image attachments.
 * Attachments is an array of { type: 'image' | 'video' | 'file', dataUrl, mime, name }
 * OpenRouter/vision models support image_url content parts.
 */
export function buildUserMessage(text, attachments = []) {
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    for (const a of attachments || []) {
        if (!a || !a.dataUrl) continue;
        if (a.type === 'image') {
            parts.push({
                type: 'image_url',
                image_url: { url: a.dataUrl },
            });
        } else if (a.type === 'video') {
            // Most chat models don't accept video directly; convert to a note.
            parts.push({
                type: 'text',
                text: `[Video attached: ${a.name || 'untitled'} (${a.mime || 'video'}). The model can analyze the description only.]`,
            });
        } else {
            parts.push({
                type: 'text',
                text: `[File attached: ${a.name || 'untitled'} (${a.mime || 'file'}).]`,
            });
        }
    }
    return { role: 'user', content: parts };
}

export function textMessage(text) {
    return { role: 'user', content: text };
}

export function systemMessage(text) {
    return { role: 'system', content: text };
}

/* ---------------- domain prompts ---------------- */

const SKILL_QUIZ_SYSTEM = `You are an assessment designer. Your job is to assess someone's skill in a given area by producing a 10-question quiz that ranges from very easy to extremely difficult, so the level of mastery can be measured on a scale of I (Novice) to X (Legend).

Rules:
- Questions must be appropriate for the skill topic.
- Mix question types: multiple-choice, free-text, and image-based where useful.
- For "image" type questions: the user will attach images and/or videos from their device to the question. YOU DO NOT generate, depict, or render any image. In the "imagePrompt" field, just give a short note that tells the user what to attach (e.g. "Attach a photo of your finished work" or "Attach a short clip of you performing the task"). The actual image/video comes from the user at answer time, not from you.
- Difficulty must ascend across the questions; rate each from 1 (easiest) to 10 (hardest).
- Each question must include a "correctAnswer" string (the option letter for multiple-choice, the canonical text for free-response). Include an "explanation" and a "keyPoints" array of grading notes for free-response.
- For multiple-choice, provide exactly 4 distinct options labeled "A", "B", "C", "D".
- Output ONLY valid JSON matching the schema, with no prose before or after.`;

const SKILL_QUIZ_SCHEMA = `{
  "title": "string - the assessment name",
  "questions": [
    {
      "id": "q1",
      "type": "multiple-choice" | "free-text" | "image",
      "question": "string",
      "options": ["A: ...", "B: ...", "C: ...", "D: ..."],   // omit for non-MCQ
      "correctAnswer": "string",
      "explanation": "string",
      "keyPoints": ["..."],                                 // for free-text grading
      "imagePrompt": "string",                              // for image questions
      "difficulty": 1
    }
  ]
}`;

export async function generateSkillQuiz({ apiKey, model, skillName, description, attachments }) {
    const userText = `Create an assessment quiz for the skill: "${skillName}".
Description: ${description || '(none)'}

Use extra context from any attached materials when relevant.

Return JSON exactly matching this schema:
${SKILL_QUIZ_SCHEMA}`;

    const messages = [
        systemMessage(SKILL_QUIZ_SYSTEM),
        buildUserMessage(userText, attachments),
    ];

    // Force JSON mode when the model supports it. Free models like the
    // Gemma defaults are notoriously sloppy with prose, code fences, and
    // trailing commas — `response_format: json_object` makes the model
    // commit to a top-level JSON object.
    const { text } = await chat({
        apiKey, model, messages,
        temperature: 0.5, maxTokens: 2400,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    return parseQuizResponse(text, { context: 'quiz', skillName });
}

function parseQuizResponse(text, { context = 'response', skillName = '' } = {}) {
    const cleaned = stripMarkdownFences(text);
    const json = extractJSON(cleaned);
    if (!json || !Array.isArray(json.questions)) {
        // The single most common cause of "quiz not working" is the model
        // returning prose / markdown / truncated JSON. Log the raw text
        // (always, regardless of aiDebug) so the user can see exactly
        // what the model said, and throw an error that includes a hint
        // about the likely cause.
        errorLog(`← ${context} parse failed`, {
            skillName,
            textLength: (text || '').length,
            cleanedLength: (cleaned || '').length,
            rawPreview: previewForLog(text),
            cleanedPreview: previewForLog(cleaned),
        });
        const reason = !json
            ? 'no JSON object could be extracted'
            : `"questions" is not an array (got ${typeof json.questions})`;
        throw new Error(
            `The AI did not return a valid quiz (${reason}). ` +
            `The raw response was logged to the console as "[Takir AI] ${context} parse failed". ` +
            `Try regenerating, or switch to a more capable model in Settings → Model.`
        );
    }
    if (json.questions.length === 0) {
        throw new Error('The AI returned a quiz with zero questions. Please try again.');
    }
    // Coerce difficulty to 1..10 on each question (some models are sloppy)
    for (const q of json.questions) {
        if (q && typeof q === 'object') {
            if (typeof q.difficulty !== 'number' || !Number.isFinite(q.difficulty)) {
                q.difficulty = 5;
            } else {
                q.difficulty = Math.max(1, Math.min(10, Math.round(q.difficulty)));
            }
        }
    }
    return json;
}

function previewForLog(text) {
    if (!text) return '';
    const s = String(text);
    return s.length > 800 ? s.slice(0, 800) + '…' : s;
}

/**
 * Remove leading/trailing Markdown code fences (```json ... ``` or
 * ``` ... ```) and language hints. Models often wrap JSON in these even
 * when told to output plain JSON, and the inner braces confuse simple
 * JSON.find implementations.
 */
export function stripMarkdownFences(text) {
    if (typeof text !== 'string') return text;
    let s = text.trim();
    // Strip a leading ``` or ```json line
    s = s.replace(/^\s*```(?:json|JSON|javascript|js)?\s*\n/i, '');
    // Strip a trailing ```
    s = s.replace(/\n```\s*$/i, '');
    return s.trim();
}

const SKILL_SCORE_SYSTEM = `You are a quiz evaluator. Evaluate each answer for correctness and depth, considering difficulty weighting. Output ONLY valid JSON.`;

export async function scoreSkillQuiz({ apiKey, model, skillName, quiz, answers }) {
    const prompt = `Skill: "${skillName}"
Score the following answers and determine a final level from 1 to 10.

Quiz:
${JSON.stringify(quiz, null, 2)}

Answers (in order of question id):
${JSON.stringify(answers, null, 2)}

Return JSON of the form:
{
  "perQuestion": [
    { "id": "q1", "score": 0.0, "maxScore": 1.0, "isCorrect": true, "feedback": "string" }
  ],
  "totalScore": 0.0,
  "maxTotal": 10.0,
  "level": 5,            // integer 1-10
  "reasoning": "string", // 1-3 sentences
  "strengths": ["..."],
  "weaknesses": ["..."]
}`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(SKILL_SCORE_SYSTEM), textMessage(prompt)],
        temperature: 0.3, maxTokens: 1500,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    const json = extractJSON(stripMarkdownFences(text));
    if (!json || typeof json.level !== 'number') {
        errorLog('← quiz-score parse failed', { skillName, rawPreview: previewForLog(text) });
        throw new Error('The AI did not return a valid score. Please try again.');
    }
    return json;
}

const TASK_ANALYZE_SYSTEM = `You are a planning assistant. Analyze the given task and recommend the skills, subtasks, and prerequisite tasks required. Output ONLY valid JSON.`;

export async function analyzeTask({ apiKey, model, taskName, description, skills }) {
    const skillsList = skills
        .map(s => ({ id: s.id, name: s.name, level: s.level }))
        .map(s => `  - id: ${s.id}, name: "${s.name}", currentLevel: ${s.level}`)
        .join('\n');

    const prompt = `Analyze this task: "${taskName}"
Description: ${description || '(none)'}

Known skills (with current assessed level, 0 = unassessed):
${skillsList || '  (none yet)'}

Determine:
1. requiredSkills: which skills (by id from the list above, or by proposed name if not present) and minimum level (1-10) needed. Use the existing id when the skill exists.
2. subtasks: smaller pieces of the same task (each with name and 1-2 sentence description).
3. prerequisites: any prerequisite tasks (each with name and 1-2 sentence description) that should be completed first.
4. difficulty: 1 (trivial) to 10 (legendary).
5. reasoning: 1-3 sentences explaining the suggestion.

Return JSON of the form:
{
  "requiredSkills": [
    { "name": "string", "level": 1, "existingId": "string|null" }
  ],
  "subtasks": [
    { "name": "string", "description": "string" }
  ],
  "prerequisites": [
    { "name": "string", "description": "string" }
  ],
  "difficulty": 5,
  "reasoning": "string"
}`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(TASK_ANALYZE_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1800,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    const json = extractJSON(stripMarkdownFences(text));
    if (!json) {
        errorLog('← task-analyze parse failed', { taskName, rawPreview: previewForLog(text) });
        throw new Error('The AI did not return a valid task analysis. Please try again.');
    }
    return json;
}

/* ---------------- unsaved-item suggestions ----------------
   Used by the add-skill and add-task modals to auto-suggest
   prerequisites BEFORE the item is created.
*/

const SKILL_PREREQ_SYSTEM = `You are a learning designer. Given a new skill the user wants to track, suggest the prerequisite skills someone would need first, with a target level (1-10) for each. Consider only the skill domain itself, not the user's existing skills. Output ONLY valid JSON.`;

export async function suggestSkillPrerequisites({ apiKey, model, skillName, description, existingSkills }) {
    const skillsList = existingSkills
        .map(s => `  - id: ${s.id}, name: "${s.name}", currentLevel: ${s.level || 0}`)
        .join('\n');
    const prompt = `Suggest prerequisite skills for this new skill: "${skillName}"
Description: ${description || '(none)'}

Existing skills in the user's Takir (for reference, so you can match by id when the prereq already exists):
${skillsList || '  (none)'}

Return JSON of the form:
{
  "suggested": [
    { "name": "string", "level": 1, "existingId": "string|null", "reason": "1 short sentence" }
  ],
  "reasoning": "1-2 sentences overall"
}
Use existingId when the prerequisite is already in the user's list. Only include real, defensible prerequisites.`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(SKILL_PREREQ_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1200,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    const json = extractJSON(stripMarkdownFences(text));
    if (!json || !Array.isArray(json.suggested)) {
        errorLog('← skill-prereq parse failed', { skillName, rawPreview: previewForLog(text) });
        throw new Error('The AI did not return valid skill suggestions. Please try again.');
    }
    return json;
}

const TASK_PLAN_SYSTEM = `You are a project planner. Given a new quest/task, suggest the required skills (with target levels), subtasks, and prerequisite tasks. Consider only the quest itself, not the user's existing data. Output ONLY valid JSON.`;

export async function suggestTaskPlan({ apiKey, model, taskName, description, existingSkills, existingTasks }) {
    const skillsList = existingSkills
        .map(s => `  - skill id: ${s.id}, name: "${s.name}", currentLevel: ${s.level || 0}`)
        .join('\n');
    const tasksList = existingTasks
        .map(t => `  - task id: ${t.id}, title: "${t.title || t.name}"`)
        .join('\n');
    const prompt = `Suggest a plan for this new quest: "${taskName}"
Description: ${description || '(none)'}

Existing skills (for reference, match by id when possible):
${skillsList || '  (none)'}

Existing tasks (for reference):
${tasksList || '  (none)'}

Return JSON of the form:
{
  "requiredSkills": [
    { "name": "string", "level": 1, "existingId": "string|null", "reason": "1 short sentence" }
  ],
  "subtasks": [
    { "name": "string", "description": "string" }
  ],
  "prerequisites": [
    { "name": "string", "description": "string" }
  ],
  "difficulty": 5,
  "reasoning": "1-2 sentences"
}
Use existingId when the skill already exists. Only include real, defensible suggestions.`;

    const { text } = await chat({
        apiKey, model,
        messages: [systemMessage(TASK_PLAN_SYSTEM), textMessage(prompt)],
        temperature: 0.5, maxTokens: 1800,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    const json = extractJSON(stripMarkdownFences(text));
    if (!json) {
        errorLog('← task-plan parse failed', { taskName, rawPreview: previewForLog(text) });
        throw new Error('The AI did not return a valid quest plan. Please try again.');
    }
    return json;
}

const PROGRESS_REVIEW_SYSTEM = `You are a thoughtful coach. The user is sharing progress on a quest (text, image, or video). Give concrete, encouraging feedback in plain language.

Cover:
- what is going well
- what looks off or could be improved
- concrete next steps (1-3 bullets)
- an honest readiness verdict: "on track", "needs more work", or "ready to mark complete"

Output ONLY valid JSON.`;

export async function reviewProgress({ apiKey, model, taskName, taskDescription, progressText, attachment }) {
    const parts = [];
    if (progressText) parts.push({ type: 'text', text: progressText });
    if (attachment && attachment.dataUrl) {
        if (attachment.type === 'image') {
            parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
        } else if (attachment.type === 'video') {
            parts.push({ type: 'text', text: `[Video attached: ${attachment.name || 'untitled'}. The model can analyze the description and any frames implied by your text only.]` });
        }
    }

    const userText = `Quest: "${taskName}"
Description: ${taskDescription || '(none)'}

The user has submitted this progress update${attachment ? ` (with a ${attachment.type} attached)` : ''}:

${progressText || '(no text provided)'}

Give your feedback as JSON of the form:
{
  "verdict": "on track" | "needs more work" | "ready to mark complete",
  "whatIsWorking": "1-3 sentences",
  "whatToImprove": "1-3 sentences, or empty string if none",
  "nextSteps": ["...", "...", "..."],
  "encouragement": "1 short sentence"
}`;

    const messages = [
        systemMessage(PROGRESS_REVIEW_SYSTEM),
        { role: 'user', content: parts.length ? [...parts, { type: 'text', text: userText }] : userText },
    ];

    const { text } = await chat({
        apiKey, model, messages,
        temperature: 0.5, maxTokens: 1200,
        responseFormat: { type: 'json_object' },
        fallbackModel: store.state.modelHint,
    });
    const json = extractJSON(stripMarkdownFences(text));
    if (!json || !json.verdict) {
        errorLog('← progress-review parse failed', { taskName, rawPreview: previewForLog(text) });
        throw new Error('The AI did not return a valid progress review. Please try again.');
    }
    return json;
}
