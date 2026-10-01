// Builds example-world.json: "The Hollow Moon", a small world that shows every state Inkwash has.
// Painted with the same core functions the studio uses. Run: node inkwash/v0/tools/make-example.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const C = require('../src/core.js');
const PL = require('../src/plates.js');
const N = C.SAMPLES;
const T = (s) => Date.parse(s);

const t0 = T('2026-09-27T18:00:00Z');
const tSet1 = T('2026-09-28T20:14:00Z');
const tSet2 = T('2026-09-29T21:03:00Z');
const tAge = T('2026-09-30T09:12:00Z');
const tInk3 = T('2026-09-30T22:40:00Z');

function curve(points) {
  const arr = new Array(N).fill(null);
  for (let i = 1; i < points.length; i++) C.paintTension(arr, { x: points[i - 1][0], y: points[i - 1][1] }, { x: points[i][0], y: points[i][1] });
  return arr;
}
function wash(segments) {
  const arr = new Array(N).fill(0);
  for (const [x0, x1, s] of segments) C.paintWash(arr, { x: x0 }, { x: x1 }, s, 5);
  return arr;
}
function presence(ranges) {
  const arr = new Array(N).fill(0);
  for (const [x0, x1] of ranges) C.paintLine(arr, { x: x0 }, { x: x1 }, () => 1);
  return arr;
}
function fact(id, text, extra = {}) {
  return { id, text, v: 1, origin: 'human', secret: false, reveal: null, at: t0, history: [], retired: false, ...extra };
}
// A passage from pieces, each with its author: [text, 'typed' | 'pinned' | 'inked'].
function fromPieces(pieces, wet) {
  let text = '';
  const spans = [];
  for (const [t, o] of pieces) {
    spans.push({ s: text.length, e: text.length + t.length, o, wet: o === 'inked' && wet });
    text += t;
  }
  return { text, spans: C.normSpans(spans, text.length) };
}

const world = {
  title: 'The Hollow Moon',
  premise: 'In Vesk, a city of nine hundred lamps on a cliff above a black sea, every lamp must be lit before the moon rises. Kael, a lamplighter’s apprentice, finds out why.',
  byline: 'Inkwash example',
  example: true,
  voice: 'I learned to count stairs before I learned to read. Four hundred and twelve from the harbor to the guild door, and every one of them wet. My mother used to say a city that climbs that much must be running from something. She never said what.',
  pigments: [
    { id: 'p_dread', name: 'Dread', color: '#3d4f8f', line: 'Something was breathing on the other side of the door.' },
    { id: 'p_wonder', name: 'Wonder', color: '#c4952b', line: 'The sky was a lid someone had lifted.' },
    { id: 'p_grief', name: 'Grief', color: '#6b7f95', line: 'Her coat still hung by the door, as if it were waiting too.' },
    { id: 'p_warmth', name: 'Warmth', color: '#c0703f', line: 'She saved him the heel of the loaf, the way she always did.' },
    { id: 'p_menace', name: 'Menace', color: '#a3333d', line: 'The guildmaster smiled with all of his teeth and none of his eyes.' },
  ],
  sceneWords: 400,
  strict: false,
  chapterOrder: ['c_lamps', 'c_door'],
  createdAt: t0,
  updatedAt: tInk3,
};

