/* ==========================================================
   io.js
   Data import / export for Takir (.takir JSON files).
   ========================================================== */

import { store } from './state.js';

export const TAKIR_FORMAT = 'takir';
export const TAKIR_VERSION = 1;
const FIELDS_TO_SANITIZE = ['apiKey'];

function sanitize(state, includeApiKey) {
    const out = JSON.parse(JSON.stringify(state));
    if (!includeApiKey) {
        for (const k of FIELDS_TO_SANITIZE) {
            if (k in out) out[k] = '';
        }
    }
    return out;
}

export function buildExportData({ includeApiKey = false } = {}) {
    return {
        format: TAKIR_FORMAT,
        version: TAKIR_VERSION,
        exportedAt: new Date().toISOString(),
        data: sanitize(store.state, includeApiKey),
    };
}

export function exportToJsonString({ includeApiKey = false } = {}) {
    return JSON.stringify(buildExportData({ includeApiKey }), null, 2);
}

export function downloadAsFile(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }
}

export function exportToFile({ includeApiKey = false } = {}) {
    const json = exportToJsonString({ includeApiKey });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadAsFile(json, `takir-${stamp}.takir`);
}

export function validateImportPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'File is not a valid JSON object.' };
    }
    if (payload.format !== TAKIR_FORMAT) {
        return { ok: false, error: `Unsupported format: "${payload.format || '(missing)'}". Expected "${TAKIR_FORMAT}".` };
    }
    if (typeof payload.version !== 'number' || payload.version < 1) {
        return { ok: false, error: `Unsupported version: ${payload.version}.` };
    }
    if (!payload.data || typeof payload.data !== 'object') {
        return { ok: false, error: 'Missing "data" object.' };
    }
    return { ok: true, data: payload.data };
}

export function applyImportedData(incoming) {
    const base = {
        skills: {},
        tasks: {},
        memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
        activeTab: 'skills',
        searchQuery: '',
        apiKey: '',
        model: '',
        modelHint: '',
    };
    const inSkills = (incoming && Array.isArray(incoming.skills))
        ? Object.fromEntries(incoming.skills.filter(s => s && s.id).map(s => [s.id, s]))
        : (incoming && typeof incoming.skills === 'object' && incoming.skills) ? incoming.skills : {};
    const inTasks = (incoming && Array.isArray(incoming.tasks))
        ? Object.fromEntries(incoming.tasks.filter(t => t && t.id).map(t => [t.id, t]))
        : (incoming && typeof incoming.tasks === 'object' && incoming.tasks) ? incoming.tasks : {};
    const counters = (incoming && incoming.counters && typeof incoming.counters === 'object')
        ? {
            nextSkillSeq: Number(incoming.counters.nextSkillSeq) || 1,
            nextTaskSeq: Number(incoming.counters.nextTaskSeq) || 1,
        }
        : { nextSkillSeq: 1, nextTaskSeq: 1 };
    const merged = {
        ...base,
        ...(incoming || {}),
        skills: inSkills,
        tasks: inTasks,
        counters,
        memory: {
            facts: { ...((incoming && incoming.memory && incoming.memory.facts) || {}) },
            notes: (incoming && incoming.memory && incoming.memory.notes) || '',
            pinned: {
                skills: Array.isArray(incoming && incoming.memory && incoming.memory.pinned && incoming.memory.pinned.skills)
                    ? incoming.memory.pinned.skills : [],
                tasks: Array.isArray(incoming && incoming.memory && incoming.memory.pinned && incoming.memory.pinned.tasks)
                    ? incoming.memory.pinned.tasks : [],
            },
        },
    };
    store.state = merged;
    store.notify({ type: 'change' });
}

export function readFileAsJson(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('No file provided.'));
            return;
        }
        // Prefer modern async API (Node 18+, modern browsers).
        if (typeof file.text === 'function') {
            file.text()
                .then((txt) => {
                    try { resolve(JSON.parse(txt)); }
                    catch (e) { reject(new Error(`File is not valid JSON: ${e.message}`)); }
                })
                .catch(() => reject(new Error('Could not read the file.')));
            return;
        }
        // Fallback for older runtimes.
        if (typeof FileReader === 'undefined') {
            reject(new Error('FileReader is not available in this environment.'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(JSON.parse(String(reader.result || '')));
            } catch (e) {
                reject(new Error(`File is not valid JSON: ${e.message}`));
            }
        };
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsText(file);
    });
}

export async function importFromFile(file, { clearAiHistory = true } = {}) {
    const payload = await readFileAsJson(file);
    const check = validateImportPayload(payload);
    if (!check.ok) throw new Error(check.error);
    applyImportedData(check.data);
    if (clearAiHistory) {
        // Wipe in-memory AI/Learn history so a fresh imported dataset
        // doesn't reference chat context from a previous life. The next
        // persist() will rewrite the file store.
        store.clearAiHistory();
        store.clearLearnHistory();
    }
    return { ok: true, exportedAt: payload.exportedAt || null };
}
