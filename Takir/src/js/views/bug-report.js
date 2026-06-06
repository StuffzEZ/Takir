/* ==========================================================
   views/bug-report.js
   Bug report modal. The HTML for #bug-modal is authored in
   index.html (provided by the user) and this module wires it
   up: collects user input, gathers system info, copies a
   formatted report, and opens GitHub with a prefilled body.
   ========================================================== */

import { store } from '../state.js';

const GITHUB_REPO = 'anomalyco/opencode';

function $(sel, root = document) { return root.querySelector(sel); }

function collectSystemInfo() {
    const info = {
        app: 'Takir',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
        language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
        screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}@${screen.devicePixelRatio || 1}x` : 'unknown',
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
        tauri: typeof window !== 'undefined' && !!window.__TAURI__ ? 'yes' : 'no',
        timestamp: new Date().toISOString(),
    };
    try {
        const s = store && store.state ? store.state : null;
        if (s) {
            info.model = s.model || 'unknown';
            info.skillCount = Object.keys(s.skills || {}).length;
            info.taskCount = Object.keys(s.tasks || {}).length;
            info.aiDebug = s.aiDebug ? 'on' : 'off';
        }
    } catch { /* ignore */ }
    return info;
}

function formatSystemInfo(info) {
    return [
        `App:        ${info.app}`,
        `Model:      ${info.model || 'n/a'}`,
        `Skills:     ${info.skillCount ?? 'n/a'}`,
        `Quests:     ${info.taskCount ?? 'n/a'}`,
        `Tauri:      ${info.tauri}`,
        `AI debug:   ${info.aiDebug || 'n/a'}`,
        `Platform:   ${info.platform}`,
        `UA:         ${info.userAgent}`,
        `Screen:     ${info.screen}`,
        `Viewport:   ${info.viewport}`,
        `Language:   ${info.language}`,
        `Timestamp:  ${info.timestamp}`,
    ].join('\n');
}

function buildReport() {
    const title = ($('#bug-title')?.value || '').trim();
    const what = ($('#bug-what')?.value || '').trim();
    const steps = ($('#bug-steps')?.value || '').trim();
    const expected = ($('#bug-expected')?.value || '').trim();
    const info = collectSystemInfo();
    const sysBlock = formatSystemInfo(info);
    const lines = [];
    if (title) lines.push(`# ${title}`, '');
    if (what) lines.push('## What happened?', '', what, '');
    if (steps) lines.push('## Steps to reproduce', '', steps, '');
    if (expected) lines.push('## Expected behaviour', '', expected, '');
    lines.push('## System info', '', '```', sysBlock, '```', '');
    return { title, body: lines.join('\n').trim() };
}

function showCopyFeedback(ok) {
    if (typeof window === 'undefined') return;
    const btn = $('#bug-copy');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = original; }, 1500);
}

async function copyReport() {
    const { body } = buildReport();
    if (!body) {
        if (typeof window !== 'undefined' && window.takirWarn) window.takirWarn('Fill in some details first.');
        return;
    }
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(body);
            showCopyFeedback(true);
        } else {
            // Fallback: textarea + execCommand
            const ta = document.createElement('textarea');
            ta.value = body;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            showCopyFeedback(ok);
        }
    } catch {
        showCopyFeedback(false);
    }
}

function openGitHub() {
    const { title, body } = buildReport();
    if (!title) {
        if (typeof window !== 'undefined' && window.takirWarn) window.takirWarn('Add a title first.');
        return;
    }
    const params = new URLSearchParams();
    params.set('title', title);
    params.set('body', body || '*(no details)*');
    const url = `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
        // Fallback: copy to clipboard so the user can paste it somewhere.
        if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(url);
    }
    closeBugReport();
}

function closeBugReport() {
    const m = $('#bug-modal');
    if (m) m.classList.add('hidden');
}

function openBugReport() {
    const m = $('#bug-modal');
    if (!m) return;
    m.classList.remove('hidden');
    // Populate system info on open.
    const sys = $('#bug-sysinfo');
    if (sys) sys.textContent = formatSystemInfo(collectSystemInfo());
    // Focus the title field.
    setTimeout(() => $('#bug-title')?.focus(), 50);
}

function wireBugReport() {
    const m = $('#bug-modal');
    if (!m) return;
    const cancel = $('#bug-cancel');
    const copy = $('#bug-copy');
    const open = $('#bug-open');
    if (cancel) cancel.addEventListener('click', closeBugReport);
    if (copy) copy.addEventListener('click', copyReport);
    if (open) open.addEventListener('click', openGitHub);
    // Backdrop click closes (when clicking outside the card).
    m.addEventListener('click', (e) => {
        if (e.target === m) closeBugReport();
    });
    // ESC closes.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !m.classList.contains('hidden')) closeBugReport();
    });
}

export function initBugReport() {
    wireBugReport();
}

/* ----- test helpers (no DOM, used by tests) ----- */

export function formatSystemInfoText(info) {
    return formatSystemInfo(info);
}

export function buildReportText({ title, what, steps, expected, systemInfo }) {
    const info = systemInfo || {
        app: 'Takir', platform: 'test', userAgent: 'test', screen: '0x0',
        viewport: '0x0', language: 'en', tauri: 'no', timestamp: '2025-01-01T00:00:00Z',
    };
    const sysBlock = formatSystemInfo(info);
    const lines = [];
    if (title) lines.push(`# ${title}`, '');
    if (what) lines.push('## What happened?', '', what, '');
    if (steps) lines.push('## Steps to reproduce', '', steps, '');
    if (expected) lines.push('## Expected behaviour', '', expected, '');
    lines.push('## System info', '', '```', sysBlock, '```', '');
    return lines.join('\n').trim();
}

export { collectSystemInfo, openBugReport, closeBugReport, buildReport };
