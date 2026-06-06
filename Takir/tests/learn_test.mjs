// tests/learn_test.mjs
// Smoke tests for the Learn view module — just verify the exports and
// system prompt are well-formed, since the chat UI itself needs a browser.

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
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };

const { initLearnPanel, LEARN_SYSTEM_PROMPT } = await import('../src/js/views/learn.js');

test('initLearnPanel is a function', () => {
    assert.equal(typeof initLearnPanel, 'function');
});

test('LEARN_SYSTEM_PROMPT exists and is a non-empty string', () => {
    assert.equal(typeof LEARN_SYSTEM_PROMPT, 'string');
    assert.ok(LEARN_SYSTEM_PROMPT.length > 500);
});

test('LEARN_SYSTEM_PROMPT: teaching style, persona, and free sites', () => {
    assert.ok(LEARN_SYSTEM_PROMPT.includes('Tak'), 'persona name should be present');
    assert.ok(LEARN_SYSTEM_PROMPT.includes('TEACHING STYLE'));
    assert.ok(LEARN_SYSTEM_PROMPT.includes('FREE RESOURCES FIRST'));
    assert.ok(LEARN_SYSTEM_PROMPT.includes('RECOMMENDED FREE LEARNING SITES') === false,
        'learn prompt should not mention "RECOMMENDED FREE LEARNING SITES" — that is for the management prompt');
    assert.ok(LEARN_SYSTEM_PROMPT.includes('MDN Web Docs'));
    assert.ok(LEARN_SYSTEM_PROMPT.includes('W3Schools'));
    assert.ok(LEARN_SYSTEM_PROMPT.includes('freeCodeCamp'));
});

test('LEARN_SYSTEM_PROMPT: mentions web search and fetch as fallbacks', () => {
    assert.ok(LEARN_SYSTEM_PROMPT.includes('web_search') || LEARN_SYSTEM_PROMPT.includes('web search'),
        'should reference web search as a fallback');
    assert.ok(LEARN_SYSTEM_PROMPT.includes('web_fetch') || LEARN_SYSTEM_PROMPT.includes('web fetch'),
        'should reference web fetch as a fallback');
});

test('LEARN_SYSTEM_PROMPT: asks the AI to sign off as "— Tak"', () => {
    assert.ok(LEARN_SYSTEM_PROMPT.includes('— Tak'));
});