const entities = [
  {
    id: 'e_kael', kind: 'character', name: 'Kael', createdAt: t0, updatedAt: tAge,
    facts: [
      fact('f_kael_age', 'Kael is sixteen.', { v: 2, at: tAge, history: [{ v: 1, text: 'Kael is seventeen.', at: t0 }] }),
      fact('f_kael_job', 'Kael is an apprentice in the lamplighters’ guild of Vesk.'),
      fact('f_kael_stairs', 'Kael counts stairs when he is afraid.'),
      fact('f_kael_mother', 'Kael’s mother vanished on a moonlit night when he was four.'),
    ],
  },
  {
    id: 'e_mira', kind: 'character', name: 'Mira', createdAt: t0, updatedAt: t0,
    facts: [
      fact('f_mira_teacher', 'Mira is the guild’s oldest lamplighter and Kael’s teacher.'),
      fact('f_mira_smell', 'Mira lost her sense of smell to moonlight.'),
    ],
  },
  {
    id: 'e_queen', kind: 'character', name: 'The Hollow Queen', createdAt: t0, updatedAt: t0,
    facts: [
      fact('f_queen_questions', 'The Hollow Queen speaks only in questions.'),
      fact('f_queen_years', 'She has lived inside the moon for twelve years.'),
      fact('f_queen_mother', 'The Hollow Queen is Kael’s mother.', { secret: true, reveal: 'c_door' }),
    ],
  },
  {
    id: 'e_vesk', kind: 'place', name: 'Vesk', createdAt: t0, updatedAt: t0,
    facts: [
      fact('f_vesk_lamps', 'Vesk is a city of nine hundred lamps on a cliff above a black sea.'),
      fact('f_vesk_stairs', 'Four hundred and twelve stairs climb from the harbor to the guild door.'),
    ],
  },
  {
    id: 'e_guild', kind: 'faction', name: 'The Lamplighters’ Guild', createdAt: t0, updatedAt: t0,
    facts: [
      fact('f_guild_ledger', 'The guild keeps a ledger of every lamp and every lighter.'),
      fact('f_guild_wages', 'A lamp left dark at moonrise costs its lighter a year’s wages.'),
    ],
  },
  {
    id: 'e_ladder', kind: 'thing', name: 'The Brass Ladder', createdAt: T('2026-09-29T07:30:00Z'), updatedAt: T('2026-09-29T07:30:00Z'),
    facts: [fact('f_ladder', 'The Brass Ladder is always one rung taller than whatever it leans against.', { origin: 'accepted', at: T('2026-09-29T07:30:00Z') })],
  },
  {
    id: 'e_moonlight', kind: 'rule', name: 'Moonlight', createdAt: t0, updatedAt: t0,
    facts: [
      fact('f_moon_forget', 'Anyone touched by direct moonlight forgets one thing they love.'),
      fact('f_moon_lamps', 'Lamplight keeps moonlight out, which is why every lamp must be lit before moonrise.'),
    ],
  },
];

const lamps = {
  id: 'c_lamps', title: 'Nine Hundred Lamps', scenes: 3,
  tension: curve([[0, 0.2], [0.15, 0.27], [0.3, 0.34], [0.4, 0.45], [0.55, 0.63], [0.66, 0.82], [0.75, 0.9], [0.8, 0.93], [0.88, 0.7], [1, 0.55]]),
  mood: {
    p_warmth: wash([[0.01, 0.27, 0.7]]),
    p_dread: wash([[0.26, 0.32, 0.25], [0.37, 0.65, 0.75], [0.7, 0.99, 0.3]]),
    p_menace: wash([[0.45, 0.6, 0.35]]),
    p_wonder: wash([[0.72, 0.95, 0.7]]),
  },
  threads: { e_kael: presence([[0, 1]]), e_mira: presence([[0, 0.45]]) },
  cast: ['e_kael', 'e_mira'],
  pins: [
    { id: 'pin_stairs', scene: 1, text: 'Four hundred and twelve stairs, and the last one was missing.' },
    { id: 'pin_blink', scene: 2, text: 'Above him, the moon blinked.' },
  ],
  notes: [
    { id: 'n_heel', scene: 0, text: 'Mira saves him the heel of the bread' },
    { id: 'n_dark', scene: 1, text: 'a lamp is dark at moonrise and nobody knows why' },
    { id: 'n_door', scene: 2, text: 'first sight of the door, but don’t name it yet' },
  ],
  strokes: 14, createdAt: t0, updatedAt: tInk3,
};
const door = {
  id: 'c_door', title: 'The Door in the Moon', scenes: 3,
  tension: curve([[0, 0.5], [0.33, 0.52], [0.4, 0.55], [0.66, 0.86]]),
  mood: {
    p_wonder: wash([[0.01, 0.3, 0.7]]),
    p_dread: wash([[0.05, 0.3, 0.3], [0.36, 0.65, 0.6]]),
    p_grief: wash([[0.5, 0.65, 0.45]]),
  },
  threads: { e_kael: presence([[0, 0.66]]), e_queen: presence([[0.48, 0.66]]) },
  cast: ['e_kael', 'e_queen'],
  pins: [{ id: 'pin_door', scene: 0, text: 'The moon had a door in it, and the door was open.' }],
  notes: [
    { id: 'n_trust', scene: 1, text: 'she doesn’t trust him yet' },
    { id: 'n_ask', scene: 1, text: 'she only asks questions' },
  ],
  strokes: 9, createdAt: T('2026-09-30T08:00:00Z'), updatedAt: T('2026-09-30T23:00:00Z'),
};

