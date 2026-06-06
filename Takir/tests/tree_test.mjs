// Tree-building algorithm test.
// Run from project root: node Takir/tests/tree_test.mjs

function buildTree(items, getParents) {
    const byId = new Map(items.map(i => [i.id, { ...i, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        const parents = (getParents(node) || []).filter(p => byId.has(p));
        if (parents.length === 0) {
            roots.push(node);
        } else {
            for (const pid of parents) {
                const parent = byId.get(pid);
                if (parent) parent.children.push(node);
            }
        }
    }
    return { roots, byId };
}

let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log('  PASS', name)) : (fail++, console.log('  FAIL', name)); }

// Linear: A -> B -> C
{
    const items = [
        { id: 'A', prereq: [] },
        { id: 'B', prereq: ['A'] },
        { id: 'C', prereq: ['B'] },
    ];
    const { roots } = buildTree(items, n => n.prereq);
    ok('linear: 1 root', roots.length === 1);
    ok('linear: root is A', roots[0]?.id === 'A');
    ok('linear: A has 1 child', roots[0]?.children?.length === 1);
    ok('linear: child is B', roots[0]?.children?.[0]?.id === 'B');
    ok('linear: B has 1 child', roots[0]?.children?.[0]?.children?.[0]?.id === 'C');
}

// Two roots
{
    const items = [
        { id: 'A', prereq: [] },
        { id: 'B', prereq: [] },
    ];
    const { roots } = buildTree(items, n => n.prereq);
    ok('two roots: count', roots.length === 2);
}

// Diamond
{
    const items = [
        { id: 'A', prereq: [] },
        { id: 'B', prereq: ['A'] },
        { id: 'C', prereq: ['A'] },
        { id: 'D', prereq: ['B', 'C'] },
    ];
    const { roots } = buildTree(items, n => n.prereq);
    ok('diamond: 1 root', roots.length === 1);
    const a = roots[0];
    ok('diamond: A is root', a?.id === 'A');
    ok('diamond: A has 2 children (B, C)', a?.children?.length === 2);
    const b = a.children.find(c => c.id === 'B');
    const c = a.children.find(c => c.id === 'C');
    ok('diamond: B is child of A', !!b);
    ok('diamond: C is child of A', !!c);
    const dViaB = b?.children?.find(x => x.id === 'D');
    const dViaC = c?.children?.find(x => x.id === 'D');
    ok('diamond: D is child of B', !!dViaB);
    ok('diamond: D is child of C', !!dViaC);
}

// Cycle
{
    const items = [
        { id: 'A', prereq: ['B'] },
        { id: 'B', prereq: ['A'] },
    ];
    const { roots } = buildTree(items, n => n.prereq);
    ok('cycle: 0 roots', roots.length === 0);
}

// Self-cycle
{
    const items = [{ id: 'A', prereq: ['A'] }];
    const { roots } = buildTree(items, n => n.prereq);
    ok('self-cycle: 0 roots', roots.length === 0);
}

// Cycle + root
{
    const items = [
        { id: 'A', prereq: ['B'] },
        { id: 'B', prereq: ['A'] },
        { id: 'C', prereq: [] },
    ];
    const { roots } = buildTree(items, n => n.prereq);
    ok('cycle+root: 1 root (C)', roots.length === 1 && roots[0].id === 'C');
}

// Missing prereq becomes orphan root
{
    const items = [{ id: 'A', prereq: ['X'] }];
    const { roots } = buildTree(items, n => n.prereq);
    ok('missing prereq: orphan promoted to root', roots.length === 1 && roots[0].id === 'A');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
