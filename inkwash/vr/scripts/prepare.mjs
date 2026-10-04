// Copies what the page shares with the studio into public/, where Vite serves it as-is:
// Inkwash's core and atlas (loaded as plain scripts, exactly as the studio loads them) and the
// dreamed example world. Run before `vite` and `vite build`.
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
mkdirSync(here('../public/lib'), { recursive: true });
mkdirSync(here('../public/worlds'), { recursive: true });
copyFileSync(here('../../v0/src/core.js'), here('../public/lib/core.js'));
copyFileSync(here('../../v0/src/atlas.js'), here('../public/lib/atlas.js'));
copyFileSync(here('../../v0/dream-example.json'), here('../public/worlds/drained-sea.json'));
console.log('public/: core.js, atlas.js, worlds/drained-sea.json');