const s1 = fromPieces([
  ['Rain came to Vesk the way gossip did: sideways, all at once, and from the sea. By the time it reached the guild steps Kael had lit sixty lamps, and his matches had gone soft as bread.', 'typed'],
  ['\n\nMira was waiting under the awning with the ledger open on her knee. She did not look up. She never looked up for anything less than a dark lamp, and there were no dark lamps yet.\n\n“Sixty,” Kael said.\n\n“Sixty-one,” she said, and pointed with her chin at the lamp above the bakery door, which he had missed. Then she reached into her coat and handed him the heel of the loaf, the way she always did, ', 'inked'],
  ['still warm, wrapped in a page torn from last year’s ledger.', 'typed'],
  ['\n\nHe ate it on the way back down. Four hundred and twelve stairs to the harbor, and he counted every one, because counting was what he did instead of being afraid, and tonight, for no reason he could name, he was afraid.', 'inked'],
], false);

const s2 = fromPieces([
  ['The bell for moonrise rang while Kael was still on the harbor stairs. He had never been late in four years of lighting, not once since the guild took him in at thirteen, and he was seventeen now and should have known better than to stop for bread.\n\nMira passed him going down, lantern swinging. “Lamp forty-four is dark,” she said. “Go. I’ll take the harbor row.” She did not tell him what a dark lamp cost. Everyone in Vesk knew: a year’s wages, ', 'inked'],
  ['and the guildmaster’s smile.', 'typed'],
  ['\n\nHe ran. He stopped counting and then started again, because not counting was worse. ', 'inked'],
  ['Four hundred and twelve stairs, and the last one was missing.', 'pinned'],
  ['\n\nWhere the top step should have been there was only a gap, and below the gap, nothing: not the street, not the sea, only a dark that went down farther than the cliff did. Lamp forty-four hung over it, cold, its glass beaded with rain.', 'inked'],
], false);

const s3 = fromPieces([
  ['Kael lit lamp forty-four from the wrong side, leaning out over the gap with one hand on the cold iron and the match cupped against the rain. The wick took. Light fell into the hole and did not come back up.\n\nThat was when he looked up, which was the one thing every apprentice was told never to do at moonrise. The moon sat low over the sea, enormous and close, the color of an old coin. There was a line across its face that he had never seen before, a seam, as straight as a ruled page.\n\n', 'inked'],
  ['Above him, the moon blinked.', 'pinned'],
  ['\n\nHe did not remember climbing down. He remembered counting, and losing count, and starting again at one, and the strange certainty, all the way to the harbor, that something up there had seen him and was trying to remember his name.', 'inked'],
], true);

const base = { proposals: [], pinChecks: [], conflicts: [], checkedAt: null, reviewedAt: null };
const passages = [
  {
    ...base, id: 'c_lamps__s1', chapter: 'c_lamps', scene: 0, ...s1,
    premises: [{ f: 'f_kael_job', v: 1 }, { f: 'f_kael_stairs', v: 1 }, { f: 'f_mira_teacher', v: 1 }, { f: 'f_vesk_lamps', v: 1 }, { f: 'f_vesk_stairs', v: 1 }, { f: 'f_guild_ledger', v: 1 }],
    pending: [],
    edits: [{ at: T('2026-09-28T20:09:00Z'), pos: 538, del: 'warm.', ins: 'still warm, wrapped in a page torn from last year’s ledger.' }],
    editCount: 3, inks: 1, repaints: 0, inkedAt: T('2026-09-28T19:58:00Z'), setAt: tSet1, updatedAt: tSet1, checkedAt: T('2026-09-28T19:59:00Z'),
  },
  {
    ...base, id: 'c_lamps__s2', chapter: 'c_lamps', scene: 1, ...s2,
    premises: [{ f: 'f_kael_age', v: 1 }, { f: 'f_kael_stairs', v: 1 }, { f: 'f_vesk_stairs', v: 1 }, { f: 'f_guild_wages', v: 1 }, { f: 'f_mira_teacher', v: 1 }],
    pending: [], pinChecks: [{ id: 'pin_stairs', found: true }],
    edits: [{ at: T('2026-09-29T20:55:00Z'), pos: 489, del: 'and a mark in the ledger.', ins: 'and the guildmaster’s smile.' }],
    editCount: 2, inks: 2, repaints: 1, inkedAt: T('2026-09-29T20:40:00Z'), setAt: tSet2, updatedAt: tSet2, checkedAt: T('2026-09-29T20:41:00Z'),
  },
  {
    ...base, id: 'c_lamps__s3', chapter: 'c_lamps', scene: 2, ...s3,
    premises: [],
    pending: [{ f: 'f_kael_stairs', v: 1 }, { f: 'f_moon_forget', v: 1 }, { f: 'f_moon_lamps', v: 1 }, { f: 'f_vesk_lamps', v: 1 }],
    proposals: [{ id: 'nf_cloves', about: 'Vesk', text: 'The lamps of Vesk burn whale oil that smells of cloves.', status: 'new' }],
    pinChecks: [{ id: 'pin_blink', found: true }],
    edits: [], editCount: 0, inks: 1, repaints: 0, inkedAt: tInk3, setAt: null, updatedAt: tInk3, checkedAt: T('2026-09-30T22:41:00Z'),
  },
];

