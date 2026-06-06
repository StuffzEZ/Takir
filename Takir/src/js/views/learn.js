/* ==========================================================
   views/learn.js
   "Learn with Tak" tab — a teaching-focused chat panel that
   uses a different system prompt and its own history, separate
   from the AI assistant panel which is for managing Takir.
   ========================================================== */

import { $, el, confirmDialog, error } from '../ui.js';
import { store } from '../state.js';
import { isApiKeyConfigured } from '../api.js';
import { runAgentTurn, TOOLS } from '../agent.js';
import { freeSitesPromptBlock } from '../data/free-sites.js';

const LEARN_MAX_HISTORY = 20;

/**
 * Teaching-focused system prompt for the Learn tab. The same tool set is
 * available (so Tak can still manage skills/quests if asked) but the
 * persona, goals, and recommendations are tuned for explaining things
 * clearly and pointing the user to free resources.
 */
export const LEARN_SYSTEM_PROMPT = `You are Tak, the friendly AI in Takir's Learn tab. Your job is to help the user actually learn things — explain concepts clearly, give small concrete examples, ask one or two check-in questions, and point to high-quality FREE resources.

WHO YOU ARE
- You are patient, curious, and clear. You never make the user feel dumb for asking a basic question.
- You adapt to the user's level. If they say they're a beginner, you keep jargon light. If they say they know the basics, you skip ahead.
- You are honest about what you don't know. If something is uncertain, you say so and offer a search.

TEACHING STYLE
- Open with a 1–3 sentence intuition. Plain language, no jargon dump.
- Use one small example (code, an analogy, or a real-world use).
- When a concept has moving parts, use a short numbered list.
- Ask ONE check-in question at the end ("Want me to walk through a second example?", "Does the async part make sense?"). Don't stack multiple questions.
- Keep the whole reply scannable: short paragraphs, code in single short blocks, no decorative headings.

FREE RESOURCES FIRST
- The user is on a Tauri desktop app and prefers 100% free resources. Below is a curated list. Prefer these over generic web results.
- When the user asks "where can I learn X" or "what's a good tutorial for Y", reach into this list. If none match, fall back to web_search (SearXNG-backed).
- Always include the URL when recommending a site.

${freeSitesPromptBlock()}

CONVERSATIONAL ARC
- Start a topic with the smallest thing they need to know first. Build up.
- After they ask follow-ups, build on what you already said. Don't restart.
- If a question is too broad ("teach me everything about Python"), narrow it: "Python is huge — what's the goal? A script to rename files, a web app, data analysis? I'll tailor from there."
- Track what they've already learned in this session. Don't re-explain.

WHEN YOU'RE NOT SURE
- Say so plainly ("I'm not 100% sure about this — let me check.").
- Use web_search to look it up, then answer.
- If the user shares a URL, use web_fetch to read it, then summarize.

WHEN THE USER ASKS YOU TO MANAGE TAKIR
- You have the full Takir tool set (skills, quests, memory, web search). The Learn tab is for teaching, but if they say "add a skill for X" or "create a quest about Y", do it — just keep the response short and confirm the change with the display id (#N).
- If a teaching answer would be helped by linking to a real skill or quest they already have, you can call list_skills / list_tasks to look one up.

OUTPUT FORMAT
- No markdown headings (#, ##). Use plain paragraphs and short lists.
- Code in single backtick blocks only when needed. Multi-line code in triple backticks is fine but keep it short.
- Don't apologize unnecessarily. Don't say "as an AI". Just answer.

RECOGNITION
- Always sign off your substantive answers with "— Tak" so the user knows the voice.`;

/* ---------------------- history ---------------------- */

// History lives in the main state (and thus the file store), so "clear
// all data" wipes it and the same persistence model applies.
const loadHistory = () => store.getLearnHistory();
const saveHistory = (h) => store.setLearnHistory(h);
const pushHistory = (entry) => store.appendLearnHistory(entry);

/* ---------------------- message rendering ---------------------- */

function linkify(text) {
    if (!text) return '';
    // Escape HTML, then replace URLs with anchor tags.
    const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const escaped = escape(text);
    const urlRe = /(\bhttps?:\/\/[^\s<]+)/g;
    return escaped.replace(urlRe, (url) => `<a class="learn-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function renderMessage(role, text) {
    const cls = `learn-msg ${role}`;
    if (role === 'assistant') {
        // Light markdown-ish: triple backticks, single backticks, simple bullet lines.
        const html = renderMarkdownish(text || '');
        const div = document.createElement('div');
        div.className = cls;
        div.innerHTML = html;
        return div;
    }
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text || '';
    return div;
}

function renderMarkdownish(text) {
    let s = linkify(text);
    // Triple backtick code blocks
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</code></pre>`);
    // Inline code
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bullet lists
    s = s.replace(/(^|\n)((?:- .*(?:\n|$))+)/g, (m, pre, block) => {
        const items = block.trim().split(/\n/).map(line => `<li>${line.replace(/^- /, '')}</li>`).join('');
        return `${pre}<ul>${items}</ul>`;
    });
    return s.replace(/\n/g, '<br>');
}

