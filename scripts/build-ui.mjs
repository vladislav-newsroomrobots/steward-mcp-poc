/**
 * Bundles each MCP Apps widget into a single self-contained HTML file.
 *
 * The host renders a widget in a sandboxed iframe under a strict CSP, so
 * nothing may be loaded from an external origin — script and styles are inlined
 * into one document per widget.
 *
 * The stylesheet is shared and injected at build time rather than copied into
 * each template: three widgets that look like one product should not carry
 * three drifting copies of the same tokens.
 *
 * Stage 4 may swap esbuild for Vite + React; the output contract (one
 * self-contained `ui/dist/<name>.html` per widget) stays the same.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

const WIDGETS = [
    { name: 'app', template: 'ui/index.html', entry: 'ui/src/main.ts' },
    { name: 'draft', template: 'ui/draft.html', entry: 'ui/src/draft.ts' },
    { name: 'sessions', template: 'ui/sessions.html', entry: 'ui/src/sessions.ts' },
];

const SCRIPT_PLACEHOLDER = '<!--APP_SCRIPT-->';
const STYLES_PLACEHOLDER = '<!--APP_STYLES-->';

const styles = await readFile(join(root, 'ui/styles.css'), 'utf8');

for (const widget of WIDGETS) {
    const templatePath = join(root, widget.template);
    const outputPath = join(root, `ui/dist/${widget.name}.html`);

    const result = await build({
        entryPoints: [join(root, widget.entry)],
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
        throw new Error(`esbuild produced no output for ${widget.entry}`);
    }

    const template = await readFile(templatePath, 'utf8');
    for (const placeholder of [SCRIPT_PLACEHOLDER, STYLES_PLACEHOLDER]) {
        if (!template.includes(placeholder)) {
            throw new Error(`${templatePath} is missing the ${placeholder} placeholder`);
        }
    }

    // A literal `</script>` anywhere in the bundle would close the tag early.
    const script = output.text.replaceAll('</script', '<\\/script');

    // The replacement MUST be a function. With a string, `$&`, `$'` and friends
    // in the bundle are treated as substitution patterns and silently rewritten
    // — zod ships `replace(..., "\\$&")`, which would become
    // `"\\<!--APP_SCRIPT-->"` and corrupt every schema built on it.
    const html = template
        .replace(STYLES_PLACEHOLDER, () => `<style>\n${styles}\n</style>`)
        .replace(SCRIPT_PLACEHOLDER, () => `<script type="module">\n${script}\n</script>`);

    for (const placeholder of [SCRIPT_PLACEHOLDER, STYLES_PLACEHOLDER]) {
        if (html.includes(placeholder)) {
            throw new Error(`${placeholder} leaked into the bundle — the injection corrupted the output`);
        }
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, 'utf8');

    console.log(`ui → ${outputPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
}
