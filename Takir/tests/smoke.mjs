// Smoke test for state and api modules (no DOM).
// Run from project root: node Takir/tests/smoke.mjs
import * as state from '../../Takir/src/js/state.js';
import * as api from '../../Takir/src/js/api.js';

console.log('state exports:', Object.keys(state).join(', '));
console.log('api exports:', Object.keys(api).join(', '));

if (!state.store) { console.error('FAIL: state.store is missing'); process.exit(1); }
const s = state.store;
console.log('Initial state keys:', Object.keys(s.state).join(', '));
console.log('Default model:', s.state.model);
console.log('Default hint:', s.state.modelHint);

const sk = s.addSkill({ name: 'Test Swordsmanship', description: 'Wielding a blade' });
console.log('Created skill:', sk.id, sk.name, 'level:', sk.level);
const sk2 = s.addSkill({ name: 'Test Archery', description: 'Bows and arrows' });
console.log('Created skill:', sk2.id);

s.updateSkill(sk2.id, { prerequisites: [sk.id] });
const updated = s.getSkill(sk2.id);
console.log('Updated prereqs:', updated.prerequisites);

const tk = s.addTask({ name: 'Slay a dragon', description: 'big' });
console.log('Created task:', tk.id, tk.status);

s.deleteSkill(sk.id);
console.log('After delete, skills:', s.getSkills().length, 'tasks:', s.getTasks().length);

// Test dedup
const tk2 = s.addTask({ name: 'Gather herbs', description: '', prerequisites: [tk.id, tk.id, tk.id] });
const t2 = s.getTask(tk2.id);
console.log('Dedup prereqs:', t2.prerequisites);

console.log('\nAll imports OK');