function renderToolCard(name, args, result, ok) {
    const card = el('div', { class: `learn-tool-card${ok === false ? ' error' : ''}` });
    card.appendChild(el('div', {}, [
        el('span', { class: 'ai-tool-name' }, name || 'tool'),
        el('span', { class: 'text-faint' }, '  '),
        el('span', {}, summarizeToolCall(name, args, result)),
    ]));
    if (result !== undefined && result !== null) {
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
        case 'web_search': {
            const n = data?.count ?? 0;
            return `${n} result${n === 1 ? '' : 's'} for "${data?.query || ''}"`;
        }
        case 'web_fetch': {
            const u = data?.url || args?.url || '';
            return `fetched ${u.replace(/^https?:\/\//, '').slice(0, 40)}`;
        }
        case 'create_skill':   return `created skill "${data?.name || ''}" (#${data?.seq ?? '?'})`;
        case 'create_task':    return `created quest "${data?.title || ''}" (#${data?.seq ?? '?'})`;
        default: return 'ok';
    }
}

function scrollToBottom() {
    const list = $('#learn-messages');
    if (!list) return;
    list.scrollTop = list.scrollHeight;
}

function renderHistory() {
    const list = $('#learn-messages');
    if (!list) return;
    list.innerHTML = '';
    const h = loadHistory();
    if (!h.length) {
        renderGreeting();
        return;
    }
    for (const m of h) {
        if (m.role === 'user') {
            list.appendChild(renderMessage('user', m.content));
        } else if (m.role === 'assistant' && m.content) {
            list.appendChild(renderMessage('assistant', m.content));
        } else if (m.role === 'tool' && m.toolName) {
            list.appendChild(renderToolCard(m.toolName, m.arguments, m.result, m.ok));
        }
    }
    scrollToBottom();
}

function renderGreeting() {
    const list = $('#learn-messages');
    if (!list) return;
    if (list.children.length > 0) return;
    const greeting = isApiKeyConfigured(store.state)
        ? "Hi! I'm Tak. Ask me anything you want to learn — a concept, a language, a tool. I'll keep it short, give you a quick example, and point you to free resources to go deeper.\n\nWhat do you want to start with?"
        : "Hi! Set your OpenRouter API key in Settings first (the gear icon, top right). Once that's in, ask me anything and I'll teach you about it.";
    list.appendChild(renderMessage('assistant', greeting));
}

function clearLearnChat() {
    confirmDialog({
        title: 'Clear Learn chat?',
        message: 'This clears the visible chat history. Your AI memory and your skills/quests are kept.',
        confirmLabel: 'Clear chat',
    }).then(ok => {
        if (!ok) return;
        store.clearLearnHistory();
        const list = $('#learn-messages');
        if (list) list.innerHTML = '';
        renderGreeting();
    });
}

let learnBusy = false;
let learnLastBatch = [];

async function sendLearnMessage() {
    if (learnBusy) return;
    const input = $('#learn-input');
    const list = $('#learn-messages');
    if (!input || !list) return;

    const text = (input.value || '').trim();
    if (!text) return;

    if (!isApiKeyConfigured(store.state)) {
        error('Set your OpenRouter API key in Settings first.');
        return;
    }

    input.value = '';
    input.disabled = true;

    list.appendChild(renderMessage('user', text));
    pushHistory({ role: 'user', content: text, ts: Date.now() });
    scrollToBottom();

    const typing = el('div', { class: 'learn-msg typing' }, 'Tak is thinking\u2026');
    list.appendChild(typing);
    scrollToBottom();

    learnBusy = true;
    learnLastBatch = [];
    try {
        const history = loadHistory()
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }))
            .slice(-LEARN_MAX_HISTORY);

        const result = await runAgentTurn({
            apiKey: store.state.apiKey,
            model: store.state.model,
            history,
            userMessage: text,
            systemPrompt: LEARN_SYSTEM_PROMPT,
            tools: TOOLS,
            temperature: 0.6,
            maxTokens: 1800,
            onToolCall: (rec) => {
                learnLastBatch.push(rec);
                list.appendChild(renderToolCard(rec.name, rec.arguments, rec.result, rec.result?.ok !== false));
                scrollToBottom();
                pushHistory({
                    role: 'tool',
                    toolName: rec.name,
                    arguments: rec.arguments,
                    result: rec.result,
                    ok: rec.result?.ok !== false,
                    ts: Date.now(),
                });
            },
            onAssistantText: () => {},
        });

        if (typing.parentNode) typing.parentNode.removeChild(typing);
        if (result.text) {
            list.appendChild(renderMessage('assistant', result.text));
            pushHistory({ role: 'assistant', content: result.text, ts: Date.now() });
        } else if (learnLastBatch.length) {
            list.appendChild(renderMessage('system', 'Done.'));
        }
        scrollToBottom();
    } catch (e) {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        list.appendChild(renderMessage('error', e.message || String(e)));
        scrollToBottom();
    } finally {
        learnBusy = false;
        input.disabled = false;
        input.focus();
    }
}

export function initLearnPanel() {
    const form = $('#learn-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            sendLearnMessage();
        });
    }
    const input = $('#learn-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendLearnMessage();
            }
        });
    }
    renderHistory();
}
