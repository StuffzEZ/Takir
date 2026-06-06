// scripts/check_imports.mjs
// Static check: for every import { ... } from './X.js' inside src/js, verify
// the named export exists in X.js. Resolves relative paths like the browser.

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'js');

const IMPORT_RE = /import\s+(?:\*\s+as\s+\w+|\{([^}]+)\}|\w+)?\s*(?:,\s*(?:\*\s+as\s+\w+|\{([^}]+)\}|\w+))?\s*from\s*['"]([^'"]+)['"]/g;
const EXPORT_RE = /export\s+(?:async\s+)?function\s+([$\w]+)|export\s+const\s+([$\w]+)|export\s+class\s+([$\w]+)|export\s*\{([^}]+)\}|export\s+default\s+([$\w]+)/g;

async function listJs(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await listJs(p));
        else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function extractExports(src) {
    const out = new Set();
    // Walk export {...} lists (may have aliases: `foo as bar`).
    for (const m of src.matchAll(EXPORT_RE)) {
        if (m[1]) out.add(m[1]);
        else if (m[2]) out.add(m[2]);
        else if (m[3]) out.add(m[3]);
        else if (m[4]) {
            for (let item of m[4].split(',')) {
                item = item.trim();
                if (!item) continue;
                const asMatch = item.match(/([$\w]+)\s+as\s+([$\w]+)/);
                if (asMatch) out.add(asMatch[2]);
                else out.add(item);
            }
        }
        // m[5] is default — skip
    }
    return out;
}

function extractImports(src) {
    const out = [];
    for (const m of src.matchAll(IMPORT_RE)) {
        const names = (m[1] || m[2] || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!names.length) continue;
        const spec = m[3];
        out.push({ names, spec });
    }
    return out;
}

const files = await listJs(SRC);
const exportCache = new Map();
for (const f of files) {
    const src = await readFile(f, 'utf8');
    exportCache.set(f, extractExports(src));
}

const errors = [];
for (const f of files) {
    const src = await readFile(f, 'utf8');
    const imports = extractImports(src);
    for (const imp of imports) {
        if (!imp.spec.startsWith('.') && !imp.spec.startsWith('/')) continue; // skip bare/bundled
        const target = resolvePath(dirname(f), imp.spec);
        const exports = exportCache.get(target);
        if (!exports) {
            errors.push({ file: f, spec: imp.spec, missing: imp.names, reason: 'target file not found' });
            continue;
        }
        const missing = imp.names.filter(n => !exports.has(n));
        if (missing.length) {
            errors.push({ file: f, spec: imp.spec, missing });
        }
    }
}

if (errors.length === 0) {
    console.log(`OK: ${files.length} files scanned, all imports resolve.`);
    process.exit(0);
}

for (const e of errors) {
    const rel = relative(ROOT, e.file);
    console.error(`FAIL ${rel} -> ${e.spec}`);
    if (e.reason) console.error(`  ${e.reason}`);
    else for (const m of e.missing) console.error(`  missing export: ${m}`);
}
console.error(`\n${errors.length} import error(s) across ${files.length} files.`);
process.exit(1);
