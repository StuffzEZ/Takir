// tests/io_test.mjs
// Tests for src/js/io.js: export round-trip, payload validation, import
// replaces state, and bad-input handling.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildExportData, exportToJsonString, validateImportPayload, applyImportedData, readFileAsJson, importFromFile, TAKIR_FORMAT, TAKIR_VERSION } from '../src/js/io.js';
import { store } from '../src/js/state.js';

function resetStore() {
    store.state = {
        skills: {},
        tasks: {},
        counters: { nextSkillSeq: 1, nextTaskSeq: 1 },
        memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
        activeTab: 'skills',
        searchQuery: '',
        apiKey: '',
        model: '',
        modelHint: '',
        searxngUrl: '',
    };
    try { localStorage.clear(); } catch { /* ignore */ }
}

function makeFile(content) {
    return new File([content], 'test.takir', { type: 'application/json' });
}

test('TAKIR_FORMAT and TAKIR_VERSION are stable', () => {
    assert.equal(TAKIR_FORMAT, 'takir');
    assert.equal(TAKIR_VERSION, 1);
});

test('buildExportData wraps state in a versioned envelope', () => {
    resetStore();
    store.addSkill({ name: 'Swordplay', description: '' });
    const env = buildExportData();
    assert.equal(env.format, TAKIR_FORMAT);
    assert.equal(env.version, TAKIR_VERSION);
    assert.ok(typeof env.exportedAt === 'string');
    assert.ok(env.data.skills && typeof env.data.skills === 'object');
    assert.equal(Object.keys(env.data.skills).length, 1);
});

test('exportToJsonString returns a parseable JSON string', () => {
    resetStore();
    store.addSkill({ name: 'Archery', description: '' });
    const json = exportToJsonString();
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, TAKIR_FORMAT);
});

test('apiKey is sanitized by default', () => {
    resetStore();
    store.setApiKey('sk-or-secret');
    const env = buildExportData();
    assert.equal(env.data.apiKey, '');
});

test('apiKey is preserved when includeApiKey is true', () => {
    resetStore();
    store.setApiKey('sk-or-secret');
    const env = buildExportData({ includeApiKey: true });
    assert.equal(env.data.apiKey, 'sk-or-secret');
});

test('validateImportPayload accepts a good envelope', () => {
    const good = { format: 'takir', version: 1, exportedAt: 'now', data: { skills: [] } };
    const r = validateImportPayload(good);
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, good.data);
});

test('validateImportPayload rejects non-object input', () => {
    assert.equal(validateImportPayload(null).ok, false);
    assert.equal(validateImportPayload(undefined).ok, false);
    assert.equal(validateImportPayload('hi').ok, false);
});

test('validateImportPayload rejects wrong format', () => {
    assert.equal(validateImportPayload({ format: 'other', version: 1, data: {} }).ok, false);
});

test('validateImportPayload rejects missing version', () => {
    assert.equal(validateImportPayload({ format: 'takir', data: {} }).ok, false);
});

test('validateImportPayload rejects missing data', () => {
    assert.equal(validateImportPayload({ format: 'takir', version: 1 }).ok, false);
});

test('applyImportedData replaces the store state and notifies', () => {
    resetStore();
    let notified = false;
    const handler = () => { notified = true; };
    store.addEventListener('change', handler);
    try {
        applyImportedData({
            skills: [{ id: 's1', name: 'Imported Skill', description: 'd', level: 0, prerequisites: [] }],
            tasks: [{ id: 't1', name: 'Imported Quest', description: '', status: 'pending', prerequisites: [], subtasks: [], requiredSkills: [] }],
            memory: { facts: { fav: 'tea' }, notes: 'n', pinned: { skills: ['s1'], tasks: [] } },
            activeTab: 'tasks',
            apiKey: 'imported-key',
        });
        const s = store.getSkills();
        const t = store.getTasks();
        assert.equal(s.length, 1);
        assert.equal(s[0].name, 'Imported Skill');
        assert.equal(t.length, 1);
        assert.equal(t[0].name, 'Imported Quest');
        assert.equal(store.getMemory().facts.fav, 'tea');
        assert.equal(store.state.activeTab, 'tasks');
        assert.equal(store.state.apiKey, 'imported-key');
        assert.equal(notified, true);
    } finally {
        store.removeEventListener('change', handler);
    }
});

test('applyImportedData fills defaults for missing fields', () => {
    resetStore();
    applyImportedData({});
    assert.deepEqual(store.getSkills(), []);
    assert.deepEqual(store.getTasks(), []);
    assert.deepEqual(store.getMemory().facts, {});
    assert.equal(store.getMemory().notes, '');
    assert.deepEqual(store.getMemory().pinned, { skills: [], tasks: [] });
});

test('readFileAsJson parses valid JSON', async () => {
    const f = makeFile('{"a":1}');
    const parsed = await readFileAsJson(f);
    assert.deepEqual(parsed, { a: 1 });
});

test('readFileAsJson rejects invalid JSON', async () => {
    const f = makeFile('not json');
    await assert.rejects(() => readFileAsJson(f), /valid JSON/);
});

test('importFromFile replaces state end-to-end', async () => {
    resetStore();
    store.addSkill({ name: 'Old', description: '' });
    const payload = {
        format: 'takir',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
            skills: [{ id: 'x', name: 'New', description: '', level: 0, prerequisites: [] }],
            tasks: [],
            memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
            apiKey: 'kept',
        },
    };
    const f = makeFile(JSON.stringify(payload));
    const res = await importFromFile(f, { clearAiHistory: false });
    assert.equal(res.ok, true);
    assert.equal(store.getSkills().length, 1);
    assert.equal(store.getSkills()[0].name, 'New');
});

test('importFromFile rejects bad envelopes', async () => {
    resetStore();
    const f = makeFile(JSON.stringify({ format: 'wrong', version: 1, data: {} }));
    await assert.rejects(() => importFromFile(f), /format/i);
});

test('export -> import round-trip preserves skills, tasks, and memory', () => {
    resetStore();
    store.addSkill({ name: 'Round', description: 'd', level: 3, prerequisites: [] });
    store.rememberFact('color', 'blue');
    store.appendMemoryNote('first note');
    const json = exportToJsonString();
    const parsed = JSON.parse(json);

    resetStore();
    assert.equal(store.getSkills().length, 0);
    assert.equal(store.getMemory().notes, '');

    const r = validateImportPayload(parsed);
    assert.equal(r.ok, true);
    applyImportedData(r.data);
    assert.equal(store.getSkills().length, 1);
    assert.equal(store.getSkills()[0].name, 'Round');
    assert.equal(store.getMemory().facts.color, 'blue');
    assert.ok(store.getMemory().notes.includes('first note'));
});
