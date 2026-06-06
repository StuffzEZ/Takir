// tests/storage_architecture_test.mjs
// Verifies the new storage model:
//   - File store is the only persistent store.
//   - Browser uses sessionStorage as a session-only fast cache.
//   - localStorage is NOT used for the data store (only migrated on startup).
//   - clearAllData clears in-memory, clears the session, and writes
//     the empty state to the file synchronously.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ----- Test stubs -----
class StorageStub {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
    get size() { return this._m.size; }
    has(k) { return this._m.has(k); }
    keys() { return Array.from(this._m.keys()); }
}

const localStore = new StorageStub();
const sessionStore = new StorageStub();
globalThis.localStorage = localStore;
globalThis.sessionStorage = sessionStore;
globalThis.window = {
    __TAURI__: {
        core: {
            invoke: async (cmd, args) => {
                if (cmd === 'save_state' || cmd === 'load_state' || cmd === 'state_path') {
                    if (cmd === 'save_state') {
                        fileStore.data = args.data;
                        fileStore.writeCount++;
                    }
                    if (cmd === 'load_state') {
                        return { data: fileStore.data || null };
                    }
                    if (cmd === 'state_path') {
                        return '/test/path/state.json';
                    }
                }
            },
        },
    },
    addEventListener() {},
    removeEventListener() {},
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };

const fileStore = { data: null, writeCount: 0 };

const { store } = await import('../src/js/state.js');

function resetStore() {
    store.state = JSON.parse(JSON.stringify({
        apiKey: '', model: 'm', modelHint: 'm', searxngUrl: '',
        skills: {}, tasks: {},
        counters: { nextSkillSeq: 1, nextTaskSeq: 1 },
        selectedId: null, selectedType: null, activeTab: 'skills',
        searchQuery: '', showOnlyAvailable: false,
        onboardingComplete: false, tourComplete: false,
        aiHistory: [], learnHistory: [], aiDebug: false,
        memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
    }));
    sessionStore.clear();
    localStore.clear();
    fileStore.data = null;
    fileStore.writeCount = 0;
}

test('default state includes aiHistory, learnHistory, aiDebug', () => {
    assert.deepEqual(store.state.aiHistory, []);
    assert.deepEqual(store.state.learnHistory, []);
    assert.equal(store.state.aiDebug, false);
});

test('aiHistory helpers add + cap at MAX_AI_HISTORY', () => {
    resetStore();
    for (let i = 0; i < 25; i++) {
        store.appendAiHistory({ role: 'user', content: 'msg ' + i });
    }
    const h = store.getAiHistory();
    assert.equal(h.length, 20, 'should be capped at 20');
    assert.equal(h[0].content, 'msg 5', 'should keep the latest 20');
    assert.equal(h[19].content, 'msg 24');
});

test('learnHistory helpers add + cap at MAX_LEARN_HISTORY', () => {
    resetStore();
    for (let i = 0; i < 25; i++) {
        store.appendLearnHistory({ role: 'user', content: 'l ' + i });
    }
    const h = store.getLearnHistory();
    assert.equal(h.length, 20);
    assert.equal(h[0].content, 'l 5');
});

test('store writes to sessionStorage, NOT localStorage, on change', () => {
    resetStore();
    store.addSkill({ name: 'X' });
    // sessionStorage should have the state
    assert.ok(sessionStore.has('takir_session_v1'), 'sessionStorage should have takir_session_v1');
    // localStorage should be empty (or only contain the migration cleanup)
    const lsKeys = localStore.keys();
    assert.ok(!lsKeys.includes('takir_session_v1'), 'localStorage should not have takir_session_v1');
});

test('legacy localStorage keys are migrated (removed) on startup', async () => {
    const { migrateLegacyLocalStorage } = await import('../src/js/state.js');
    // Simulate legacy data that an older Takir build would have left in
    // localStorage.
    localStore.setItem('takir_state_v1', 'x');
    localStore.setItem('takir_ai_history_v1', 'x');
    localStore.setItem('takir_learn_history_v1', 'x');
    migrateLegacyLocalStorage();
    assert.equal(localStore.getItem('takir_state_v1'), null);
    assert.equal(localStore.getItem('takir_ai_history_v1'), null);
    assert.equal(localStore.getItem('takir_learn_history_v1'), null);
});

test('clearAllData: clears in-memory state', async () => {
    resetStore();
    store.addSkill({ name: 'S1' });
    store.addTask({ name: 'T1' });
    store.appendAiHistory({ role: 'user', content: 'hi' });
    store.appendLearnHistory({ role: 'user', content: 'hi' });
    store.setAiDebug(true);
    await store.clearAllData({ keepSettings: true });
    assert.equal(store.getSkills().length, 0);
    assert.equal(store.getTasks().length, 0);
    assert.equal(store.getAiHistory().length, 0);
    assert.equal(store.getLearnHistory().length, 0);
    assert.equal(store.getAiDebug(), false);
});

test('clearAllData: clears sessionStorage', async () => {
    resetStore();
    store.addSkill({ name: 'S1' });
    assert.ok(sessionStore.has('takir_session_v1'));
    await store.clearAllData({ keepSettings: true });
    assert.ok(!sessionStore.has('takir_session_v1'), 'session should be cleared');
});

test('clearAllData: writes the empty state to the file synchronously', async () => {
    resetStore();
    store.addSkill({ name: 'S1' });
    // Wait for the debounced file save to fire
    await new Promise(r => setTimeout(r, 400));
    const writesAfterAdd = fileStore.writeCount;
    assert.ok(writesAfterAdd >= 1, 'adding a skill should have written the file');
    await store.clearAllData({ keepSettings: true });
    const writesAfterClear = fileStore.writeCount;
    assert.ok(writesAfterClear > writesAfterAdd, 'clearAllData should write the file');
    // The file should now contain an empty state
    const data = JSON.parse(fileStore.data);
    assert.equal(Object.keys(data.skills || {}).length, 0);
    assert.equal(Object.keys(data.tasks || {}).length, 0);
    assert.deepEqual(data.aiHistory, []);
    assert.deepEqual(data.learnHistory, []);
});

test('clearAllData: keepSettings=false also clears api key and model', async () => {
    resetStore();
    store.setApiKey('sk-test');
    store.setModel('custom/model');
    await store.clearAllData({ keepSettings: false });
    assert.equal(store.state.apiKey, '');
    assert.equal(store.state.model, 'google/gemma-4-31b-it:free');
});

test('flushFileSave writes the current state to the file', async () => {
    resetStore();
    store.addSkill({ name: 'S1' });
    fileStore.writeCount = 0;
    await store.flushFileSave();
    assert.equal(fileStore.writeCount, 1);
    const data = JSON.parse(fileStore.data);
    assert.equal(Object.keys(data.skills).length, 1);
});

test('sessionStorage reflects state changes', () => {
    resetStore();
    store.addSkill({ name: 'A' });
    const raw = sessionStore.getItem('takir_session_v1');
    assert.ok(raw, 'sessionStorage should have data');
    const data = JSON.parse(raw);
    assert.equal(Object.keys(data.skills).length, 1);
});
