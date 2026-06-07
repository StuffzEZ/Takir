/* ==========================================================
   views/settings.js
   Settings modal: API key, model, data path, import/export, clear.
   ========================================================== */

import { el, openModal, closeModal, confirmDialog, success, error } from '../ui.js';
import { store } from '../state.js';
import { isApiKeyConfigured } from '../api.js';
import { exportToFile, importFromFile } from '../io.js';
import { startTour } from './tour.js';
import { openBugReport } from './bug-report.js';
import { maybeShowOnboarding } from './onboarding.js';

function hasTauriInvoke() {
    return typeof window !== 'undefined'
        && !!window.__TAURI__
        && !!window.__TAURI__.core
        && typeof window.__TAURI__.core.invoke === 'function';
}

async function exportDataFlow(includeApiKey) {
    try {
        exportToFile({ includeApiKey });
        success(includeApiKey ? 'Exported (with API key).' : 'Exported.');
    } catch (e) {
        error(e.message);
    }
}

async function importDataFlow(fileInput) {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
        const res = await importFromFile(f, { clearAiHistory: true });
        success(`Imported${res.exportedAt ? ' from ' + new Date(res.exportedAt).toLocaleString() : ''}.`);
        closeModal();
    } catch (e) {
        error(e.message);
    } finally {
        try { fileInput.value = ''; } catch { /* ignore */ }
    }
}

