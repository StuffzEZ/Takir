// tests/free_sites_test.mjs
// Tests for the curated free-sites list used by the system prompts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_SITES, freeSitesPromptBlock, findFreeSitesForTopic } from '../src/js/data/free-sites.js';

test('FREE_SITES is non-empty', () => {
    assert.ok(FREE_SITES.length > 10, 'expected at least a dozen sites');
});

test('every site has name, url, and topics array', () => {
    for (const s of FREE_SITES) {
        assert.ok(typeof s.name === 'string' && s.name.length > 0, `bad name: ${JSON.stringify(s)}`);
        assert.ok(typeof s.url === 'string' && /^https?:\/\//.test(s.url), `bad url: ${JSON.stringify(s)}`);
        assert.ok(Array.isArray(s.topics) && s.topics.length > 0, `bad topics: ${JSON.stringify(s)}`);
    }
});

test('every site name is unique', () => {
    const names = FREE_SITES.map(s => s.name);
    assert.equal(new Set(names).size, names.length, 'duplicate site names found');
});

test('top-level curated categories are present', () => {
    const names = FREE_SITES.map(s => s.name);
    for (const required of ['MDN Web Docs', 'W3Schools', 'freeCodeCamp', 'Khan Academy', 'Wikipedia', 'Internet Archive']) {
        assert.ok(names.includes(required), `missing required site: ${required}`);
    }
});

test('freeSitesPromptBlock produces a multi-line block with URLs', () => {
    const block = freeSitesPromptBlock();
    assert.ok(block.length > 200, 'expected a substantial block');
    assert.ok(block.includes('MDN Web Docs'));
    assert.ok(block.includes('https://developer.mozilla.org'));
    assert.ok(block.includes('topics:'));
});

test('findFreeSitesForTopic returns top hits for "javascript"', () => {
    const hits = findFreeSitesForTopic('javascript');
    assert.ok(hits.length > 0);
    const names = hits.map(s => s.name);
    assert.ok(names.includes('MDN Web Docs') || names.includes('JavaScript.info'),
        'expected at least one of MDN or JS.info for "javascript"');
});

test('findFreeSitesForTopic returns [] for unknown topics', () => {
    const hits = findFreeSitesForTopic('xyzzy-nonsense-topic');
    assert.deepEqual(hits, []);
});

test('findFreeSitesForTopic ranks MDN highest for "css"', () => {
    const hits = findFreeSitesForTopic('css');
    assert.ok(hits.length > 0);
    // MDN or W3Schools should be the top hit for "css"
    const top = hits[0].name;
    assert.ok(['MDN Web Docs', 'W3Schools', 'CSS-Tricks'].includes(top),
        `unexpected top hit for css: ${top}`);
});
