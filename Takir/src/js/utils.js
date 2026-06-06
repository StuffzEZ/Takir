/* ==========================================================
   utils.js
   General helpers: Roman numerals, ids, time, escaping.
   ========================================================== */

const ROMAN_MAP = [
    { value: 10, numeral: 'X' },
    { value: 9,  numeral: 'IX' },
    { value: 5,  numeral: 'V' },
    { value: 4,  numeral: 'IV' },
    { value: 1,  numeral: 'I' },
];

export const LEVEL_TITLES = [
    null,                       // 0 - unassessed
    'Novice',                   // I
    'Apprentice',               // II
    'Initiate',                 // III
    'Adept',                    // IV
    'Journeyman',               // V
    'Veteran',                  // VI
    'Expert',                   // VII
    'Master',                   // VIII
    'Grandmaster',              // IX
    'Legend',                   // X
];

export function toRoman(level) {
    const n = Number(level);
    // NaN / non-numbers / negatives / below 1 -> em dash
    if (Number.isNaN(n) || n < 1) return '\u2014';
    // Clamp above the max (handles Infinity as well)
    if (n >= 10 || !Number.isFinite(n)) return 'X';
    let result = '';
    let rem = Math.floor(n);
    for (const { value, numeral } of ROMAN_MAP) {
        while (rem >= value) {
            result += numeral;
            rem -= value;
        }
    }
    return result;
}

export function levelLabel(level) {
    const n = Number(level);
    if (!n || n < 1 || n > 10) return 'Unassessed';
    return LEVEL_TITLES[n] || 'Unassessed';
}

export function uid(prefix = 'id') {
    const rnd = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

export function nowISO() {
    return new Date().toISOString();
}

export function formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

export function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

export function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

export function safeJSONParse(str, fallback = null) {
    if (!str || typeof str !== 'string') return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Extract the first JSON object/array found in a free-form string.
 * Used for parsing AI responses that may contain extra prose around JSON.
 */
export function extractJSON(text) {
    if (!text) return null;
    if (typeof text !== 'string') return null;

    // Try direct parse first
    try { return JSON.parse(text); } catch { /* fall through */ }

    // Find the first { ... } or [ ... ] block
    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');
    let start = -1;
    let open = '';
    let close = '';
    if (objStart === -1 && arrStart === -1) return null;
    if (objStart === -1) { start = arrStart; open = '['; close = ']'; }
    else if (arrStart === -1 || objStart < arrStart) { start = objStart; open = '{'; close = '}'; }
    else { start = arrStart; open = '['; close = ']'; }

    // Walk through and find matching close
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1);
                try { return JSON.parse(candidate); } catch { return null; }
            }
        }
    }
    return null;
}

export function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

export function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('File read error'));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

export function fileToBase64(file) {
    return fileToDataURL(file).then(d => {
        if (typeof d !== 'string') throw new Error('Bad data URL');
        const i = d.indexOf(',');
        return i >= 0 ? d.slice(i + 1) : d;
    });
}

export function isImageMime(mime = '') {
    return /^image\//.test(mime);
}

export function isVideoMime(mime = '') {
    return /^video\//.test(mime);
}

export function bytesToHuman(n) {
    if (!Number.isFinite(n)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
