/**
 * Builds the MCP Apps widget into a single self-contained HTML file.
 *
 * The host renders `ui://steward/app.html` in a sandboxed iframe under a strict
 * CSP, so nothing may be loaded from an external origin — script, styles and any
 * asset are inlined into one document. Vite + React do the bundling
 * (`ui/vite.config.ts`); this script exists for the two things Vite does not do:
 * emit the file under the name the server serves, and refuse to ship a bundle
 * that would only fail later inside the iframe.
 */
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const uiRoot = join(root, 'ui');
const distDir = join(uiRoot, 'dist');
const entryPath = join(distDir, 'index.html');
const outputPath = join(distDir, 'app.html');

await build({ configFile: join(uiRoot, 'vite.config.ts'), logLevel: 'warn' });

// Vite names its output after the entry HTML; the resource URI is app.html.
await rm(outputPath, { force: true });
await rename(entryPath, outputPath);

// `crossorigin` and `rel` describe a fetch that no longer happens once the asset
// is inlined. Dropping them keeps the document honest about being self-contained.
const html = (await readFile(outputPath, 'utf8'))
    .replace(/(<(?:script|style)\b[^>]*?)\s+crossorigin(?=[\s>])/g, '$1')
    .replace(/(<style\b[^>]*?)\s+rel="stylesheet"/g, '$1');

const problems = [];

if (!html.includes('<script type="module">')) {
    problems.push('the bundle was not inlined as a module script');
}

// Any surviving reference to a file or an origin is a widget that renders blank
// in the host and works perfectly in a browser — the worst kind of bug to chase.
for (const match of html.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
    const reference = match[1];
    if (!reference.startsWith('data:') && !reference.startsWith('#')) {
        problems.push(`external reference left in the bundle: ${reference}`);
    }
}

const leftovers = (await readdir(distDir)).filter(name => name !== 'app.html' && !name.startsWith('.'));
if (leftovers.length > 0) {
    problems.push(`emitted files besides app.html: ${leftovers.join(', ')}`);
}

// Written before the verdict: reading the file is how you find out what went
// wrong, and a bundle the server refuses to serve is better than a silent one.
await writeFile(outputPath, html, 'utf8');

if (problems.length > 0) {
    throw new Error(`Widget bundle is not self-contained:\n  - ${problems.join('\n  - ')}`);
}

const { size } = await stat(outputPath);
console.log(`ui → ${outputPath} (${(size / 1024).toFixed(1)} kB)`);
