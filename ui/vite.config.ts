import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The widget ships as one self-contained HTML document.
 *
 * The host renders `ui://steward/app.html` in a sandboxed iframe under a strict
 * CSP: no external script, style, font or image may be fetched, and there is no
 * origin to fetch it from. `vite-plugin-singlefile` inlines the bundle and the
 * stylesheet into the emitted HTML; `scripts/build-ui.mjs` renames it to
 * `app.html` and verifies nothing external survived.
 *
 * `root` is pinned to this directory: Vite defaults it to the working directory,
 * and the build runs from the package root.
 */
export default defineConfig({
    root: import.meta.dirname,
    plugins: [react(), viteSingleFile()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        cssCodeSplit: false,
        // Belt and braces: singlefile inlines assets, and this stops anything
        // large enough to be emitted as a separate file from slipping through.
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        reportCompressedSize: false,
    },
});
