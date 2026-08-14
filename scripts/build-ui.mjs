/**
 * Bundles the MCP Apps widget into a single self-contained HTML file.
 *
 * The host renders `ui://steward/app.html` in a sandboxed iframe under a strict
 * CSP, so nothing may be loaded from an external origin — script and styles are
 * inlined into one document.
 *
 * Stage 4 may swap esbuild for Vite + React; the output contract (a single
 * `ui/dist/app.html`) stays the same.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const templatePath = join(root, 'ui/index.html');
const outputPath = join(root, 'ui/dist/app.html');
const placeholder = '<!--APP_SCRIPT-->';

const result = await build({
    entryPoints: [join(root, 'ui/src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    write: false,
    logLevel: 'warning',
});

const [output] = result.outputFiles;
if (!output) {
    throw new Error('esbuild produced no output');
}

const template = await readFile(templatePath, 'utf8');
if (!template.includes(placeholder)) {
    throw new Error(`${templatePath} is missing the ${placeholder} placeholder`);
}

// A literal `</script>` anywhere in the bundle would close the tag early.
const script = output.text.replaceAll('</script', '<\\/script');

// The replacement MUST be a function. With a string, `$&`, `$'` and friends in
// the bundle are treated as substitution patterns and silently rewritten — zod
// ships `replace(..., "\\$&")`, which would become `"\\<!--APP_SCRIPT-->"` and
// corrupt every schema built on it.
const html = template.replace(placeholder, () => `<script type="module">\n${script}\n</script>`);

if (html.includes(placeholder)) {
    throw new Error(`${placeholder} leaked into the bundle — the script injection corrupted the output`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html, 'utf8');

console.log(`ui → ${outputPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
