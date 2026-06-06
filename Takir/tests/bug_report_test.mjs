// tests/bug_report_test.mjs
// Tests for the bug-report view module. Only the pure functions.

import assert from 'node:assert/strict';
import { test } from 'node:test';

class StorageStub {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
globalThis.localStorage = new StorageStub();
globalThis.sessionStorage = new StorageStub();
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };

const { initBugReport, formatSystemInfoText, buildReportText, collectSystemInfo } = await import('../src/js/views/bug-report.js');
const { store } = await import('../src/js/state.js');

const sampleInfo = {
    app: 'Takir',
    platform: 'TestOS',
    userAgent: 'TestBrowser/1.0',
    screen: '1920x1080@1x',
    viewport: '1280x720',
    language: 'en',
    tauri: 'no',
    timestamp: '2025-01-01T00:00:00Z',
    model: 'google/gemma-4-31b-it:free',
    skillCount: 3,
    taskCount: 2,
    aiDebug: 'off',
};

test('initBugReport, formatSystemInfoText, buildReportText, collectSystemInfo are functions', () => {
    assert.equal(typeof initBugReport, 'function');
    assert.equal(typeof formatSystemInfoText, 'function');
    assert.equal(typeof buildReportText, 'function');
    assert.equal(typeof collectSystemInfo, 'function');
});

test('formatSystemInfoText includes all expected fields', () => {
    const text = formatSystemInfoText(sampleInfo);
    for (const key of ['App', 'Model', 'Skills', 'Quests', 'Tauri', 'AI debug', 'Platform', 'UA', 'Screen', 'Viewport', 'Language', 'Timestamp']) {
        assert.ok(text.includes(key), `missing field "${key}" in system info text:\n${text}`);
    }
});

test('buildReportText produces a markdown report with all sections', () => {
    const out = buildReportText({
        title: 'Quiz scoring is wrong',
        what: 'I scored 0 even though I got one right.',
        steps: '1. Open the app\n2. Take a quiz\n3. See wrong score',
        expected: 'I should see my real score.',
        systemInfo: sampleInfo,
    });
    assert.ok(out.startsWith('# Quiz scoring is wrong'));
    assert.ok(out.includes('## What happened?'));
    assert.ok(out.includes('I scored 0 even though I got one right.'));
    assert.ok(out.includes('## Steps to reproduce'));
    assert.ok(out.includes('1. Open the app'));
    assert.ok(out.includes('## Expected behaviour'));
    assert.ok(out.includes('## System info'));
    assert.ok(out.includes('```'));
    assert.ok(out.includes('TestBrowser/1.0'));
});

test('buildReportText omits empty sections', () => {
    const out = buildReportText({ title: '', what: '', steps: '', expected: '', systemInfo: sampleInfo });
    assert.ok(!out.includes('## What happened?'));
    assert.ok(!out.includes('## Steps to reproduce'));
    assert.ok(!out.includes('## Expected behaviour'));
    // System info is always included.
    assert.ok(out.includes('## System info'));
});

test('buildReportText URL-safe: no newlines in title section', () => {
    const out = buildReportText({
        title: 'My title',
        what: 'x',
        steps: '1. y',
        expected: 'z',
        systemInfo: sampleInfo,
    });
    // Each line is its own row.
    const lines = out.split('\n');
    assert.ok(lines[0] === '# My title');
});

test('collectSystemInfo reads from the store if populated', () => {
    store.state.model = 'some/model';
    store.state.skills = { a: 1, b: 2, c: 3 };
    store.state.tasks = { x: 1 };
    const info = collectSystemInfo();
    assert.equal(info.model, 'some/model');
    assert.equal(info.skillCount, 3);
    assert.equal(info.taskCount, 1);
});

test('collectSystemInfo handles empty store gracefully', () => {
    store.state.model = 'google/gemma-4-31b-it:free';
    store.state.skills = {};
    store.state.tasks = {};
    const info = collectSystemInfo();
    assert.equal(info.app, 'Takir');
    assert.ok(typeof info.timestamp === 'string' && info.timestamp.length > 0);
    assert.equal(info.skillCount, 0);
    assert.equal(info.taskCount, 0);
});
