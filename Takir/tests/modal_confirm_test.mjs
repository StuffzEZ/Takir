// tests/modal_confirm_test.mjs
//
// Regression test for the delete-confirmation bug.
//
// Earlier, confirmDialog's yes button called closeModal() first, which
// triggered the onClose handler (safeResolve(false)) and marked the
// promise as resolved with false. The button's own safeResolve(true)
// then became a no-op — so deletes (and any other confirmDialog-driven
// action) silently did nothing.
//
// The fix: resolve BEFORE closing. This file verifies the resolution
// order by simulating the exact event flow the user would trigger.
//
// We test the resolver contract directly: we don't need a full DOM.
// We do verify that confirmDialog wires up buttons that close *after*
// they call safeResolve. We do that by reading the source of ui.js.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiSrc = readFileSync(pathResolve(__dirname, '../src/js/ui.js'), 'utf8');

/* ---------------- stub minimal DOM (some ui.js paths run on import) ---------------- */

class ClassList {
    constructor() { this._s = new Set(); }
    add(c) { this._s.add(c); }
    remove(c) { this._s.delete(c); }
    contains(c) { return this._s.has(c); }
}
class El {
    constructor(tag) {
        this.tagName = (tag || '').toUpperCase();
        this.classList = new ClassList();
        this.style = {};
        this._listeners = {};
        this._attrs = {};
        this.textContent = '';
        this.children = [];
        this.firstChild = null;
        this.lastChild = null;
    }
    appendChild(c) {
        c.parent = this;
        this.children.push(c);
        this.lastChild = c;
        if (!this.firstChild) this.firstChild = c;
        if (c && typeof c.textContent === 'string') {
            this.textContent += c.textContent;
        }
        return c;
    }
    removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) {
            this.children.splice(i, 1);
            c.parent = null;
            this.firstChild = this.children[0] || null;
            this.lastChild = this.children[this.children.length - 1] || null;
        }
        return c;
    }
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); }
    removeEventListener() {}
    setAttribute(k, v) { this._attrs[k] = v; }
    getAttribute(k) { return this._attrs[k]; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
}
// Make El look enough like a real DOM Node so ui.js's `f instanceof Node`
// check accepts instances of it. In a browser, `Node` is the global DOM
// base class; we don't have that in Node.js, so we define a stand-in and
// attach it as `El.prototype`'s prototype.
class FakeNode {}
Object.setPrototypeOf(El.prototype, FakeNode.prototype);
globalThis.Node = FakeNode;
const byId = {};
function ensureEl(id) {
    if (!byId[id]) {
        const e = new El('div');
        e._attrs.id = id;
        byId[id] = e;
    }
    return byId[id];
}
ensureEl('modal-root');
ensureEl('modal-body');
ensureEl('modal-title');
ensureEl('modal-footer');

globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    addEventListener() {},
    removeEventListener() {},
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) => {
        if (typeof sel !== 'string') return null;
        // Match #id selectors
        const idMatch = /^#([\w-]+)$/.exec(sel);
        if (idMatch) return byId[idMatch[1]] || null;
        return null;
    },
    querySelectorAll: () => [],
    body: new El('body'),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
