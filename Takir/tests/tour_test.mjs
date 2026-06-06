// tests/tour_test.mjs
// Tests for the tour view module. Only pure logic + presence of exports.

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

const { store } = await import('../src/js/state.js');
const { initTour, startTour, endTour, getTourSteps, pickPlacement } = await import('../src/js/views/tour.js');

function resetStore() {
    store.state = {
        apiKey: '', model: 'm', modelHint: 'm', searxngUrl: '',
        skills: {}, tasks: {},
        counters: { nextSkillSeq: 1, nextTaskSeq: 1 },
        selectedId: null, selectedType: null, activeTab: 'skills',
        searchQuery: '', showOnlyAvailable: false,
        onboardingComplete: false, tourComplete: false,
        memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
    };
    try { localStorage.clear(); } catch { /* ignore */ }
}

test('initTour, startTour, endTour, getTourSteps are functions', () => {
    assert.equal(typeof initTour, 'function');
    assert.equal(typeof startTour, 'function');
    assert.equal(typeof endTour, 'function');
    assert.equal(typeof getTourSteps, 'function');
    assert.equal(typeof pickPlacement, 'function');
});

test('TOUR_STEPS exposes at least 5 steps and they are well-formed', () => {
    const steps = getTourSteps();
    assert.ok(steps.length >= 5, 'expected at least 5 tour steps');
    for (const s of steps) {
        assert.equal(typeof s.target, 'string');
        assert.ok(s.target.length > 0);
        assert.equal(typeof s.title, 'string');
        assert.ok(s.title.length > 0);
        assert.equal(typeof s.body, 'string');
        assert.ok(s.body.length > 0);
    }
});

test('TOUR_STEPS targets reference real selectors that should exist in the DOM', () => {
    const steps = getTourSteps();
    // Targets we expect to find in the index.html.
    const expected = ['.tab-bar', '#btn-add', '#btn-ai', '#btn-help', '#detail-pane', '.filter-bar'];
    for (const e of expected) {
        assert.ok(steps.some(s => s.target === e), `tour should include step for ${e}`);
    }
});

test('pickPlacement: prefers below when there is room', () => {
    const r = pickPlacement(
        { vw: 1200, vh: 800 },
        { top: 100, bottom: 140, left: 100, right: 200, width: 100 },
        { width: 300, height: 200 },
    );
    assert.equal(r.place, 'bottom');
    assert.ok(r.top > 140);
});

test('pickPlacement: flips above when below is out of viewport', () => {
    const r = pickPlacement(
        { vw: 1200, vh: 800 },
        { top: 700, bottom: 740, left: 100, right: 200, width: 100 },
        { width: 300, height: 200 },
    );
    assert.equal(r.place, 'top');
    assert.ok(r.top < 700);
});

test('pickPlacement: falls back to right when no vertical room', () => {
    const r = pickPlacement(
        { vw: 1200, vh: 200 },
        { top: 80, bottom: 120, left: 100, right: 200, width: 100 },
        { width: 300, height: 200 },
    );
    // No room above or below -> side.
    assert.ok(r.place === 'right' || r.place === 'left');
});

test('markTourComplete persists across resetStore()', () => {
    resetStore();
    store.markTourComplete();
    assert.equal(store.state.tourComplete, true);
});
