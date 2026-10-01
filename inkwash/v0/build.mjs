// Builds dist/index.html: the page template with styles, plates, core and app inlined, so the published
// artifact is one self-contained page. Also copies the example world beside it.
// Run: node inkwash/v0/build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), 'utf8');
const js = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let page = read('./src/page.html');
const parts = {
  '<!-- STYLES -->': `<style>\n${read('./src/styles.css')}</style>`,
  '<!-- PLATES -->': `<script>\n${js(read('./src/plates.js'))}</script>`,
  '<!-- CORE -->': `<script>\n${js(read('./src/core.js'))}</script>`,
  '<!-- APP -->': `<script>\n${js(read('./src/app.js'))}</script>`,
};
for (const [mark, body] of Object.entries(parts)) {
  if (!page.includes(mark)) throw new Error(`template is missing ${mark}`);
  page = page.replace(mark, () => body);
}
if (!/^<title>[^<]+<\/title>/.test(page)) throw new Error('the page must start with its <title>');
mkdirSync(here('./dist'), { recursive: true });
writeFileSync(here('./dist/index.html'), page);
copyFileSync(here('./example-world.json'), here('./dist/example-world.json'));
console.log(`dist/index.html ${(page.length / 1024).toFixed(1)} KB`);