const seeds = [
  {
    id: 'd_ladder', at: T('2026-09-29T07:02:00Z'), askedAt: T('2026-09-29T07:03:00Z'),
    text: 'I was climbing a ladder that kept growing one rung taller than the wall. At the top the moon smelled like candle smoke, and somebody inside it was humming.',
    proposals: [
      { id: 'sd_ladder', kind: 'thing', name: 'The Brass Ladder', fact: 'The Brass Ladder is always one rung taller than whatever it leans against.', status: 'kept' },
      { id: 'sd_gardens', kind: 'place', name: 'The Candle Gardens', fact: 'Inside the moon there is a garden where candles grow like tulips.', status: 'new' },
      { id: 'sd_hum', kind: 'rule', name: 'The Moon’s Hum', fact: 'Anyone who hears the moon hum remembers a song they never learned.', status: 'dismissed' },
    ],
  },
];

// Plates: ink paintings for each written scene, for Vesk, and portraits of its people. Composed
// here the way Claude composes them in the studio, as specs the renderer paints.
const tPlate = T('2026-09-30T23:05:00Z');
const plate = (id, target, seed, spec) => ({ id, for: target.for, chapter: target.chapter || null, scene: target.scene == null ? null : target.scene, entity: target.entity || null, spec: PL.normalizePlate(spec, seed), paintedAt: tPlate });
const plates = [
  plate('c_lamps__s1', { for: 'scene', chapter: 'c_lamps', scene: 0 }, 1101, {
    title: 'Sixty lamps in the rain', alt: 'Rain slants over a lamplit city stacked on a cliff above the sea, while a boy with a lamp climbs the guild steps and an old woman waits under an awning.',
    time: 'dusk', weather: 'rain', accent: '#c0703f', sky: { clouds: 0.8 },
    ranges: [{ depth: 'mid', from: 0, to: 0.62, height: 0.85, peaks: 2, rough: 0.4 }],
    water: { level: 0.82, kind: 'sea' },
    things: [{ kind: 'houses', x: 0.24, depth: 'mid', count: 11, lit: true }, { kind: 'belltower', x: 0.4, depth: 'mid' }, { kind: 'stair', x: 0.6, depth: 'near', size: 'large' }, { kind: 'house', x: 0.14, depth: 'near', size: 'large', lit: true }, { kind: 'lamp', x: 0.82, depth: 'near' }],
    figures: [{ x: 0.66, depth: 'near', pose: 'walking', facing: 'left', carry: 'lamp' }, { x: 0.26, depth: 'near', pose: 'sitting', facing: 'right', cloak: true }],
  }),
  plate('c_lamps__s2', { for: 'scene', chapter: 'c_lamps', scene: 1 }, 1202, {
    title: 'The last stair', alt: 'The moon rises huge over a black sea while a boy runs up a long stair toward a step that is no longer there.',
    time: 'dusk', accent: '#c4952b', sky: { moon: { x: 0.8, y: 0.34, size: 2.1 } },
    water: { level: 0.7, kind: 'sea' },
    ranges: [{ depth: 'mid', from: 0, to: 0.45, height: 0.8, peaks: 1, rough: 0.3 }],
    things: [{ kind: 'houses', x: 0.16, depth: 'mid', count: 9, lit: true }, { kind: 'belltower', x: 0.32, depth: 'mid' }, { kind: 'stair', x: 0.5, depth: 'near', size: 'large' }, { kind: 'ship', x: 0.72, depth: 'mid', size: 'small' }],
    figures: [{ x: 0.47, depth: 'near', pose: 'walking', facing: 'right' }, { x: 0.2, depth: 'mid', pose: 'walking', facing: 'left', carry: 'lamp' }],
    voids: [{ shape: 'rect', x: 0.535, y: 0.78, w: 0.035, h: 0.06 }],
  }),
  plate('c_lamps__s3', { for: 'scene', chapter: 'c_lamps', scene: 2 }, 1303, {
    title: 'Above him, the moon blinked', alt: 'A boy leans out from a cliff-top lamp over a black sea, and an enormous low moon watches him through the rain.',
    time: 'night', weather: 'rain', accent: '#e0a849', sky: { moon: { x: 0.62, y: 0.3, size: 2.2 }, stars: false, clouds: 0.3 },
    water: { level: 0.78, kind: 'sea' },
    ranges: [{ depth: 'near', from: 0, to: 0.36, height: 0.75, peaks: 1, rough: 0.35 }],
    things: [{ kind: 'lamp', x: 0.3, depth: 'near', size: 'large' }, { kind: 'houses', x: 0.85, depth: 'far', count: 7, lit: true }],
    figures: [{ x: 0.34, depth: 'near', pose: 'reaching', facing: 'right' }],
  }),
  plate('ent__e_vesk', { for: 'place', entity: 'e_vesk' }, 2101, {
    title: 'Vesk', alt: 'A city of lamps climbs a black cliff above the sea, with a long stair running down to the harbour.',
    time: 'night', accent: '#e0a849', sky: { moon: { x: 0.84, y: 0.18, size: 1, phase: 'crescent' }, stars: true },
    water: { level: 0.76, kind: 'sea' },
    ranges: [{ depth: 'mid', from: 0, to: 0.7, height: 0.95, peaks: 2, rough: 0.35 }, { depth: 'far', from: 0.5, to: 1, height: 0.35, peaks: 3 }],
    things: [{ kind: 'houses', x: 0.2, depth: 'mid', count: 13, lit: true }, { kind: 'houses', x: 0.42, depth: 'mid', count: 6, lit: true }, { kind: 'belltower', x: 0.31, depth: 'mid' }, { kind: 'stair', x: 0.58, depth: 'mid', size: 'large' }, { kind: 'ship', x: 0.78, depth: 'mid', size: 'small' }],
  }),
  plate('ent__e_kael', { for: 'character', entity: 'e_kael' }, 2202, {
    title: 'Kael', alt: 'A young lamplighter in profile, cap pulled down, a lit lamp at his chest.', mode: 'portrait',
    time: 'dusk', accent: '#c0703f', water: { level: 0.74, kind: 'sea' },
    ranges: [{ depth: 'far', from: 0, to: 0.5, height: 0.6, peaks: 1 }], things: [{ kind: 'houses', x: 0.18, depth: 'far', count: 8, lit: true }],
    sitter: { facing: 'right', head: 'cap', hair: 'short', holds: 'lamp', age: 'young', build: 'slight' },
  }),
  plate('ent__e_mira', { for: 'character', entity: 'e_mira' }, 2303, {
    title: 'Mira', alt: 'An old woman in a wide-brimmed hat, in profile, with a lamplighter’s staff.', mode: 'portrait',
    time: 'day', weather: 'rain', accent: '#6b7f95', ranges: [{ depth: 'far', from: 0.3, to: 1, height: 0.5, peaks: 2 }],
    sitter: { facing: 'left', head: 'brimmed', hair: 'bun', collar: true, holds: 'staff', age: 'old', build: 'medium' },
  }),
  plate('ent__e_queen', { for: 'character', entity: 'e_queen' }, 2404, {
    title: 'The Hollow Queen', alt: 'A hooded figure in profile against a vast moon.', mode: 'portrait',
    time: 'night', accent: '#3d4f8f', sky: { moon: { x: 0.36, y: 0.4, size: 3 }, stars: true },
    sitter: { facing: 'left', head: 'hood', hair: 'long', cloak: true, holds: 'none', age: 'adult', build: 'slight' },
  }),
];

