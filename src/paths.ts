import { fileURLToPath } from 'node:url';

/**
 * Package root. `src/paths.ts` and its compiled `dist/paths.js` sit one level
 * below it, so the same expression works under `tsx` and under `node dist/`.
 */
export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Single-file MCP Apps widget produced by `npm run build:ui`. */
export const UI_HTML_PATH = fileURLToPath(new URL('../ui/dist/app.html', import.meta.url));