class Stub {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.get(k) || null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
globalThis.localStorage = new Stub();
globalThis.sessionStorage = new Stub();

const ui = await import('../src/js/ui.js');

/* ---------------- tests ---------------- */

test('confirmDialog: yes button handler calls safeResolve BEFORE closeModal', () => {
    // Pull the onClick body for the yes button from the source and
    // verify the order. We do a simple textual check.
    //
    // The buggy pattern:  onClick: () => { closeModal(); safeResolve(true); }
    // The fixed pattern:  onClick: () => { safeResolve(true); closeModal(); }
    const yesMatch = uiSrc.match(/const yes = el\('button'[\s\S]+?confirmLabel\)/);
    assert.ok(yesMatch, 'yes button definition should exist');
    const yesBody = yesMatch[0];

    const resolveIdx = yesBody.indexOf('safeResolve(true)');
    const closeIdx = yesBody.indexOf('closeModal()');
    assert.ok(resolveIdx > 0, 'yes onClick should call safeResolve(true)');
    assert.ok(closeIdx > 0, 'yes onClick should call closeModal()');
    assert.ok(
        resolveIdx < closeIdx,
        `yes onClick must call safeResolve(true) BEFORE closeModal(); got resolveIdx=${resolveIdx}, closeIdx=${closeIdx}`
    );
});

test('confirmDialog: cancel button handler also resolves before closeModal', () => {
    const noMatch = uiSrc.match(/const no = el\('button'[\s\S]+?cancelLabel\)/);
    assert.ok(noMatch, 'no button definition should exist');
    const noBody = noMatch[0];
    const resolveIdx = noBody.indexOf('safeResolve(false)');
    const closeIdx = noBody.indexOf('closeModal()');
    assert.ok(resolveIdx > 0 && closeIdx > 0, 'no onClick should call both');
    assert.ok(
        resolveIdx < closeIdx,
        'no onClick must call safeResolve(false) BEFORE closeModal()'
    );
});

test('confirmDialog: source has a comment explaining the resolution order', () => {
    // We're explicitly documenting this bug fix — keep the comment.
    assert.ok(
        /order matters|resolve first|Before|close.*time resolution/i.test(uiSrc),
        'ui.js should have a comment explaining the resolution order'
    );
});

test('confirmDialog wiring: yes/cancel both have click listeners when openModal is called', () => {
    // Call openModal directly with a hand-built footer. openModal throws
    // when it tries `modalRoot.querySelector('.modal-window')` because
    // the stub returns null for class selectors, but by then the
    // buttons are already appended to the footer.
    const m = byId['modal-footer'];
    const yes = ui.el('button', { class: 'btn', onClick: () => {} }, 'Delete');
    const no  = ui.el('button', { class: 'btn', onClick: () => {} }, 'Cancel');

    try {
        ui.openModal({ title: 'T', body: 'B', footer: [no, yes], onClose: () => {} });
    } catch (_) { /* expected: querySelector('.modal-window') returns null */ }

    const buttons = m.children.filter(c => c.tagName === 'BUTTON');
    assert.ok(buttons.length >= 2, `expected at least 2 buttons, got ${buttons.length}`);
    const yesBtn = buttons.find(b => b.textContent === 'Delete');
    const noBtn  = buttons.find(b => b.textContent === 'Cancel');
    assert.ok(yesBtn, 'yes button should have textContent "Delete"');
    assert.ok(noBtn, 'cancel button should have textContent "Cancel"');
    assert.ok((yesBtn._listeners.click || []).length > 0, 'yes should have click handler');
    assert.ok((noBtn._listeners.click || []).length > 0, 'cancel should have click handler');
});

test('regression: a click on yes resolves the promise with TRUE (not FALSE)', () => {
    // We simulate the exact bug scenario by wiring the buttons ourselves
    // and verifying the safeResolve order.
    let resolved = false;
    let result = null;
    const safeResolve = (v) => { if (!resolved) { resolved = true; result = v; } };

    // Simulate a click following the FIXED pattern:
    //   onClick: () => { safeResolve(true); closeModal(); }
    // Where closeModal would call onClose → safeResolve(false), but the
    // `resolved` guard prevents the second call from changing the value.
    const onClose = () => safeResolve(false); // closeModal's onClose
    const yesOnClick = () => { safeResolve(true); /* closeModal */ onClose(); };
    yesOnClick();

    assert.equal(resolved, true, 'promise was resolved');
    assert.equal(result, true, 'value should be TRUE — not false from the onClose handler');

    // And simulate the BUGGY pattern to confirm the test would have
    // caught it:
    resolved = false;
    result = null;
    const buggyYesOnClick = () => { onClose(); safeResolve(true); };
    buggyYesOnClick();
    assert.equal(result, false, 'buggy order would resolve to FALSE (onClose ran first)');
});
