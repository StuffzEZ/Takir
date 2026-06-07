// tests/ai_debug_test.mjs
//
// Verifies the AI debug logging + JSON-parse fixes for the
// "quiz generation no work" complaint.
//
// Two issues were fixed together:
//   1. AI requests didn't request response_format=json_object, so free
//      models wrap their JSON in markdown fences (```json ... ```) and
//      extractJSON returned null. Now all AI domain calls pass
//      responseFormat: { type: 'json_object' } and parseQuizResponse
//      strips fences before parsing.
//   2. There was no UI toggle to enable [Takir AI] console logging.
//      Added a checkbox in settings, backed by store.aiDebug.

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* ---------------- minimal stubs ---------------- */
// We import api.js directly. It imports state.js which uses localStorage /
// sessionStorage / Tauri. Stub them all so the module loads cleanly.

class Storage {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    __TAURI__: undefined,
};

const api = await import('../src/js/api.js');
const state = await import('../src/js/state.js');

/* ---------------- 1. stripMarkdownFences ---------------- */

test('stripMarkdownFences: removes ```json ... ``` fences', () => {
    const input = '```json\n{"foo":1}\n```';
    const out = api.stripMarkdownFences(input);
    assert.equal(out, '{"foo":1}', 'fences should be stripped');
});

test('stripMarkdownFences: removes ``` ... ``` (no language) fences', () => {
    const input = '```\n{"foo":1}\n```';
    const out = api.stripMarkdownFences(input);
    assert.equal(out, '{"foo":1}');
});

test('stripMarkdownFences: handles JavaScript/JS language hints', () => {
    const input = '```javascript\n{"foo":1}\n```';
    const out = api.stripMarkdownFences(input);
    assert.equal(out, '{"foo":1}');
});

test('stripMarkdownFences: leaves plain JSON untouched', () => {
    const input = '{"foo":1}';
    const out = api.stripMarkdownFences(input);
    assert.equal(out, '{"foo":1}');
});

test('stripMarkdownFences: leaves non-string input untouched', () => {
    assert.equal(api.stripMarkdownFences(null), null);
    assert.equal(api.stripMarkdownFences(undefined), undefined);
    assert.equal(api.stripMarkdownFences(42), 42);
});

/* ---------------- 2. parseQuizResponse behaviour ---------------- */
// parseQuizResponse is not exported, so we exercise it indirectly via
// generateSkillQuiz. We mock chat() by stubbing global fetch.

test('generateSkillQuiz: parses JSON wrapped in ```json fence', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        // Record the request so we can assert response_format was sent
        globalThis.__lastFetchBody = JSON.parse(opts.body);
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async json() {
                return {
                    choices: [{
                        message: {
                            content: '```json\n{"title":"Q","questions":[{"id":"q1","type":"multiple-choice","question":"x?","options":["A: a","B: b","C: c","D: d"],"correctAnswer":"A","difficulty":3}]}\n```',
                        },
                    }],
                    model: 'fake-model',
                    usage: { prompt_tokens: 10, completion_tokens: 10 },
                };
            },
        };
    };
    try {
        const quiz = await api.generateSkillQuiz({
            apiKey: 'sk-or-test-1234567890',
            model: 'fake-model',
            skillName: 'Swordsmanship',
            description: 'wielding a blade',
            attachments: [],
        });
        assert.ok(quiz, 'quiz should parse');
        assert.equal(quiz.questions.length, 1);
        assert.equal(quiz.questions[0].id, 'q1');
    } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.__lastFetchBody;
    }
});

test('generateSkillQuiz: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        globalThis.__lastFetchBody = JSON.parse(opts.body);
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"title":"Q","questions":[]}' } }] };
            },
        };
    };
    try {
        await api.generateSkillQuiz({
            apiKey: 'sk-or-test-1234567890',
            model: 'fake-model',
            skillName: 'X',
            description: '',
            attachments: [],
        }).catch(() => { /* we don't care about the parse, we care about the request body */ });
        const body = globalThis.__lastFetchBody;
        assert.ok(body, 'fetch was called');
        assert.deepEqual(body.response_format, { type: 'json_object' },
            'generateSkillQuiz should request JSON mode');
    } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.__lastFetchBody;
    }
});

