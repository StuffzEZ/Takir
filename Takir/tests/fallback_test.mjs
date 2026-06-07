// tests/fallback_test.mjs
//
// Verifies the auto-fallback behaviour added to chat(): when the primary
// model is rate-limited (429) or already known to be rate-limited, chat()
// transparently retries with a fallback model instead of throwing. The
// fallback is taken from the user's state.modelHint or, if not set, the
// curated freeModels list.

import assert from 'node:assert/strict';
import { test } from 'node:test';

class Storage {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, removeEventListener() {}, __TAURI__: undefined };

const api = await import('../src/js/api.js');
const state = await import('../src/js/state.js');

/* ---------------- store-level tests ---------------- */

test('store.getFreeModels returns the curated list', () => {
    const list = state.store.getFreeModels();
    assert.ok(Array.isArray(list) && list.length >= 3, 'should have several free models');
    const ids = list.map(m => m.id);
    assert.ok(ids.includes('google/gemma-4-31b-it:free'));
    assert.ok(ids.includes('google/gemma-3-27b-it:free'));
    for (const m of list) {
        assert.ok(m.id, 'every entry has an id');
        assert.ok(m.label, 'every entry has a label');
    }
});

test('store.markRateLimited + isRateLimited round-trip', () => {
    const s = state.store;
    const before = s.isRateLimited('fake/test-model-xyz');
    assert.equal(before, false);
    s.markRateLimited('fake/test-model-xyz', 60_000);
    assert.equal(s.isRateLimited('fake/test-model-xyz'), true);
    // Cleanup
    if (s.state.rateLimited) delete s.state.rateLimited['fake/test-model-xyz'];
    assert.equal(s.isRateLimited('fake/test-model-xyz'), false);
});

test('store.isRateLimited auto-clears expired cooldowns', () => {
    const s = state.store;
    s.markRateLimited('fake/expired-test', 1); // 1ms cooldown
    return new Promise((resolve) => {
        setTimeout(() => {
            assert.equal(s.isRateLimited('fake/expired-test'), false,
                'expired cooldowns should be cleared on read');
            resolve();
        }, 30);
    });
});

test('store.pickFallbackModel excludes rate-limited + the requested model', () => {
    const s = state.store;
    // Wipe existing cooldowns
    s.state.rateLimited = {};
    // Rate-limit the first two models
    const list = s.getFreeModels();
    s.markRateLimited(list[0].id, 60_000);
    s.markRateLimited(list[1].id, 60_000);
    // Asking for a fallback from model[0] should return model[2] or later
    const picked = s.pickFallbackModel(list[0].id);
    assert.ok(picked, 'should pick a fallback');
    assert.notEqual(picked, list[0].id);
    assert.notEqual(picked, list[1].id);
    // Cleanup
    s.state.rateLimited = {};
});

test('store.pickFallbackModel returns null when everything is limited', () => {
    const s = state.store;
    s.state.rateLimited = {};
    for (const m of s.getFreeModels()) {
        s.markRateLimited(m.id, 60_000);
    }
    assert.equal(s.pickFallbackModel(), null,
        'no fallback available if every model is rate-limited');
    s.state.rateLimited = {};
});

test('store.setFreeModelIndex updates the model id and the index', () => {
    const s = state.store;
    const list = s.getFreeModels();
    s.setFreeModelIndex(1);
    assert.equal(s.state.freeModelIndex, 1);
    assert.equal(s.state.model, list[1].id);
    // Cleanup
    s.setFreeModelIndex(0);
    assert.equal(s.state.model, list[0].id);
});

test('store.setFreeModelIndex ignores out-of-range indices', () => {
    const s = state.store;
    const original = s.state.model;
    s.setFreeModelIndex(9999);
    assert.equal(s.state.model, original, 'out-of-range should be ignored');
    s.setFreeModelIndex(-2);
    assert.equal(s.state.model, original, 'negative should be ignored');
});

test('store.setModel syncs freeModelIndex when the model is in the list', () => {
    const s = state.store;
    const list = s.getFreeModels();
    s.setModel(list[2].id);
    assert.equal(s.state.freeModelIndex, 2);
    // Set a custom model
    s.setModel('some/custom-model:free');
    assert.equal(s.state.freeModelIndex, -1);
    // Reset
    s.setModel(list[0].id);
});

/* ---------------- chat() auto-fallback ---------------- */

