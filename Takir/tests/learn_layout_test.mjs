// tests/learn_layout_test.mjs
// Regression tests for the Learn tab layout. The #learn-view element
// used to be a child of #view-container, which meant ui.js's
// clear(view-container) on the Skills / Quests tabs would remove the
// Learn view from the DOM, breaking the Learn tab after switching
// away and back. The fix is to make #learn-view a sibling of
// #view-container.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

test('index.html declares both #view-container and #learn-view', () => {
    assert.ok(html.includes('id="view-container"'), 'view-container missing');
    assert.ok(html.includes('id="learn-view"'), 'learn-view missing');
});

test('#learn-view is NOT nested inside #view-container', () => {
    const vcOpen = html.indexOf('id="view-container"');
    const lvOpen = html.indexOf('id="learn-view"');
    const vcClose = html.indexOf('</div>', vcOpen);
    assert.ok(vcOpen >= 0, 'view-container not found');
    assert.ok(lvOpen >= 0, 'learn-view not found');
    assert.ok(vcClose > vcOpen, 'view-container closing tag not found');
    // The Learn view's opening div must come AFTER the view-container's
    // closing div, otherwise the clear(view-container) call in ui.js
    // will wipe the Learn view.
    const learnInside = lvOpen > vcOpen && lvOpen < vcClose;
    assert.equal(learnInside, false, '#learn-view must not be a child of #view-container');
});

test('Learn view has all the form elements (messages, form, input, send)', () => {
    for (const id of ['learn-messages', 'learn-form', 'learn-input', 'learn-send']) {
        assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
});
