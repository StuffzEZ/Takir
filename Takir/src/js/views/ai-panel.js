/* ==========================================================
   views/ai-panel.js
   AI assistant side-panel: chat UI + history + agent turn runner.
   History is stored in the main state (and thus the file store)
   via store.getAiHistory / setAiHistory / appendAiHistory.
   ========================================================== */

import { $, el, confirmDialog, error } from '../ui.js';
import { store } from '../state.js';
import { isApiKeyConfigured } from '../api.js';
import { runAgentTurn } from '../agent.js';
import { openAiMemoryModal } from './ai-memory.js';

const loadAiHistory = () => store.getAiHistory();
const saveAiHistory = (h) => store.setAiHistory(h);
const pushAiHistory = (entry) => store.appendAiHistory(entry);
const AI_MAX_HISTORY = 20;

function renderAiMessage(role, text) {
    return el('div', { class: `ai-msg ${role}` }, text || '');
}

function renderAiToolCard(name, args, result, ok) {
    const card = el('div', { class: `ai-tool-card${ok === false ? ' error' : ''}` });
    card.appendChild(el('div', {}, [
        el('span', { class: 'ai-tool-name' }, name || 'tool'),
        el('span', { class: 'text-faint' }, '  '),
        el('span', {}, summarizeToolCall(name, args, result)),
    ]));
    if (result !== undefined) {
        try {
            const txt = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            if (txt && txt.length < 4000) {
                card.appendChild(el('pre', {}, txt));
            }
        } catch { /* ignore */ }
    }
    return card;
}

function summarizeToolCall(name, args, result) {
    if (!result || result.ok === false) {
        return result?.error?.message || 'failed';
    }
    const data = result.data;
    switch (name) {
        case 'create_skill':   return `created "${data?.name || ''}" (${data?.id || ''})`;
        case 'update_skill':   return `updated "${data?.name || args?.id || ''}"`;
        case 'delete_skill':   return args?.confirm ? `deleted "${data?.name || args?.id}"` : 'preview: would delete';
        case 'create_task':    return `created "${data?.title || ''}" (${data?.id || ''})`;
        case 'update_task':    return `updated "${data?.title || args?.id || ''}"`;
        case 'delete_task':    return args?.confirm ? `deleted "${data?.title || args?.id}"` : 'preview: would delete';
        case 'remember_fact':  return `remembered ${args?.key} = "${args?.value}"`;
        case 'forget_fact':    return `forgot ${args?.key}`;
        case 'append_memory_note': return `appended note`;
        case 'pin_item':       return `pinned ${args?.type} ${args?.id}`;
        case 'unpin_item':     return `unpinned ${args?.type} ${args?.id}`;
        case 'assess_skill_requirements': {
            const reqs = data?.requirements || [];
            const gaps = reqs.filter(r => r.gap > 0).length;
            return `${reqs.length} requirements, ${gaps} with a gap`;
        }
        case 'generate_quiz':  return `generated ${data?.questionCount || 0} questions`;
        case 'analyze_task':   return `analyzed task (difficulty ${data?.difficulty || '?'}/10)`;
        case 'list_skills':    return `${(data || []).length} skills`;
        case 'list_tasks':     return `${(data || []).length} tasks`;
        case 'get_skill':      return data?.name || '';
        case 'get_task':       return data?.title || '';
        case 'search_all':     return `${(data?.skills || []).length} skills, ${(data?.tasks || []).length} tasks`;
        case 'read_memory':    return `${Object.keys(data?.facts || {}).length} facts, ${(data?.notes || '').length} chars of notes`;
        case 'web_search':     return `${data?.count ?? 0} result${data?.count === 1 ? '' : 's'} for "${data?.query || ''}"`;
        case 'web_fetch':      return `fetched ${(data?.url || args?.url || '').replace(/^https?:\/\//, '').slice(0, 40)}`;
        default:               return 'ok';
    }
}

function scrollAiMessagesToBottom() {
    const list = $('#ai-messages');
    if (!list) return;
    list.scrollTop = list.scrollHeight;
}

function renderAiGreeting() {
    const list = $('#ai-messages');
    if (!list) return;
    if (list.children.length > 0) return;
    const greeting = isApiKeyConfigured(store.state)
        ? "Hi, I'm Tak. I can read, create, update, and delete your skills and quests, run quizzes, analyze tasks, and remember facts about you across sessions. What would you like to do?"
        : "Hi, I'm Tak. Set your OpenRouter API key in Settings first, then come back. I'll be able to read, create, update, and delete your skills and quests, run quizzes, analyze tasks, and remember facts about you across sessions.";
    list.appendChild(renderAiMessage('assistant', greeting));
}

