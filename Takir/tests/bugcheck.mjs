// Additional bug-check tests for issues found in code review.
// Run from project root: node Takir/tests/bugcheck.mjs
import { extractJSON, toRoman, levelLabel, safeJSONParse, debounce } from '../../Takir/src/js/utils.js';

let pass = 0, fail = 0;
function ok(name, cond, info) {
    if (cond) { pass++; console.log(`  PASS ${name}`); }
    else { fail++; console.log(`  FAIL ${name}`, info ?? ''); }
}

// extractJSON: edge cases
ok('extractJSON: empty', extractJSON('') === null);
ok('extractJSON: whitespace', extractJSON('   ') === null);
ok('extractJSON: unclosed brace', extractJSON('{') === null);
ok('extractJSON: garbage', extractJSON('not json at all') === null);
ok('extractJSON: trailing garbage', extractJSON('{"a":1} extra text')?.a === 1);
ok('extractJSON: deeply nested', extractJSON('Result: {"a":{"b":{"c":[1,2,3]}}}')?.a?.b?.c?.[1] === 2);
ok('extractJSON: leading whitespace + JSON', extractJSON('   \n  {"x":true}')?.x === true);
ok('extractJSON: array with strings containing braces', extractJSON('[{"a":"{}"}]')?.[0]?.a === '{}');
ok('extractJSON: array with strings containing quotes', extractJSON('[{"a":"say \\"hi\\""}]')?.[0]?.a === 'say "hi"');
ok('extractJSON: nested arrays', extractJSON('{"a":[1,[2,[3]]]}')?.a?.[1]?.[1]?.[0] === 3);
ok('extractJSON: boolean and null', extractJSON('{"a":true,"b":null}')?.a === true && extractJSON('{"a":true,"b":null}')?.b === null);
ok('extractJSON: unicode', extractJSON('{"a":"héllo 🌍"}')?.a === 'héllo 🌍');

// toRoman: extreme values
ok('toRoman: 0', toRoman(0) === '\u2014');
ok('toRoman: 10', toRoman(10) === 'X');
ok('toRoman: 100 -> X (clamp)', toRoman(100) === 'X');
ok('toRoman: -100 -> em-dash', toRoman(-100) === '\u2014');
ok('toRoman: 0.5 -> em-dash (below 1)', toRoman(0.5) === '\u2014');
ok('toRoman: Infinity -> X (clamp)', toRoman(Infinity) === 'X');

// levelLabel
ok('levelLabel: NaN -> Unassessed', levelLabel(NaN) === 'Unassessed');
ok('levelLabel: undefined -> Unassessed', levelLabel(undefined) === 'Unassessed');

// safeJSONParse
ok('safeJSONParse: number', safeJSONParse('42') === 42);
ok('safeJSONParse: bool', safeJSONParse('true') === true);
ok('safeJSONParse: undefined input', safeJSONParse(undefined) === null);
ok('safeJSONParse: number input', safeJSONParse(123) === null);
ok('safeJSONParse: object input', safeJSONParse({a: 1}) === null);

// debounce
{
    let calls = 0;
    const f = debounce(() => calls++, 20);
    f(); f(); f();
    await new Promise(r => setTimeout(r, 60));
    ok('debounce: only fires once for rapid calls', calls === 1);
}
{
    let calls = 0;
    const f = debounce((x) => { calls += x; }, 20);
    f(1); f(2); f(3);
    await new Promise(r => setTimeout(r, 60));
    ok('debounce: uses last args', calls === 3);
}
{
    let calls = 0;
    const f = debounce(() => calls++, 20);
    f();
    await new Promise(r => setTimeout(r, 30));
    f();
    await new Promise(r => setTimeout(r, 30));
    ok('debounce: separate invocations fire separately', calls === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
