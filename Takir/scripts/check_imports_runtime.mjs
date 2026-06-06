// scripts/check_imports_runtime.mjs
// Runtime check: for each .js file under src/js, evaluate its imports and
// verify each named export exists. Uses ESM dynamic import to actually
// resolve the modules (catches anything the static check misses).

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'js');

const IMPORT_RE = /import\s+(?:\*\s+as\s+\w+|\{([^}]+)\}|\w+)?\s*(?:,\s*(?:\*\s+as\s+\w+|\{([^}]+)\}|\w+))?\s*from\s*['"]([^'"]+)['"]/g;

async function listJs(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await listJs(p));
        else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function extractImports(src) {
    const out = [];
    for (const m of src.matchAll(IMPORT_RE)) {
        const names = (m[1] || m[2] || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!names.length) continue;
        out.push({ names, spec: m[3] });
    }
    return out;
}

const files = await listJs(SRC);
const errors = [];

for (const f of files) {
    const src = await readFile(f, 'utf8');
    const imports = extractImports(src);
    for (const imp of imports) {
        if (!imp.spec.startsWith('.') && !imp.spec.startsWith('/')) continue;
        const target = resolvePath(dirname(f), imp.spec);
        let mod;
        try {
            mod = await import(pathToFileURL(target).href);
        } catch (e) {
            errors.push({ file: f, spec: imp.spec, error: `load failed: ${e.message}` });
            continue;
        }
        for (const name of imp.names) {
            if (!(name in mod)) {
                errors.push({ file: f, spec: imp.spec, missing: name });
            }
        }
    }
}

if (errors.length === 0) {
    console.log(`OK: ${files.length} files, all ${files.length} module loads successful, all imports resolve.`);
    process.exit(0);
}
for (const e of errors) {
    console.error(`FAIL ${relative(ROOT, e.file)} -> ${e.spec}: ${e.error || 'missing ' + e.missing}`);
}
process.exit(1);