test('chat: 429 on primary triggers fallback to modelHint', async () => {
    const originalFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        seen.push(body.model);
        if (body.model === 'primary-model:free') {
            return {
                ok: false, status: 429, statusText: 'Too Many Requests',
                headers: mapHeaders({}),
                async json() { return { error: { message: 'rate limited' } }; },
            };
        }
        // Fallback model succeeds
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: mapHeaders({}),
            async json() { return { choices: [{ message: { content: 'fallback ok' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890',
            model: 'primary-model:free',
            fallbackModel: 'fallback-model:free',
            messages: [{ role: 'user', content: 'hi' }],
            maxRetries: 0, baseBackoffMs: 1,
        });
        assert.equal(out.text, 'fallback ok');
        assert.equal(seen[0], 'primary-model:free');
        assert.ok(seen.includes('fallback-model:free'),
            'should have called the fallback at least once');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: primary that is already rate-limited is skipped (no calls made)', async () => {
    const originalFetch = globalThis.fetch;
    const s = state.store;
    s.markRateLimited('skip-me:free', 60_000);
    const seen = [];
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        seen.push(body.model);
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: mapHeaders({}),
            async json() { return { choices: [{ message: { content: 'ok' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890',
            model: 'skip-me:free',
            fallbackModel: 'use-this:free',
            messages: [{ role: 'user', content: 'hi' }],
            maxRetries: 0, baseBackoffMs: 1,
        });
        assert.equal(out.text, 'ok');
        assert.ok(!seen.includes('skip-me:free'),
            'rate-limited primary should be skipped entirely');
        assert.ok(seen.includes('use-this:free'),
            'fallback should be used immediately');
    } finally {
        globalThis.fetch = originalFetch;
        s.state.rateLimited = {};
    }
});

test('chat: when both primary and fallback fail, the error mentions both', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false, status: 429, statusText: 'Too Many Requests',
        headers: mapHeaders({}),
        async json() { return { error: { message: 'rate limited' } }; },
    });
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890',
                model: 'primary:free',
                fallbackModel: 'fallback:free',
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 0, baseBackoffMs: 1,
            }),
            /fallback.*also failed|rate limit/i,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: disableAutoFallback prevents the cascade', async () => {
    const originalFetch = globalThis.fetch;
    const s = state.store;
    s.state.rateLimited = {}; // start clean
    const seen = [];
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        seen.push(body.model);
        return {
            ok: false, status: 429, statusText: 'Too Many Requests',
            headers: mapHeaders({}),
            async json() { return { error: { message: 'rate limited' } }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890',
                model: 'primary:free',
                fallbackModel: 'fallback:free',
                disableAutoFallback: true,
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 0, baseBackoffMs: 1,
            }),
        );
        console.log('DEBUG seen:', seen);
        assert.ok(!seen.includes('fallback:free'),
            'fallback should not be called when disableAutoFallback=true');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: picks fallback from store.freeModels when no explicit fallback given', async () => {
    const originalFetch = globalThis.fetch;
    const s = state.store;
    s.state.rateLimited = {};
    // Mark the first model as rate-limited and pick the second as the
    // primary; chat() should fall back to the third.
    const list = s.getFreeModels();
    s.markRateLimited(list[0].id, 60_000);
    s.markRateLimited(list[1].id, 60_000);

    const seen = [];
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        seen.push(body.model);
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: mapHeaders({}),
            async json() { return { choices: [{ message: { content: 'ok' } }] }; },
        };
    };
    try {
        // The primary equals list[1], which is rate-limited, so chat() should
        // jump straight to list[2] (the first non-limited one).
        await api.chat({
            apiKey: 'sk-or-test-1234567890',
            model: list[1].id,
            // No fallbackModel: chat() consults the store.
            messages: [{ role: 'user', content: 'hi' }],
            maxRetries: 0, baseBackoffMs: 1,
        });
        assert.ok(!seen.includes(list[0].id));
        assert.ok(!seen.includes(list[1].id), 'rate-limited primary should be skipped');
        assert.ok(seen.includes(list[2].id), 'should call the next non-limited model');
    } finally {
        globalThis.fetch = originalFetch;
        s.state.rateLimited = {};
    }
});

/* ---------------- helpers ---------------- */

function mapHeaders(obj) {
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), String(v));
    return {
        ...m,
        get: (name) => m.get(name.toLowerCase()),
    };
}
