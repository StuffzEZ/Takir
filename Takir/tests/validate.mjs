// Validation harness for pure utility functions.
// Run from project root: node Takir/tests/validate.mjs
import { toRoman, levelLabel, extractJSON, safeJSONParse, uid, bytesToHuman, clamp } from '../../Takir/src/js/utils.js';

let pass = 0, fail = 0;
function ok(name, cond, info) {
    if (cond) { pass++; console.log(`  PASS ${name}`); }
    else { fail++; console.log(`  FAIL ${name}`, info ?? ''); }
}

ok('toRoman 0 -> em-dash', toRoman(0) === '\u2014');
ok('toRoman 1 -> I', toRoman(1) === 'I');
ok('toRoman 4 -> IV', toRoman(4) === 'IV');
ok('toRoman 5 -> V', toRoman(5) === 'V');
ok('toRoman 9 -> IX', toRoman(9) === 'IX');
ok('toRoman 10 -> X', toRoman(10) === 'X');
ok('toRoman 11 -> X (clamped)', toRoman(11) === 'X');
ok('toRoman -1 -> em-dash', toRoman(-1) === '\u2014');
ok('toRoman 3.7 -> III (floor)', toRoman(3.7) === 'III');
ok('toRoman NaN -> em-dash', toRoman(NaN) === '\u2014');

ok('levelLabel 0 -> Unassessed', levelLabel(0) === 'Unassessed');
ok('levelLabel 1 -> Novice', levelLabel(1) === 'Novice');
ok('levelLabel 10 -> Legend', levelLabel(10) === 'Legend');
ok('levelLabel 11 -> Unassessed (clamp)', levelLabel(11) === 'Unassessed');

ok('safeJSONParse valid', safeJSONParse('{"a":1}')?.a === 1);
ok('safeJSONParse invalid -> null', safeJSONParse('not json') === null);
ok('safeJSONParse empty -> null', safeJSONParse('') === null);
ok('safeJSONParse null -> null', safeJSONParse(null) === null);

ok('extractJSON direct', extractJSON('{"a":1}')?.a === 1);
ok('extractJSON with prose', extractJSON('Here is the JSON: {"a":2} ok!')?.a === 2);
ok('extractJSON with nested', extractJSON('Result: {"a":{"b":3}}')?.a?.b === 3);
ok('extractJSON array', extractJSON('Numbers: [1,2,3]')?.length === 3);
ok('extractJSON strings with braces', extractJSON('{"a":"hello { world }"}')?.a === 'hello { world }');
ok('extractJSON escaped quotes', extractJSON('{"a":"he said \\"hi\\""}')?.a === 'he said "hi"');
ok('extractJSON no json -> null', extractJSON('just text') === null);

ok('uid has prefix', uid('sk').startsWith('sk_'));
ok('uid unique', uid('x') !== uid('x'));

ok('clamp low', clamp(0, 5, 10) === 5);
ok('clamp high', clamp(15, 5, 10) === 10);
ok('clamp mid', clamp(7, 5, 10) === 7);

ok('bytesToHuman 1024 -> 1.0 KB', bytesToHuman(1024) === '1.0 KB');
ok('bytesToHuman 0 -> 0 B', bytesToHuman(0) === '0 B');
ok('bytesToHuman 1.5MB', bytesToHuman(1.5 * 1024 * 1024).startsWith('1.5'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
