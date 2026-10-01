// The example world as db documents ({path: body}), the layout the studio reads.
// Used to seed the published artifact and by the end-to-end test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function exampleDocs(wid) {
  const ex = JSON.parse(readFileSync(fileURLToPath(new URL('../example-world.json', import.meta.url)), 'utf8'));
  const docs = {};
  docs[`studio/${wid}`] = { ...ex.world, id: wid };
  for (const e of ex.entities) docs[`studio/${wid}/canon/${e.id}`] = e;
  for (const c of ex.chapters) docs[`studio/${wid}/chapters/${c.id}`] = c;
  for (const p of ex.passages) docs[`studio/${wid}/passages/${p.id}`] = p;
  for (const s of ex.seeds) docs[`studio/${wid}/seeds/${s.id}`] = s;
  return docs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wid = process.argv[2] || 'w_hollow_moon';
  process.stdout.write(JSON.stringify(exampleDocs(wid)) + '\n');
}
