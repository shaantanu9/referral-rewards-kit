// Regenerates src/invite/template.ts from web/invite/index.html (the one source of the invite page template).
// Run from js/packages/kit-next: node scripts/gen-template.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../../../../web/invite/index.html', import.meta.url), 'utf8');
const out =
  '// Generated from web/invite/index.html (a test keeps them equal): the invite page template with {{PLACEHOLDERS}}.\n' +
  '// Works with JavaScript off when rendered by renderInvite; its small script copies the code and fetches the preview\n' +
  '// on a static host. Regenerate after editing the source: see the package README.\n' +
  `export const INVITE_TEMPLATE: string = ${JSON.stringify(html)};\n`;
writeFileSync(new URL('../src/invite/template.ts', import.meta.url), out);
