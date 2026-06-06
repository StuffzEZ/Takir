/* ==========================================================
   app.js
   Takir main entry. Wires UI events, tabs, modals, quiz, tasks.
   Modal/panel logic now lives in ./views/*.js.
   ========================================================== */

import { store } from './state.js';
import { debounce } from './utils.js';
import { $, $$, initModalDismiss, renderView, renderDetail, renderFilterChips, warn } from './ui.js';
import { openAddSkillModal, deleteSkillConfirm, startQuiz } from './views/skills.js';
import { openAddTaskModal, deleteTaskConfirm, analyzeTaskFlow, openProgressModal } from './views/tasks.js';
import { openSettings } from './views/settings.js';
import { initAiPanel } from './views/ai-panel.js';
import { initLearnPanel } from './views/learn.js';
import { initOnboarding, maybeShowOnboarding } from './views/onboarding.js';
import { initTour, startTour } from './views/tour.js';
import { initBugReport, openBugReport } from './views/bug-report.js';
import { isApiKeyConfigured } from './api.js';

// Expose for cross-module UI hooks (e.g. bug-report -> warn toast).
if (typeof window !== 'undefined') {
    window.takirWarn = warn;
}

initModalDismiss();
initHeader();
initTabs();
initSearch();
initAddButton();
initAppEvents();
initFlushOnUnload();
initAiPanel();
initLearnPanel();
initOnboarding();
initTour();
initBugReport();
initHelpMenu();

store.addEventListener('change', () => {
    syncTabBar();
    renderView();
    renderDetail();
    renderFilterChips();
});

syncTabBar();
showFirstRunGuidance();

/* ---------------- init functions ---------------- */

function initHeader() {
    $('#btn-settings').addEventListener('click', openSettings);
}

function initHelpMenu() {
    const btn = $('#btn-help');
    const menu = $('#help-menu');
    if (!btn || !menu) return;
    function open() {
        const r = btn.getBoundingClientRect();
        menu.style.top = (r.bottom + 6) + 'px';
        menu.style.left = Math.max(8, r.right - 200) + 'px';
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) open(); else close();
    });
    // Close on outside click.
    document.addEventListener('click', (e) => {
        if (menu.classList.contains('hidden')) return;
        if (e.target === btn || btn.contains(e.target)) return;
        if (!menu.contains(e.target)) close();
    });
    // Close on ESC.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.classList.contains('hidden')) close();
    });
    // Menu actions.
    $('#help-replay-tour')?.addEventListener('click', () => { close(); startTour(); });
    $('#help-replay-onboarding')?.addEventListener('click', () => { close(); maybeShowOnboarding({ force: true }); });
    $('#help-report-bug')?.addEventListener('click', () => { close(); openBugReport(); });
}

function initTabs() {
    for (const tab of $$('.tab[data-tab]')) {
        tab.addEventListener('click', () => store.setActiveTab(tab.dataset.tab));
    }
}

export function syncTabBar() {
    const active = store.state.activeTab;
    for (const tab of $$('.tab[data-tab]')) {
        const isActive = tab.dataset.tab === active;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    document.body.classList.toggle('tab-learn', active === 'learn');
    updateAddButtonLabel();
}

function updateAddButtonLabel() {
    const label = $('#btn-add-label');
    if (!label) return;
    label.textContent = store.state.activeTab === 'skills' ? 'New Skill'
                      : store.state.activeTab === 'tasks' ? 'New Quest'
                      : 'New';
}

function initSearch() {
    const input = $('#search-input');
    if (!input) return;
    const setSearchDebounced = debounce((v) => store.setSearch(v), 120);
    input.addEventListener('input', (e) => setSearchDebounced(e.target.value));
    if (store.state.searchQuery) input.value = store.state.searchQuery;
}

function initAddButton() {
    const btn = $('#btn-add');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (store.state.activeTab === 'skills') openAddSkillModal();
        else openAddTaskModal();
    });
}

function initAppEvents() {
    window.addEventListener('takir:start-quiz', (e) => startQuiz(e.detail.id));
    window.addEventListener('takir:edit-skill', (e) => openAddSkillModal(e.detail.id));
    window.addEventListener('takir:delete-skill', (e) => deleteSkillConfirm(e.detail.id));
    window.addEventListener('takir:edit-task', (e) => openAddTaskModal(e.detail.id));
    window.addEventListener('takir:analyze-task', (e) => analyzeTaskFlow(e.detail.id));
    window.addEventListener('takir:delete-task', (e) => deleteTaskConfirm(e.detail.id));
    window.addEventListener('takir:submit-progress', (e) => openProgressModal(e.detail.id));
}

function initFlushOnUnload() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeunload', () => {
        try { store.flushFileSave(); } catch { /* ignore */ }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            try { store.flushFileSave(); } catch { /* ignore */ }
        }
    });
}

function showFirstRunGuidance() {
    // Show the onboarding modal on first run. It's a no-op if already done.
    // Small delay so the UI finishes painting first.
    setTimeout(() => {
        const isFresh = !isApiKeyConfigured(store.state)
                     && store.getSkills().length === 0
                     && store.getTasks().length === 0;
        if (isFresh) {
            maybeShowOnboarding();
        }
    }, 250);
}