export function openSettings() {
    const state = store.state;

    const apiInput = el('input', {
        class: 'form-input',
        type: 'password',
        placeholder: 'sk-or-...',
        autocomplete: 'off',
    });
    apiInput.value = state.apiKey || '';

    const modelInput = el('input', {
        class: 'form-input',
        type: 'text',
        placeholder: 'google/gemma-4-31b-it:free',
    });
    modelInput.value = state.model || '';

    // Free-model picker — lets the user switch with one click when the
    // default gets rate-limited. Synced with `state.model` and the index
    // in `state.freeModelIndex`.
    const modelSelect = el('select', { class: 'form-select', id: 'settings-model-select' });
    function rebuildModelSelect() {
        while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
        const list = store.getFreeModels();
        list.forEach((m, idx) => {
            const opt = el('option', { value: String(idx) }, `${m.label} — ${m.id}`);
            opt.title = m.note || m.id;
            modelSelect.appendChild(opt);
        });
        // Custom option
        const custom = el('option', { value: '-1' }, 'Custom…');
        modelSelect.appendChild(custom);
        // Pick the right option based on current state
        const idx = (typeof state.freeModelIndex === 'number' && state.freeModelIndex >= 0)
            ? state.freeModelIndex
            : -1;
        modelSelect.value = String(idx);
    }
    rebuildModelSelect();
    modelSelect.addEventListener('change', () => {
        const v = modelSelect.value;
        if (v === '-1') {
            // Custom — focus the text input
            modelInput.focus();
            return;
        }
        const idx = parseInt(v, 10);
        if (Number.isInteger(idx)) {
            store.setFreeModelIndex(idx);
        }
    });
    // When the user types a custom model name, mark as custom (index -1)
    modelInput.addEventListener('input', () => {
        if (Array.isArray(state.freeModels)) {
            const idx = state.freeModels.findIndex(m => m && m.id === modelInput.value.trim());
            state.freeModelIndex = idx >= 0 ? idx : -1;
            modelSelect.value = String(state.freeModelIndex);
        }
    });

    const searxngInput = el('input', {
        class: 'form-input',
        type: 'text',
        placeholder: 'http://141.147.118.157:8926/',
    });
    searxngInput.value = state.searxngUrl || '';

    const pathDisplay = el('p', { class: 'form-hint mono', style: 'word-break:break-all;' }, 'Resolving\u2026');
    if (hasTauriInvoke()) {
        try {
            const invokePromise = window.__TAURI__.core.invoke('state_path');
            invokePromise
                .then(p => { pathDisplay.textContent = p; })
                .catch(() => { pathDisplay.textContent = '(unavailable)'; });
            invokePromise.catch(() => {});
        } catch {
            pathDisplay.textContent = '(unavailable)';
        }
    } else {
        pathDisplay.textContent = '(Tauri runtime not available)';
    }

    const status = el('p', { class: 'form-hint' }, 'Your key is stored locally on this device. Get one at openrouter.ai.');

    // Import/Export controls
    const includeKeyCheckbox = el('input', { type: 'checkbox', id: 'export-include-key' });
    const includeKeyLabel = el('label', { class: 'form-hint', style: 'display:flex;align-items:center;gap:6px;margin:6px 0 0;' }, [
        includeKeyCheckbox,
        el('span', {}, 'Include API key in export (otherwise left blank)'),
    ]);
    const exportBtn = el('button', {
        class: 'btn btn-ghost',
        onClick: () => exportDataFlow(includeKeyCheckbox.checked),
    }, [
        el('span', { class: 'icon', html: '\u2B07' }),
        el('span', {}, 'Export .takir file'),
    ]);

    const importFileInput = el('input', {
        class: 'form-input',
        type: 'file',
        accept: '.takir,application/json',
    });
    importFileInput.addEventListener('change', () => importDataFlow(importFileInput));
    const importBtn = el('button', {
        class: 'btn btn-ghost',
        onClick: () => importFileInput.click(),
    }, [
        el('span', { class: 'icon', html: '\u2B06' }),
        el('span', {}, 'Import .takir file'),
    ]);
    const importHint = el('p', { class: 'form-hint' }, 'Importing replaces all current data (skills, quests, AI memory). Your API key is preserved.');

    // AI debug toggle — pipes every AI request/response, agent step, and
    // tool call to the browser DevTools console as [Takir AI] entries. Off
    // by default; flip on when troubleshooting a misbehaving model.
    const aiDebugCheckbox = el('input', {
        type: 'checkbox',
        id: 'settings-ai-debug',
    });
    aiDebugCheckbox.checked = !!state.aiDebug;
    const aiDebugLabel = el('label', {
        class: 'form-hint',
        style: 'display:flex;align-items:center;gap:6px;margin:6px 0 0;cursor:pointer;',
    }, [
        aiDebugCheckbox,
        el('span', {}, 'Log all AI requests, responses, and tool calls to the browser console as [Takir AI] entries (developer / debug)'),
    ]);
    aiDebugCheckbox.addEventListener('change', () => {
        store.setAiDebug(aiDebugCheckbox.checked);
        try {
            if (typeof console !== 'undefined' && console.info) {
                console.info(`[Takir AI] debug logging ${aiDebugCheckbox.checked ? 'enabled' : 'disabled'}`);
            }
        } catch { /* ignore */ }
    });

    const body = el('div', {}, [
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'OpenRouter API Key'),
            apiInput,
            status,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Model'),
            modelSelect,
            modelInput,
            el('p', { class: 'form-hint' }, `Default: ${state.model || 'google/gemma-4-31b-it:free'}. Pick from the list to switch, or type a custom OpenRouter model id. If the current model is rate-limited (429), Tak will automatically fall back to ${state.modelHint || 'google/gemma-3-27b-it:free'}.`),
            aiDebugLabel,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'SearXNG URL (web search)'),
            searxngInput,
            el('p', { class: 'form-hint' }, 'The public SearXNG instance Tak uses for web_search. Default: http://141.147.118.157:8926/. You can also self-host one and put its URL here.'),
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Data File Location'),
            pathDisplay,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Test API Key'),
            el('button', {
                class: 'btn btn-ghost btn-block',
                onClick: async () => {
                    if (!isApiKeyConfigured(store.state)) {
                        error('Set your API key first.');
                        return;
                    }
                    try {
                        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
                            headers: { 'Authorization': `Bearer ${store.state.apiKey}` }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const credits = data?.data?.limit_remaining ?? data?.data?.usage ?? '?';
                            success(`Key is valid. Remaining credits: $${credits}`);
                        } else {
                            error(`Key check failed: HTTP ${res.status}`);
                        }
                    } catch (e) {
                        error(`Key check failed: ${e.message}`);
                    }
                },
            }, [
                el('span', { class: 'icon', html: '\u2728' }),
                el('span', {}, 'Test API Key'),
            ]),
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Backup & Restore'),
            el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;' }, [exportBtn, importBtn]),
            includeKeyLabel,
            importFileInput,
            importHint,
        ]),
        el('div', { class: 'form-group' }, [
            el('label', { class: 'form-label' }, 'Help'),
            el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;' }, [
                el('button', {
                    class: 'btn btn-ghost',
                    onClick: () => { closeModal(); startTour(); },
                }, [
                    el('span', { class: 'icon', html: '\u{1F6E3}' }),
                    el('span', {}, 'Replay tour'),
                ]),
                el('button', {
                    class: 'btn btn-ghost',
                    onClick: () => { closeModal(); maybeShowOnboarding({ force: true }); },
                }, [
                    el('span', { class: 'icon', html: '\u{1F39B}' }),
                    el('span', {}, 'Show welcome'),
                ]),
                el('button', {
                    class: 'btn btn-ghost',
                    onClick: () => { closeModal(); openBugReport(); },
                }, [
                    el('span', { class: 'icon', html: '\u{1F41B}' }),
                    el('span', {}, 'Report a bug'),
                ]),
            ]),
            el('p', { class: 'form-hint' }, 'You can also use the ? button in the header for the same options.'),
        ]),
    ]);

    const saveBtn = el('button', {
        class: 'btn btn-primary',
        onClick: () => {
            store.setApiKey(apiInput.value);
            store.setModel(modelInput.value);
            store.setSearxngUrl(searxngInput.value);
            success('Settings saved.');
            closeModal();
        },
    }, 'Save');
    const cancelBtn = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Cancel');
    const clearBtn = el('button', {
        class: 'btn btn-danger',
        onClick: async () => {
            const ok = await confirmDialog({
                title: 'Erase everything?',
                message: 'This will permanently delete all skills, quests, AI chat history, Learn chat history, and AI memory. Your API key, model, and SearXNG URL are kept.\n\nThis cannot be undone.',
                confirmLabel: 'Erase everything',
                danger: true,
            });
            if (!ok) return;
            clearBtn.disabled = true;
            clearBtn.textContent = 'Clearing...';
            try {
                // Await the wipe: clearAllData clears in-memory + session
                // cache, then immediately writes the empty state to the
                // file store (no debounce). When this resolves, the file
                // is the new "blank" state.
                await store.clearAllData({ keepSettings: true });
                success('All data cleared.');
            } catch (e) {
                error(`Clear failed: ${e.message}`);
            } finally {
                clearBtn.disabled = false;
                clearBtn.textContent = 'Clear all data';
            }
            closeModal();
        },
    }, 'Clear all data');

    openModal({
        title: 'Settings',
        body,
        footer: [clearBtn, cancelBtn, saveBtn],
        onClose: () => {},
    });
}