function renderAiHistory() {
    const list = $('#ai-messages');
    if (!list) return;
    list.innerHTML = '';
    const h = loadAiHistory();
    if (!h.length) {
        renderAiGreeting();
        return;
    }
    for (const m of h) {
        if (m.role === 'user') {
            list.appendChild(renderAiMessage('user', m.content));
        } else if (m.role === 'assistant' && m.content) {
            list.appendChild(renderAiMessage('assistant', m.content));
        } else if (m.role === 'tool' && m.toolName) {
            list.appendChild(renderAiToolCard(m.toolName, m.arguments, m.result, m.ok));
        }
    }
    scrollAiMessagesToBottom();
}

function clearAiChat() {
    confirmDialog({
        title: 'Clear chat?',
        message: 'This will clear the visible chat history. The AI\'s memory (facts and notes) is kept unless you also clear it from the Memory viewer.',
        confirmLabel: 'Clear chat',
    }).then(ok => {
        if (!ok) return;
        store.clearAiHistory();
        const list = $('#ai-messages');
        if (list) list.innerHTML = '';
        renderAiGreeting();
    });
}

function isAiPanelOpen() {
    const panel = $('#ai-panel');
    return panel && !panel.classList.contains('hidden');
}
function openAiPanel() {
    const panel = $('#ai-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        const input = $('#ai-input');
        if (input) input.focus();
    }, 50);
}
function closeAiPanel() {
    const panel = $('#ai-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
}
function toggleAiPanel() {
    if (isAiPanelOpen()) closeAiPanel();
    else openAiPanel();
}

let aiBusy = false;
let aiLastBatch = [];

async function sendAiMessage() {
    if (aiBusy) return;
    const input = $('#ai-input');
    const list = $('#ai-messages');
    if (!input || !list) return;

    const text = (input.value || '').trim();
    if (!text) return;

    if (!isApiKeyConfigured(store.state)) {
        error('Set your OpenRouter API key in Settings first.');
        return;
    }

    input.value = '';
    input.disabled = true;

    list.appendChild(renderAiMessage('user', text));
    pushAiHistory({ role: 'user', content: text, ts: Date.now() });
    scrollAiMessagesToBottom();

    const typing = el('div', { class: 'ai-typing' }, 'AI is thinking');
    list.appendChild(typing);
    scrollAiMessagesToBottom();

    aiBusy = true;
    aiLastBatch = [];
    try {
        const history = loadAiHistory()
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }))
            .slice(-AI_MAX_HISTORY);

        const result = await runAgentTurn({
            apiKey: store.state.apiKey,
            model: store.state.model,
            history,
            userMessage: text,
            onToolCall: (rec) => {
                aiLastBatch.push(rec);
                list.appendChild(renderAiToolCard(rec.name, rec.arguments, rec.result, rec.result?.ok !== false));
                scrollAiMessagesToBottom();
                pushAiHistory({
                    role: 'tool',
                    toolName: rec.name,
                    arguments: rec.arguments,
                    result: rec.result,
                    ok: rec.result?.ok !== false,
                    ts: Date.now(),
                });
            },
            onAssistantText: () => {
                // The agent emits interim text before tool calls; the final text is
                // shown in the result.text branch below.
            },
        });

        if (typing.parentNode) typing.parentNode.removeChild(typing);
        if (result.text) {
            list.appendChild(renderAiMessage('assistant', result.text));
            pushAiHistory({ role: 'assistant', content: result.text, ts: Date.now() });
        } else if (aiLastBatch.length) {
            list.appendChild(renderAiMessage('system', `Done. ${aiLastBatch.length} change${aiLastBatch.length === 1 ? '' : 's'} applied.`));
        }
        scrollAiMessagesToBottom();
    } catch (e) {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        list.appendChild(renderAiMessage('error', e.message || String(e)));
        scrollAiMessagesToBottom();
    } finally {
        aiBusy = false;
        input.disabled = false;
        input.focus();
    }
}

export function initAiPanel() {
    const btn = $('#btn-ai');
    if (btn) btn.addEventListener('click', toggleAiPanel);
    const closeBtn = $('#btn-ai-close');
    if (closeBtn) closeBtn.addEventListener('click', closeAiPanel);
    const clearBtn = $('#btn-ai-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearAiChat);
    const memBtn = $('#btn-ai-memory');
    if (memBtn) memBtn.addEventListener('click', openAiMemoryModal);
    const form = $('#ai-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            sendAiMessage();
        });
    }
    const input = $('#ai-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage();
            }
        });
    }
    renderAiHistory();
}
