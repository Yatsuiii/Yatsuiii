// Builds dist/index.html: the page template with styles, atlas, plates, core and app inlined, so the
// published artifact is one self-contained page. Also copies the two example worlds beside it, and
// writes dist/inkwash-offline.html: the same studio as a whole document that opens from a file, with
// the examples inside it (a page opened from a file can't fetch them). The offline copy has no
// Claude and keeps everything in the browser it is opened in.
// And the trial pages, to publish as artifacts of their own (see ../TRIAL_SETUP.md):
// dist/inkwash-trial.html keeps each person's worlds in their own space in the store, which the
// copy's published rules keep from everyone else; dist/inkwash-trial-shared.html keeps them in
// the copy's studio, which its owner can read, for a copy made for one person.
// Both carry the examples inside and publish nothing.
// Run: node inkwash/v0/build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), 'utf8');
const js = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let page = read('./src/page.html');
const parts = {
  '<!-- STYLES -->': `<style>\n${read('./src/styles.css')}</style>`,
  '<!-- ATLAS -->': `<script>\n${js(read('./src/atlas.js'))}</script>`,
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
copyFileSync(here('./dream-example.json'), here('./dist/dream-example.json'));
console.log(`dist/index.html ${(page.length / 1024).toFixed(1)} KB`);

const examples = {
  'example-world.json': JSON.parse(read('./example-world.json')),
  'dream-example.json': JSON.parse(read('./dream-example.json')),
};
const inside = `<script>window.INKWASH_EXAMPLES = ${js(JSON.stringify(examples))};</script>\n`;
const offline = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  + page.replace('<script>', () => inside + '<script>')
  + '</html>\n';
writeFileSync(here('./dist/inkwash-offline.html'), offline);
console.log(`dist/inkwash-offline.html ${(offline.length / 1024).toFixed(1)} KB`);

for (const [file, store] of [['inkwash-trial.html', 'self'], ['inkwash-trial-shared.html', 'shared']]) {
  if (!page.startsWith('<title>Inkwash</title>')) throw new Error('the trial pages rename the page by its title');
  const trial = page.replace('<title>Inkwash</title>', '<title>Inkwash trial</title>')
    .replace('<script>', () => inside + `<script>window.INKWASH_TRIAL = ${JSON.stringify({ store })};</script>\n<script>`);
  writeFileSync(here('./dist/' + file), trial);
  console.log(`dist/${file} ${(trial.length / 1024).toFixed(1)} KB`);
}
