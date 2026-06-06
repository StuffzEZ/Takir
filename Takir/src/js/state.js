/* ==========================================================
   state.js
   Reactive state for Takir. The file store (Tauri) is the
   only persistent store. The browser side uses sessionStorage
   as a session-only fast cache (cleared automatically when
   the tab/window closes), and everything is flushed to the
   file on every change (debounced) and on app close.
   ========================================================== */

import { uid, nowISO } from './utils.js';

const SESSION_KEY = 'takir_session_v1';
const FILE_SAVE_DEBOUNCE_MS = 250;
const MAX_AI_HISTORY = 20;
const MAX_LEARN_HISTORY = 20;

const hasSessionStorage = (() => {
    try { return typeof sessionStorage !== 'undefined' && sessionStorage != null; }
    catch { return false; }
})();
const hasLocalStorage = (() => {
    try { return typeof localStorage !== 'undefined' && localStorage != null; }
    catch { return false; }
})();
const hasWindow = (() => {
    try { return typeof window !== 'undefined' && window != null; }
    catch { return false; }
})();

function safeGetSession(key) {
    if (!hasSessionStorage) return null;
    try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSetSession(key, value) {
    if (!hasSessionStorage) return;
    try { sessionStorage.setItem(key, value); } catch { /* ignore quota / disabled */ }
}
function safeClearSession(key) {
    if (!hasSessionStorage) return;
    try { if (key) sessionStorage.removeItem(key); else sessionStorage.clear(); }
    catch { /* ignore */ }
}

/** One-time migration: remove any data-store keys left over from older
 *  Takir versions that used localStorage as the persistent store. */
export function migrateLegacyLocalStorage() {
    if (!hasLocalStorage) return;
    const legacyKeys = ['takir_state_v1', 'takir_ai_history_v1', 'takir_learn_history_v1'];
    for (const k of legacyKeys) {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
}

const defaultState = {
    apiKey: '',
    model: 'google/gemma-4-31b-it:free',   // as recommended
    modelHint: 'google/gemma-3-27b-it:free', // fallback that's known to work
    searxngUrl: 'http://141.147.118.157:8926/', // public SearXNG instance used by web_search
    skills: {},    // id -> Skill
    tasks: {},     // id -> Task
    counters: { nextSkillSeq: 1, nextTaskSeq: 1 }, // monotonic display IDs (#1, #2, ...)
    selectedId: null,
    selectedType: null,  // 'skill' | 'task'
    activeTab: 'skills', // 'skills' | 'tasks' | 'learn'
    searchQuery: '',
    showOnlyAvailable: false,
    // First-run experience: false until the user finishes (or skips) the
    // welcome onboarding modal. Re-runnable from the Help menu.
    onboardingComplete: false,
    // Guided tour of the UI: false until the user finishes or skips it.
    // Re-runnable from the Help menu and Settings.
    tourComplete: false,
    // AI memory: persistent across sessions. The AI uses this to remember
    // facts about the user, prior work, preferences, and project context.
    memory: {
        facts: {},         // key -> value (structured facts)
        notes: '',         // free-form text the AI appends to
        pinned: { skills: [], tasks: [] }, // ids the AI flagged as important
    },
    // Chat histories live in the main state so they share the same
    // persistence model (file store) and "clear all data" wipes them too.
    aiHistory: [],     // [{ role, content, ... }]
    learnHistory: [],  // [{ role, content, ... }]
    // Developer/debug toggle. Lives in the same store so "clear all
    // data" resets it; user can re-enable it in the API debug console.
    aiDebug: false,
};

class Store extends EventTarget {
    constructor() {
        super();
        this._hydrated = false;
        this.state = this._load();
        this._saveTimer = null;
    }

    _load() {
        // Migrate: drop any old localStorage entries from previous builds.
        migrateLegacyLocalStorage();

        let stored = null;
        try {
            const raw = safeGetSession(SESSION_KEY);
            if (raw) stored = JSON.parse(raw);
        } catch (e) {
            console.warn('sessionStorage read failed:', e);
        }

        // If the session cache is empty (fresh window, or a wiped session),
        // fall back to the file store — that's the only persistent store.
        if (!stored || Object.keys(stored.skills || {}).length === 0) {
            this._tryLoadFromFile().then(loaded => {
                // Guard: don't overwrite if the user has already made changes
                if (this._hydrated) return;
                if (loaded && (!stored || Object.keys(stored?.skills || {}).length === 0)) {
                    const next = { ...defaultState, ...loaded, memory: this._normalizeMemory(loaded.memory) };
                    next.aiHistory = Array.isArray(loaded.aiHistory) ? loaded.aiHistory.slice(-MAX_AI_HISTORY) : [];
                    next.learnHistory = Array.isArray(loaded.learnHistory) ? loaded.learnHistory.slice(-MAX_LEARN_HISTORY) : [];
                    next.aiDebug = !!loaded.aiDebug;
                    this.state = next;
                    this._emit({ type: 'hydrate' });
                }
            }).catch(() => { /* ignore */ });
        }

        const merged = { ...defaultState, ...(stored || {}) };
        merged.memory = this._normalizeMemory(merged.memory);
        merged.aiHistory = Array.isArray(merged.aiHistory) ? merged.aiHistory.slice(-MAX_AI_HISTORY) : [];
        merged.learnHistory = Array.isArray(merged.learnHistory) ? merged.learnHistory.slice(-MAX_LEARN_HISTORY) : [];
        merged.aiDebug = !!merged.aiDebug;
        return merged;
    }

    _normalizeMemory(m) {
        const safe = m && typeof m === 'object' ? m : {};
        return {
            facts: (safe.facts && typeof safe.facts === 'object' && !Array.isArray(safe.facts)) ? safe.facts : {},
            notes: typeof safe.notes === 'string' ? safe.notes : '',
            pinned: {
                skills: Array.isArray(safe.pinned?.skills) ? [...safe.pinned.skills] : [],
                tasks: Array.isArray(safe.pinned?.tasks) ? [...safe.pinned.tasks] : [],
            },
        };
    }

    async _tryLoadFromFile() {
        if (!hasWindow || !window.__TAURI__?.core?.invoke) return null;
        try {
            const res = await window.__TAURI__.core.invoke('load_state');
            if (res && res.data) return JSON.parse(res.data);
        } catch (e) {
            console.warn('File state load failed:', e);
        }
        return null;
    }

    _persist() {
        safeSetSession(SESSION_KEY, JSON.stringify(this.state));
        this._scheduleFileSave();
    }

    _scheduleFileSave() {
        if (!hasWindow || !window.__TAURI__?.core?.invoke) return;
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            try {
                await window.__TAURI__.core.invoke('save_state', {
                    data: JSON.stringify(this.state),
                });
            } catch (e) {
                console.warn('File state save failed:', e);
            }
        }, FILE_SAVE_DEBOUNCE_MS);
    }

    /** Flush any pending file save and write the current state to the file. */
    async flushFileSave() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (!hasWindow || !window.__TAURI__?.core?.invoke) return;
        try {
            await window.__TAURI__.core.invoke('save_state', {
                data: JSON.stringify(this.state),
            });
        } catch (e) {
            console.warn('File state flush failed:', e);
        }
    }

    _emit(detail) {
        this.dispatchEvent(new CustomEvent('change', { detail }));
    }

    notify(detail = { type: 'change' }) {
        this._hydrated = true;
        this._persist();
        this._emit(detail);
    }

    /* --------------------- chat history --------------------- */

    getAiHistory() {
        return Array.isArray(this.state.aiHistory) ? this.state.aiHistory : [];
    }

    setAiHistory(history) {
        const list = Array.isArray(history) ? history : [];
        this.state.aiHistory = list.slice(-MAX_AI_HISTORY);
        this.notify({ type: 'ai-history' });
        return this.state.aiHistory;
    }

    appendAiHistory(entry) {
        const list = this.getAiHistory();
        list.push(entry);
        return this.setAiHistory(list);
    }

    clearAiHistory() {
        this.state.aiHistory = [];
        this.notify({ type: 'ai-history' });
    }

    getLearnHistory() {
        return Array.isArray(this.state.learnHistory) ? this.state.learnHistory : [];
    }

    setLearnHistory(history) {
        const list = Array.isArray(history) ? history : [];
        this.state.learnHistory = list.slice(-MAX_LEARN_HISTORY);
        this.notify({ type: 'learn-history' });
        return this.state.learnHistory;
    }

    appendLearnHistory(entry) {
        const list = this.getLearnHistory();
        list.push(entry);
        return this.setLearnHistory(list);
    }

    clearLearnHistory() {
        this.state.learnHistory = [];
        this.notify({ type: 'learn-history' });
    }

    /* --------------------- debug toggle --------------------- */

    getAiDebug() {
        return !!this.state.aiDebug;
    }

    setAiDebug(v) {
        this.state.aiDebug = !!v;
        this.notify({ type: 'ai-debug' });
    }

    /* ----------------------- selectors ----------------------- */

    getSkills() {
        return Object.values(this.state.skills);
    }

    getTasks() {
        return Object.values(this.state.tasks);
    }

    getSkill(id) {
        if (id == null) return null;
        const s = String(id).trim();
        if (s.startsWith('#')) {
            const n = parseInt(s.slice(1), 10);
            if (!Number.isInteger(n) || n < 1) return null;
            return this.getSkills().find(it => it.seq === n) || null;
        }
        return this.state.skills[s] || null;
    }

    getTask(id) {
        if (id == null) return null;
        const s = String(id).trim();
        if (s.startsWith('#')) {
            const n = parseInt(s.slice(1), 10);
            if (!Number.isInteger(n) || n < 1) return null;
            return this.getTasks().find(it => it.seq === n) || null;
        }
        return this.state.tasks[s] || null;
    }

    getSelected() {
        if (!this.state.selectedId) return null;
        const type = this.state.selectedType;
        if (type === 'skill') return this.getSkill(this.state.selectedId);
        if (type === 'task') return this.getTask(this.state.selectedId);
        return null;
    }

    /* --------------------- skill operations --------------------- */

    addSkill({ name, description, prerequisites = [], seq: forcedSeq } = {}) {
        const id = uid('sk');
        if (!this.state.counters || typeof this.state.counters.nextSkillSeq !== 'number') {
            this.state.counters = { nextSkillSeq: 1, nextTaskSeq: 1 };
        }
        const seq = Number.isInteger(forcedSeq) && forcedSeq > 0
            ? forcedSeq
            : this.state.counters.nextSkillSeq++;
        if (seq >= this.state.counters.nextSkillSeq) this.state.counters.nextSkillSeq = seq + 1;
        const skill = {
            id,
            type: 'skill',
            seq,
            name: (name || '').trim() || 'Untitled Skill',
            description: (description || '').trim(),
            level: 0,                // 0 = unassessed, 1..10
            prerequisites: [...new Set(Array.isArray(prerequisites) ? prerequisites.filter(Boolean) : [])],
            quiz: null,              // { questions: [...], answers: [...], score, level, reasoning, takenAt }
            createdAt: nowISO(),
            updatedAt: nowISO(),
        };
        this.state.skills[id] = skill;
        this.notify({ type: 'skill:add', id });
        return skill;
    }

    updateSkill(id, patch) {
        const s = this.state.skills[id];
        if (!s) return null;
        const allowed = ['name', 'description', 'level', 'prerequisites'];
        for (const k of allowed) {
            if (k in patch) s[k] = patch[k];
        }
        s.updatedAt = nowISO();
        this.notify({ type: 'skill:update', id });
        return s;
    }

    deleteSkill(id) {
        if (!this.state.skills[id]) return false;
        delete this.state.skills[id];
        // Remove from any task.prerequisites or skill.prerequisites
        for (const s of Object.values(this.state.skills)) {
            s.prerequisites = (s.prerequisites || []).filter(x => x !== id);
        }
        for (const t of Object.values(this.state.tasks)) {
            t.requiredSkills = (t.requiredSkills || []).filter(rs => rs.skillId !== id);
            t.prerequisites = (t.prerequisites || []).filter(x => x !== id);
            t.subtasks = (t.subtasks || []).filter(x => x !== id);
        }
        if (this.state.selectedId === id) {
            this.state.selectedId = null;
            this.state.selectedType = null;
        }
        this.notify({ type: 'skill:delete', id });
        return true;
    }

    setSkillQuiz(id, quiz) {
        const s = this.state.skills[id];
        if (!s) return null;
        s.quiz = quiz;
        if (quiz?.level) s.level = quiz.level;
        s.updatedAt = nowISO();
        this.notify({ type: 'skill:update', id });
        return s;
    }

    /* --------------------- task operations --------------------- */

    addTask({ name, description, status = 'pending', prerequisites = [], subtasks = [], requiredSkills = [], seq: forcedSeq } = {}) {
        const id = uid('tk');
        if (!this.state.counters || typeof this.state.counters.nextTaskSeq !== 'number') {
            this.state.counters = { nextSkillSeq: 1, nextTaskSeq: 1 };
        }
        const seq = Number.isInteger(forcedSeq) && forcedSeq > 0
            ? forcedSeq
            : this.state.counters.nextTaskSeq++;
        if (seq >= this.state.counters.nextTaskSeq) this.state.counters.nextTaskSeq = seq + 1;
        const task = {
            id,
            type: 'task',
            seq,
            name: (name || '').trim() || 'Untitled Quest',
            description: (description || '').trim(),
            status: ['pending', 'in-progress', 'completed', 'blocked'].includes(status) ? status : 'pending',
            prerequisites: [...new Set(Array.isArray(prerequisites) ? prerequisites.filter(Boolean) : [])],
            subtasks: [...new Set(Array.isArray(subtasks) ? subtasks.filter(Boolean) : [])],
            requiredSkills: Array.isArray(requiredSkills)
                ? requiredSkills.map(rs => ({
                    skillId: String(rs.skillId || ''),
                    level: Math.max(0, Math.min(10, Number(rs.level) || 0)),
                })).filter(rs => rs.skillId)
                : [],
            createdAt: nowISO(),
            updatedAt: nowISO(),
        };
        this.state.tasks[id] = task;
        this.notify({ type: 'task:add', id });
        return task;
    }

    updateTask(id, patch) {
        const t = this.state.tasks[id];
        if (!t) return null;
        const allowed = ['name', 'description', 'status', 'prerequisites', 'subtasks', 'requiredSkills'];
        for (const k of allowed) {
            if (k in patch) t[k] = patch[k];
        }
        t.updatedAt = nowISO();
        this.notify({ type: 'task:update', id });
        return t;
    }

    deleteTask(id) {
        if (!this.state.tasks[id]) return false;
        delete this.state.tasks[id];
        for (const tt of Object.values(this.state.tasks)) {
            tt.prerequisites = (tt.prerequisites || []).filter(x => x !== id);
            tt.subtasks = (tt.subtasks || []).filter(x => x !== id);
        }
        if (this.state.selectedId === id) {
            this.state.selectedId = null;
            this.state.selectedType = null;
        }
        this.notify({ type: 'task:delete', id });
        return true;
    }

    /* -------------------- selection / ui -------------------- */

    select(id, type) {
        this.state.selectedId = id;
        this.state.selectedType = type;
        this.notify({ type: 'select' });
    }

    clearSelection() {
        this.state.selectedId = null;
        this.state.selectedType = null;
        this.notify({ type: 'select' });
    }

    setActiveTab(tab) {
        if (this.state.activeTab === tab) return;
        this.state.activeTab = tab;
        // Clear selection when switching tabs
        this.state.selectedId = null;
        this.state.selectedType = null;
        this.notify({ type: 'tab' });
    }

    setSearch(q) {
        this.state.searchQuery = q || '';
        this.notify({ type: 'search' });
    }

    setShowOnlyAvailable(v) {
        this.state.showOnlyAvailable = !!v;
        this.notify({ type: 'filter' });
    }

    /* ---------------------- settings ---------------------- */

    setApiKey(k) {
        this.state.apiKey = (k || '').trim();
        this.notify({ type: 'settings' });
    }

    setModel(m) {
        this.state.model = (m || '').trim() || this.state.model;
        this.notify({ type: 'settings' });
    }

    setSearxngUrl(u) {
        this.state.searxngUrl = ((u || '').trim()) || defaultState.searxngUrl;
        this.notify({ type: 'settings' });
    }

    /* ---------------------- onboarding ---------------------- */

    markOnboardingComplete() {
        this.state.onboardingComplete = true;
        this.notify({ type: 'onboarding' });
    }

    resetOnboarding() {
        this.state.onboardingComplete = false;
        this.notify({ type: 'onboarding' });
    }

    markTourComplete() {
        this.state.tourComplete = true;
        this.notify({ type: 'tour' });
    }

    resetTour() {
        this.state.tourComplete = false;
        this.notify({ type: 'tour' });
    }

    /* ---------------------- ai memory ---------------------- */

    getMemory() {
        return this._normalizeMemory(this.state.memory);
    }

    setMemoryFacts(facts) {
        if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        this.state.memory.facts = { ...facts };
        this.notify({ type: 'memory' });
        return true;
    }

    rememberFact(key, value) {
        const k = String(key || '').trim();
        if (!k) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        this.state.memory.facts[k] = (value === undefined || value === null) ? '' : String(value);
        this.notify({ type: 'memory' });
        return true;
    }

    forgetFact(key) {
        const k = String(key || '').trim();
        if (!k) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        if (!(k in this.state.memory.facts)) return false;
        delete this.state.memory.facts[k];
        this.notify({ type: 'memory' });
        return true;
    }

    appendMemoryNote(text) {
        const t = String(text || '').trim();
        if (!t) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        const stamp = new Date().toISOString().slice(0, 10);
        const prev = this.state.memory.notes ? this.state.memory.notes.trimEnd() + '\n' : '';
        this.state.memory.notes = `${prev}[${stamp}] ${t}\n`;
        this.notify({ type: 'memory' });
        return true;
    }

    clearMemoryNotes() {
        this.state.memory = this._normalizeMemory(this.state.memory);
        this.state.memory.notes = '';
        this.notify({ type: 'memory' });
        return true;
    }

    pinItem(type, id) {
        const t = type === 'skill' ? 'skills' : type === 'task' ? 'tasks' : null;
        const idStr = String(id || '').trim();
        if (!t || !idStr) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        if (!this.state.memory.pinned[t].includes(idStr)) {
            this.state.memory.pinned[t] = [...this.state.memory.pinned[t], idStr];
            this.notify({ type: 'memory' });
        }
        return true;
    }

    unpinItem(type, id) {
        const t = type === 'skill' ? 'skills' : type === 'task' ? 'tasks' : null;
        const idStr = String(id || '').trim();
        if (!t || !idStr) return false;
        this.state.memory = this._normalizeMemory(this.state.memory);
        const before = this.state.memory.pinned[t].length;
        this.state.memory.pinned[t] = this.state.memory.pinned[t].filter(x => x !== idStr);
        if (this.state.memory.pinned[t].length !== before) this.notify({ type: 'memory' });
        return true;
    }

    /** Compute level gaps for a proposed set of (skill_id, level) requirements. */
    computeSkillGaps(requirements) {
        const list = Array.isArray(requirements) ? requirements : [];
        return list.map(req => {
            const skillId = String(req?.skillId || req?.skill_id || req?.id || '');
            const target = Math.max(0, Math.min(10, Number(req?.level) || 0));
            const skill = this.getSkill(skillId);
            const current = skill ? (skill.level || 0) : null;
            return {
                skillId,
                name: skill?.name || req?.name || '(unknown)',
                exists: !!skill,
                currentLevel: current,
                currentLevelRoman: toRomanSafe(current),
                targetLevel: target,
                targetLevelRoman: toRomanSafe(target),
                gap: current == null ? null : Math.max(0, target - current),
                met: current != null && current >= target,
            };
        });
    }

    /**
     * Wipe skills, tasks, selection, search/filter, AI memory, AI/Learn
     * chat history, and the AI debug toggle. Keeps api key, model, and
     * SearXNG URL by default. After clearing, the file store is
     * rewritten immediately (no debounce) so the next launch starts
     * clean. Returns a promise that resolves when the file has been
     * written (or skipped if Tauri is unavailable).
     */
    async clearAllData({ keepSettings = true } = {}) {
        this.state.skills = {};
        this.state.tasks = {};
        this.state.counters = { nextSkillSeq: 1, nextTaskSeq: 1 };
        this.state.selectedId = null;
        this.state.selectedType = null;
        this.state.searchQuery = '';
        this.state.showOnlyAvailable = false;
        this.state.memory = { facts: {}, notes: '', pinned: { skills: [], tasks: [] } };
        this.state.aiHistory = [];
        this.state.learnHistory = [];
        this.state.aiDebug = false;
        if (!keepSettings) {
            this.state.apiKey = '';
            this.state.model = 'google/gemma-4-31b-it:free';
            this.state.modelHint = 'google/gemma-3-27b-it:free';
            this.state.searxngUrl = 'http://141.147.118.157:8926/';
        }
        // Wipe the session cache and force-write the empty state to the
        // file so a refresh or relaunch doesn't resurrect stale data.
        safeClearSession();
        this._hydrated = true;
        await this.flushFileSave();
        this._emit({ type: 'wipe' });
        return true;
    }
}

function toRomanSafe(n) {
    if (n == null || !Number.isFinite(Number(n))) return '?';
    const v = Number(n);
    if (v <= 0) return '—';
    if (v >= 10) return 'X';
    const map = [
        [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let r = '';
    let rem = Math.round(v);
    for (const [val, sym] of map) {
        while (rem >= val) { r += sym; rem -= val; }
    }
    return r;
}

export const store = new Store();
if (hasWindow) window.__TAKIR_STORE__ = store; // debug