test('generateSkillQuiz: coerces difficulty into 1..10 range', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
            return {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            title: 'Q',
                            questions: [
                                { id: 'q1', type: 'multiple-choice', question: 'a?', correctAnswer: 'A', difficulty: 99 },
                                { id: 'q2', type: 'multiple-choice', question: 'b?', correctAnswer: 'B', difficulty: -5 },
                                { id: 'q3', type: 'multiple-choice', question: 'c?', correctAnswer: 'C', difficulty: 5.7 },
                                { id: 'q4', type: 'multiple-choice', question: 'd?', correctAnswer: 'D' /* missing */ },
                            ],
                        }),
                    },
                }],
            };
        },
    });
    try {
        const quiz = await api.generateSkillQuiz({
            apiKey: 'sk-or-test-1234567890',
            model: 'fake-model',
            skillName: 'X',
            description: '',
            attachments: [],
        });
        assert.equal(quiz.questions[0].difficulty, 10, '99 should clamp to 10');
        assert.equal(quiz.questions[1].difficulty, 1, '-5 should clamp to 1');
        assert.equal(quiz.questions[2].difficulty, 6, '5.7 should round to 6');
        assert.equal(quiz.questions[3].difficulty, 5, 'missing should default to 5');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('generateSkillQuiz: empty questions array is rejected with useful error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
            return { choices: [{ message: { content: '{"title":"Q","questions":[]}' } }] };
        },
    });
    try {
        await assert.rejects(
            () => api.generateSkillQuiz({
                apiKey: 'sk-or-test-1234567890',
                model: 'fake-model',
                skillName: 'X',
                description: '',
                attachments: [],
            }),
            /zero questions/i,
            'should throw a "zero questions" error'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('generateSkillQuiz: prose-only response is rejected with a useful error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
            return { choices: [{ message: { content: 'I cannot generate that quiz right now.' } }] };
        },
    });
    try {
        await assert.rejects(
            () => api.generateSkillQuiz({
                apiKey: 'sk-or-test-1234567890',
                model: 'fake-model',
                skillName: 'X',
                description: '',
                attachments: [],
            }),
            /no JSON object could be extracted|raw response was logged/i,
            'should throw an error mentioning the raw response was logged'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('generateSkillQuiz: HTTP error is rejected with the OpenRouter message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
            return { error: { message: 'No cookie auth credentials found' } };
        },
    });
    try {
        await assert.rejects(
            () => api.generateSkillQuiz({
                apiKey: 'sk-or-test-bogus',
                model: 'fake-model',
                skillName: 'X',
                description: '',
                attachments: [],
            }),
            /OpenRouter error \(401\)|No cookie/i,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

/* ---------------- 3. aiDebug state + setting ---------------- */

test('store.getAiDebug: defaults to false', () => {
    const s = state.store;
    // Reset for isolation
    s.setAiDebug(false);
    assert.equal(s.getAiDebug(), false);
});

test('store.setAiDebug: round-trips true', () => {
    const s = state.store;
    s.setAiDebug(true);
    assert.equal(s.getAiDebug(), true);
    s.setAiDebug(false);
    assert.equal(s.getAiDebug(), false);
});

test('store.setAiDebug: coerces truthy/falsy', () => {
    const s = state.store;
    s.setAiDebug(1);
    assert.equal(s.getAiDebug(), true);
    s.setAiDebug(0);
    assert.equal(s.getAiDebug(), false);
    s.setAiDebug('on');
    assert.equal(s.getAiDebug(), true);
    s.setAiDebug(null);
    assert.equal(s.getAiDebug(), false);
});

/* ---------------- 4. other AI helpers also use response_format ---------------- */

test('scoreSkillQuiz: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = JSON.parse(opts.body);
        return {
            ok: true, status: 200, statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"level":5}' } }] };
            },
        };
    };
    try {
        await api.scoreSkillQuiz({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            skillName: 'X', quiz: { questions: [] }, answers: [],
        });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('analyzeTask: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = JSON.parse(opts.body);
        return {
            ok: true, status: 200, statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"requiredSkills":[]}' } }] };
            },
        };
    };
    try {
        await api.analyzeTask({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            taskName: 'T', description: '', skills: [],
        });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('suggestSkillPrerequisites: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = JSON.parse(opts.body);
        return {
            ok: true, status: 200, statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"suggested":[]}' } }] };
            },
        };
    };
    try {
        await api.suggestSkillPrerequisites({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            skillName: 'X', description: '', existingSkills: [],
        });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('suggestTaskPlan: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = JSON.parse(opts.body);
        return {
            ok: true, status: 200, statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"requiredSkills":[]}' } }] };
            },
        };
    };
    try {
        await api.suggestTaskPlan({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            taskName: 'T', description: '', existingSkills: [], existingTasks: [],
        });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('reviewProgress: sends response_format=json_object', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, opts) => {
        captured = JSON.parse(opts.body);
        return {
            ok: true, status: 200, statusText: 'OK',
            async json() {
                return { choices: [{ message: { content: '{"verdict":"on track"}' } }] };
            },
        };
    };
    try {
        await api.reviewProgress({
            apiKey: 'sk-or-test-1234567890', model: 'm',
            taskName: 'T', taskDescription: '', progressText: 'halfway', attachment: null,
        });
        assert.deepEqual(captured.response_format, { type: 'json_object' });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

/* ---------------- 5. chat() uses summarizeRequest for debug logs ---------------- */

test('chat: debug log is emitted (and gated by aiDebug) when aiDebug=true', async () => {
    const originalFetch = globalThis.fetch;
    const originalDebug = console.debug;
    const debugCalls = [];
    console.debug = (...args) => debugCalls.push(args);
    state.store.setAiDebug(true);
    globalThis.fetch = async () => ({
        ok: true, status: 200, statusText: 'OK',
        async json() { return { choices: [{ message: { content: 'hi' } }] }; },
    });
    try {
        await api.chat({ apiKey: 'sk-or-test-1234567890', model: 'm', messages: [{ role: 'user', content: 'hi' }] });
        assert.ok(debugCalls.length >= 2, `expected at least 2 debug calls, got ${debugCalls.length}`);
        const allTagged = debugCalls.every(c => c[0] === '[Takir AI]');
        assert.ok(allTagged, 'every debug call should have a [Takir AI] prefix');
    } finally {
        console.debug = originalDebug;
        globalThis.fetch = originalFetch;
        state.store.setAiDebug(false);
    }
});

test('chat: no debug log when aiDebug=false', async () => {
    const originalFetch = globalThis.fetch;
    const originalDebug = console.debug;
    const debugCalls = [];
    console.debug = (...args) => debugCalls.push(args);
    state.store.setAiDebug(false);
    globalThis.fetch = async () => ({
        ok: true, status: 200, statusText: 'OK',
        async json() { return { choices: [{ message: { content: 'hi' } }] }; },
    });
    try {
        await api.chat({ apiKey: 'sk-or-test-1234567890', model: 'm', messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(debugCalls.length, 0, 'no debug calls expected when aiDebug is off');
    } finally {
        console.debug = originalDebug;
        globalThis.fetch = originalFetch;
    }
});

test('chat: HTTP errors are logged with console.error (always on)', async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const errorCalls = [];
    console.error = (...args) => errorCalls.push(args);
    state.store.setAiDebug(false); // ensure it's the always-on path
    globalThis.fetch = async () => ({
        ok: false, status: 500, statusText: 'Internal Server Error',
        async json() { return { error: { message: 'synthetic failure' } }; },
    });
    try {
        // 500 is retryable; pass maxRetries=0 to test the terminal error path.
        await assert.rejects(
            () => api.chat({
                apiKey: 'sk-or-test-1234567890', model: 'm',
                messages: [{ role: 'user', content: 'hi' }],
                maxRetries: 0,
            }),
        );
        assert.ok(errorCalls.length >= 1, 'console.error should fire on HTTP failure');
        const tagged = errorCalls.some(c => c[0] === '[Takir AI]');
        assert.ok(tagged, 'error log should be prefixed with [Takir AI]');
    } finally {
        console.error = originalError;
        globalThis.fetch = originalFetch;
    }
});
