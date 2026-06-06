const fs = require('fs');
const h = fs.readFileSync('src/index.html', 'utf8');
const vcOpen = h.indexOf('id="view-container"');
const lvOpen = h.indexOf('id="learn-view"');
const vcClose = h.indexOf('</div>', vcOpen);
const learnInsideView = lvOpen > vcOpen && lvOpen < vcClose;
const checks = [
    ['view-container present', h.includes('id="view-container"')],
    ['learn-view present', h.includes('id="learn-view"')],
    ['learn-view is NOT inside view-container', !learnInsideView],
    ['learn-view appears AFTER view-container close', lvOpen > vcClose],
    ['all learn form elements present', h.includes('id="learn-messages"') && h.includes('id="learn-form"') && h.includes('id="learn-input"')],
];
let bad = 0;
for (const [k, v] of checks) {
    console.log((v ? 'OK      ' : 'BAD     ') + k);
    if (!v) bad++;
}
console.log(`\n${checks.length} checks, ${bad} bad.`);
process.exit(bad ? 1 : 0);
