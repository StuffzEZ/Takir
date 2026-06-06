// tests/onboarding_test.mjs
// Tests for the onboarding flags in state.js + the onboarding view module.

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
const { initOnboarding, maybeShowOnboarding, replayOnboarding } = await import('../src/js/views/onboarding.js');

function resetStore() {
    store.state = {
        apiKey: '',
        model: 'google/gemma-4-31b-it:free',
        modelHint: 'google/gemma-3-27b-it:free',
        searxngUrl: '',
        skills: {},
        tasks: {},
        counters: { nextSkillSeq: 1, nextTaskSeq: 1 },
        selectedId: null,
        selectedType: null,
        activeTab: 'skills',
        searchQuery: '',
        showOnlyAvailable: false,
        onboardingComplete: false,
        tourComplete: false,
        memory: { facts: {}, notes: '', pinned: { skills: [], tasks: [] } },
    };
    try { localStorage.clear(); } catch { /* ignore */ }
}

test('default state: onboardingComplete is false', () => {
    resetStore();
    assert.equal(store.state.onboardingComplete, false);
});

test('default state: tourComplete is false', () => {
    resetStore();
    assert.equal(store.state.tourComplete, false);
});

test('markOnboardingComplete sets flag and notifies', () => {
    resetStore();
    let notified = false;
    const h = () => { notified = true; };
    store.addEventListener('change', h);
    store.markOnboardingComplete();
    assert.equal(store.state.onboardingComplete, true);
    assert.equal(notified, true);
});

test('resetOnboarding clears flag and notifies', () => {
    resetStore();
    store.state.onboardingComplete = true;
    let notified = false;
    store.addEventListener('change', () => { notified = true; });
    store.resetOnboarding();
    assert.equal(store.state.onboardingComplete, false);
    assert.equal(notified, true);
});

test('markTourComplete / resetTour work the same way', () => {
    resetStore();
    let notified = false;
    store.addEventListener('change', () => { notified = true; });
    store.markTourComplete();
    assert.equal(store.state.tourComplete, true);
    assert.equal(notified, true);
    store.resetTour();
    assert.equal(store.state.tourComplete, false);
});

test('initOnboarding is a function', () => {
    assert.equal(typeof initOnboarding, 'function');
});

test('maybeShowOnboarding is a function', () => {
    assert.equal(typeof maybeShowOnboarding, 'function');
});

test('replayOnboarding is a function', () => {
    assert.equal(typeof replayOnboarding, 'function');
});

test('clearAllData preserves onboarding/tour flags', async () => {
    resetStore();
    store.markOnboardingComplete();
    store.markTourComplete();
    await store.clearAllData({ keepSettings: true });
    assert.equal(store.state.onboardingComplete, true, 'onboarding should not be reset by clearAllData');
    assert.equal(store.state.tourComplete, true, 'tour should not be reset by clearAllData');
});