// Sanity checks: the example must show each state it claims to.
const idx = C.factIndex(entities);
const want = { c_lamps__s1: 'set', c_lamps__s2: 'stale', c_lamps__s3: 'wet' };
for (const p of passages) {
  const got = C.passageState(p, idx);
  if (got !== want[p.id]) throw new Error(`${p.id} is ${got}, expected ${want[p.id]}`);
  const pins = [lamps, door].find((c) => c.id === p.chapter).pins.filter((x) => x.scene === p.scene);
  const miss = C.findPins(p.text, pins).filter((r) => !r.found);
  if (miss.length) throw new Error(`${p.id} is missing a pin`);
}
for (const e of passages[0].edits.concat(passages[1].edits)) if (!passages.some((p) => p.text.includes(e.ins))) throw new Error('edit log does not match text');

const out = { format: 'inkwash-backup/1', exportedAt: new Date(tInk3).toISOString(), world, entities, chapters: [lamps, door], passages, seeds, plates };
C.readBackup(out);
const file = fileURLToPath(new URL('../example-world.json', import.meta.url));
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
const stats = passages.map((p) => `${p.id} ${C.passageState(p, idx)} ${Math.round(C.handStats(p.text, p.spans).hand * 100)}% hand`);
console.log(`wrote ${file}\n` + stats.join('\n'));
