// tests/retry_test.mjs
//
// Verifies the retry-with-backoff and HTTP-status-aware error handling
// added to chat() in api.js. The "quiz no work" trace was OpenRouter
// returning 429 ("Provider returned error") on the free Gemma default
// model. We now retry 408/425/429/5xx up to 3 times with exponential
// backoff, honour Retry-After, and throw a user-friendly message when
// retries are exhausted.

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

/* ---------------- Authorization header is sent ---------------- */

test('chat: Authorization header is "Bearer <key>"', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = { url, headers: opts.headers };
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: { content: 'ok' } }] }; },
        };
    };
    try {
        await api.chat({
            apiKey: 'sk-or-v1-abcdefghijklmnop',
            model: 'm', messages: [{ role: 'user', content: 'hi' }],
        });
        assert.equal(captured.headers.Authorization, 'Bearer sk-or-v1-abcdefghijklmnop');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: missing API key throws a clear error before any fetch', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, headers: new Map(), async json() { return {}; } }; };
    try {
        await assert.rejects(
            () => api.chat({ apiKey: '', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
            /API key is not set/i
        );
        assert.equal(called, false, 'fetch should not be called when key is missing');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

/* ---------------- 429 retry-with-backoff ---------------- */

test('chat: 429 triggers a retry, then succeeds', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        if (calls === 1) {
            return {
                ok: false, status: 429, statusText: 'Too Many Requests',
                headers: mapHeaders({ 'retry-after': '0' }),
                async json() { return { error: { message: 'rate limited' } }; },
            };
        }
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: { content: 'ok' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            baseBackoffMs: 1, // fast test
        });
        assert.equal(out.text, 'ok');
        assert.equal(calls, 2, 'should retry exactly once before succeeding');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: 429 gives up after maxRetries and throws a friendly message', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return {
            ok: false, status: 429, statusText: 'Too Many Requests',
            headers: mapHeaders({}),
            async json() { return { error: { message: 'Provider returned error' } }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 2, baseBackoffMs: 1,
                disableAutoFallback: true, // test the terminal error path
            }),
            /rate limit hit|OpenRouter rate limit/i
        );
        assert.equal(calls, 3, 'initial call + 2 retries = 3 total');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: 5xx is also retryable', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        if (calls < 3) {
            return {
                ok: false, status: 502, statusText: 'Bad Gateway',
                headers: mapHeaders({}),
                async json() { return { error: { message: 'upstream' } }; },
            };
        }
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: { content: 'recovered' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            baseBackoffMs: 1,
        });
        assert.equal(out.text, 'recovered');
        assert.equal(calls, 3);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: 4xx (non-retryable) is NOT retried', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return {
            ok: false, status: 404, statusText: 'Not Found',
            headers: mapHeaders({}),
            async json() { return { error: { message: 'no such model' } }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
            }),
            /model not found|Check Settings → Model/i
        );
        assert.equal(calls, 1, '4xx should not retry');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: 401 is NOT retried and tells the user to check the API key', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return {
            ok: false, status: 401, statusText: 'Unauthorized',
            headers: mapHeaders({}),
            async json() { return { error: { message: 'Invalid API key' } }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
            }),
            /rejected your API key|401/i
        );
        assert.equal(calls, 1, '401 should not retry');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: maxRetries=0 disables retries (for deterministic tests)', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return {
            ok: false, status: 500, statusText: 'Internal Server Error',
            headers: mapHeaders({}),
            async json() { return { error: { message: 'synthetic' } }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 0, disableAutoFallback: true,
            }),
        );
        assert.equal(calls, 1, 'no retries with maxRetries=0');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: honours Retry-After header (seconds)', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        if (calls === 1) {
            return {
                ok: false, status: 429, statusText: 'Too Many Requests',
                headers: mapHeaders({ 'retry-after': '0' }),
                async json() { return { error: { message: 'slow down' } }; },
            };
        }
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: { content: 'ok' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
        });
        assert.equal(out.text, 'ok');
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: empty response is retried then surfaced', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        // empty choices on every attempt
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: {} }] }; },
        };
    };
    try {
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 1, baseBackoffMs: 1,
            }),
            /no response|empty/i,
        );
        // 1 initial + 1 retry = 2
        assert.equal(calls, 2, 'should retry empty responses');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('chat: network error is retried', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        if (calls < 2) throw new TypeError('Failed to fetch');
        return {
            ok: true, status: 200, statusText: 'OK',
            headers: new Map(),
            async json() { return { choices: [{ message: { content: 'recovered' } }] }; },
        };
    };
    try {
        const out = await api.chat({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            baseBackoffMs: 1,
        });
        assert.equal(out.text, 'recovered');
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

/* ---------------- helpers ---------------- */

function mapHeaders(obj) {
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), String(v));
    // Add a no-op .get() that matches the Headers API
    return {
        ...m,
        get: (name) => m.get(name.toLowerCase()),
    };
}
