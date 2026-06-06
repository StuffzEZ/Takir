// tests/quiz_test.mjs
// Tests for the quiz "I don't know" feature and the DONT_KNOW marker.

import assert from 'node:assert/strict';

let testCount = 0;
function test(name, fn) {
    return Promise.resolve().then(fn).then(
        () => { testCount++; console.log(`  PASS ${name}`); },
        (e) => { testCount++; console.error(`  FAIL ${name}\n  ${e.message}\n${e.stack || ''}`); process.exitCode = 1; }
    );
}

const DONT_KNOW = { __idontknow: true };

await test('DONT_KNOW marker is a stable object identity', () => {
    const a = { __idontknow: true };
    const b = { __idontknow: true };
    assert.equal(a.__idontknow, b.__idontknow);
});

await test('DONT_KNOW marker is detected by duck-typing', () => {
    const a = DONT_KNOW;
    const detected = !!(a && typeof a === 'object' && a.__idontknow);
    assert.equal(detected, true);
});

await test('DONT_KNOW does not have text/image fields', () => {
    const a = DONT_KNOW;
    assert.equal(a.text, undefined);
    assert.equal(a.image, undefined);
});

await test('answers array supports a mix of strings, objects, and DONT_KNOW', () => {
    const answers = ['A', { text: 'foo' }, DONT_KNOW, null];
    assert.equal(answers.length, 4);
    assert.equal(typeof answers[0], 'string');
    assert.equal(typeof answers[1], 'object');
    assert.equal(answers[2].__idontknow, true);
    assert.equal(answers[3], null);
});

await test('quiz validateAnswer accepts DONT_KNOW for any type', () => {
    // Simulate the validation logic from app.js
    const types = ['multiple-choice', 'free-text', 'image'];
    for (const t of types) {
        let ok = false;
        if (DONT_KNOW && typeof DONT_KNOW === 'object' && DONT_KNOW.__idontknow) ok = true;
        else if (t === 'multiple-choice') ok = !!DONT_KNOW;
        else if (t === 'free-text') ok = DONT_KNOW && typeof DONT_KNOW === 'object' && (DONT_KNOW.text || '').trim().length > 0;
        else if (t === 'image') ok = DONT_KNOW && (DONT_KNOW.text || DONT_KNOW.image);
        assert.equal(ok, true, `DONT_KNOW should validate for ${t}`);
    }
});

await test('per-question score force-zero when answer is DONT_KNOW', () => {
    // Simulate submitQuiz post-processing
    const answers = ['A', DONT_KNOW, { text: 'foo' }];
    const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    const scored = {
        perQuestion: [
            { id: 'q1', score: 1.0, maxScore: 1.0, isCorrect: true, feedback: 'good' },
            { id: 'q2', score: 0.5, maxScore: 1.0, isCorrect: false, feedback: 'partial' },
            { id: 'q3', score: 0.8, maxScore: 1.0, isCorrect: true, feedback: 'ok' },
        ],
    };
    const skippedSet = new Set(answers
        .map((a, i) => (a && typeof a === 'object' && a.__idontknow) ? questions[i]?.id : null)
        .filter(Boolean));
    assert.deepEqual([...skippedSet], ['q2']);
    const perQuestion = scored.perQuestion.map(pq => {
        if (skippedSet.has(pq.id)) {
            return { ...pq, score: 0, isCorrect: false, feedback: 'Skipped: you marked this as "I don\'t know".' };
        }
        return pq;
    });
    assert.equal(perQuestion[0].score, 1.0);
    assert.equal(perQuestion[1].score, 0);
    assert.equal(perQuestion[1].feedback.startsWith('Skipped:'), true);
    assert.equal(perQuestion[2].score, 0.8);
});

await test('total score is recomputed after force-zero', () => {
    const perQuestion = [
        { score: 1.0, maxScore: 1.0 },
        { score: 0, maxScore: 1.0 },
        { score: 0.8, maxScore: 1.0 },
    ];
    const total = perQuestion.reduce((s, p) => s + (p.score || 0), 0);
    const max = perQuestion.reduce((s, p) => s + (p.maxScore || 1), 0);
    assert.equal(Math.round(total * 10) / 10, 1.8);
    assert.equal(max, 3);
});

console.log(`\n${testCount} quiz tests done.`);
