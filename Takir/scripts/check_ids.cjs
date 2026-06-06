const fs = require('fs');
const html = fs.readFileSync('src/index.html', 'utf8');
const checks = [
    ['onboarding-modal', html.includes('id="onboarding-modal"')],
    ['tour-overlay', html.includes('id="tour-overlay"')],
    ['bug-modal', html.includes('id="bug-modal"')],
    ['help-menu', html.includes('id="help-menu"')],
    ['btn-help', html.includes('id="btn-help"')],
    ['onboarding-key', html.includes('id="onboarding-key"')],
    ['bug-title', html.includes('id="bug-title"')],
    ['bug-what', html.includes('id="bug-what"')],
    ['bug-steps', html.includes('id="bug-steps"')],
    ['bug-expected', html.includes('id="bug-expected"')],
    ['bug-sysinfo', html.includes('id="bug-sysinfo"')],
    ['bug-cancel', html.includes('id="bug-cancel"')],
    ['bug-copy', html.includes('id="bug-copy"')],
    ['bug-open', html.includes('id="bug-open"')],
    ['onboarding-skip', html.includes('id="onboarding-skip"')],
    ['onboarding-back', html.includes('id="onboarding-back"')],
    ['onboarding-next', html.includes('id="onboarding-next"')],
    ['tour-skip', html.includes('id="tour-skip"')],
    ['tour-prev', html.includes('id="tour-prev"')],
    ['tour-next', html.includes('id="tour-next"')],
    ['help-replay-tour', html.includes('id="help-replay-tour"')],
    ['help-replay-onboarding', html.includes('id="help-replay-onboarding"')],
    ['help-report-bug', html.includes('id="help-report-bug"')],
];
let bad = 0;
for (const [k, v] of checks) {
    console.log((v ? 'OK      ' : 'MISSING ') + k);
    if (!v) bad++;
}
console.log(`\n${checks.length} checks, ${bad} missing.`);
process.exit(bad ? 1 : 0);
