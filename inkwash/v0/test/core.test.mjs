// Unit tests for the Inkwash core. Run: node --test inkwash/v0/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const C = require('../src/core.js');
const N = C.SAMPLES;

function fact(id, text, extra = {}) {
  return { id, text, v: 1, origin: 'human', secret: false, reveal: null, at: 1, history: [], retired: false, ...extra };
}
function world(extra = {}) {
  return {
    title: 'The Hollow Moon', premise: 'A lamplighter finds the moon is hollow.', byline: 'R.',
    voice: 'The lamps came on one by one, like a rumor spreading.', sceneWords: 400,
    pigments: [
      { id: 'p_dread', name: 'Dread', color: '#33447a', line: 'Something was breathing on the other side of the door.' },
      { id: 'p_wonder', name: 'Wonder', color: '#c99a2e', line: 'The sky was a lid someone had lifted.' },
    ],
    chapterOrder: ['c1', 'c2'], ...extra,
  };
}
function painted(scenes = 3) {
  const ch = C.newChapter('Nine Hundred Lamps', scenes, 1);
  ch.tension = new Array(N).fill(0.3);
  return ch;
}
function cast(ch, id, k, on = true) {
  ch.cast = Array.from(new Set([...(ch.cast || []), id]));
  ch.threads[id] = ch.threads[id] || new Array(N).fill(0);
  C.setPresence(ch.threads[id], ch.scenes, k, on);
}

test('scene ranges tile the chapter with no gaps', () => {
  for (let n = 1; n <= 7; n++) {
    let pos = 0;
    for (let k = 0; k < n; k++) {
      const [a, b] = C.sceneRange(n, k);
      assert.equal(a, pos);
      assert.ok(b > a);
      pos = b;
    }
    assert.equal(pos, N);
  }
  assert.equal(C.sceneAt(3, 0), 0);
  assert.equal(C.sceneAt(3, 0.5), 1);
  assert.equal(C.sceneAt(3, 1), 2);
});

test('painting tension and reading its shape', () => {
  const arr = new Array(N).fill(null);
  assert.equal(C.tensionSummary(arr, 0, 40), null, 'unpainted scene has no summary');
  C.paintTension(arr, { x: 0, y: 0.2 }, { x: 1, y: 0.95 });
  assert.ok(arr.every((v) => v != null));
  assert.equal(arr[0], 0.2);
  assert.equal(arr[N - 1], 0.95);
  const whole = C.tensionSummary(arr, 0, N);
  assert.equal(whole.shape, 'rising sharply');
  // painting right-to-left works too
  const back = new Array(N).fill(null);
  C.paintTension(back, { x: 1, y: 0.9 }, { x: 0, y: 0.1 });
  assert.equal(back[0], 0.1);
  assert.equal(C.tensionSummary(back, 0, N).shape, 'rising sharply');
  const flat = new Array(N).fill(0.5);
  assert.equal(C.tensionSummary(flat, 0, 40).shape, 'steady');
  assert.equal(C.tensionSummary(flat, 0, 40).level, 'taut');
  const spike = new Array(N).fill(0.3);
  for (let i = 15; i < 25; i++) spike[i] = 0.9;
  assert.equal(C.tensionSummary(spike, 0, 40).shape, 'spiking in the middle, then settling');
  const fall = new Array(N).fill(null);
  C.paintTension(fall, { x: 0, y: 0.9 }, { x: 0.33, y: 0.1 });
  assert.equal(C.tensionSummary(fall, 0, 40).shape, 'falling away');
  // keyboard nudge keeps the painted shape and paints an unpainted scene flat
  const nudged = C.nudgeTension(new Array(N).fill(null), 3, 1, 0.1);
  const [a, b] = C.sceneRange(3, 1);
  assert.ok(nudged.slice(a, b).every((v) => v === 0.6));
  assert.ok(nudged.slice(0, a).every((v) => v === null));
});

test('mood washes deposit with a soft edge and mix by weight', () => {
  const dread = new Array(N).fill(0);
  C.paintWash(dread, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, 0.4, 4);
  const i = Math.round(0.15 * (N - 1));
  assert.equal(dread[i], 0.4);
  assert.ok(dread[Math.round(0.1 * (N - 1)) - 3] > 0 && dread[Math.round(0.1 * (N - 1)) - 3] < 0.4, 'soft edge');
  assert.equal(dread[100], 0);
  C.paintWash(dread, { x: 0.15, y: 0 }, { x: 0.15, y: 0 }, 5, 4);
  assert.equal(dread[i], 1, 'clamped at full');
  C.paintWash(dread, { x: 0.15, y: 0 }, { x: 0.15, y: 0 }, -5, 4);
  assert.equal(dread[i], 0, 'lifted off');

  const w = world();
  const mood = { p_dread: new Array(N).fill(0.6), p_wonder: new Array(N).fill(0.2) };
  const mix = C.moodMix(mood, w.pigments, 0, 40);
  assert.deepEqual(mix.map((m) => [m.name, m.pct, m.feel]), [['Dread', 75, 'strong'], ['Wonder', 25, 'present']]);
  mood.p_wonder = new Array(N).fill(0.02);
  assert.deepEqual(C.moodMix(mood, w.pigments, 0, 40).map((m) => m.name), ['Dread'], 'a trace of pigment is ignored');
});

test('cast: presence, entrances and first meetings', () => {
  const ch = painted(3);
  cast(ch, 'kael', 0);
  cast(ch, 'kael', 1);
  cast(ch, 'queen', 1);
  assert.deepEqual(C.castIn(ch, 0).map((c) => c.id), ['kael']);
  assert.deepEqual(C.castIn(ch, 1).map((c) => c.id).sort(), ['kael', 'queen']);
  // the queen enters in the last third of scene 3
  ch.threads.queen = ch.threads.queen.slice();
  const [a, b] = C.sceneRange(3, 2);
  for (let i = a + Math.floor((b - a) * 0.6); i < b; i++) ch.threads.queen[i] = 1;
  const s3 = C.castIn(ch, 2);
  assert.equal(s3.length, 1);
  assert.equal(s3[0].enters, true);

  const w = world({ chapterOrder: ['c1', 'c2'] });
  const ch2 = painted(2);
  cast(ch2, 'kael', 0);
  cast(ch2, 'queen', 0);
  const chapters = new Map([['c1', ch], ['c2', ch2]]);
  assert.deepEqual(C.firstMeetings(w, chapters, 'c1', 1), [['kael', 'queen']]);
  assert.deepEqual(C.firstMeetings(w, chapters, 'c2', 0), [], 'they already met in chapter 1');
});

test('naming an entity: full names in any case, parts of names only capitalized', () => {
  assert.equal(C.mentions('the hollow queen smiled', 'The Hollow Queen'), true);
  assert.equal(C.mentions('Then the Queen asked a question.', 'The Hollow Queen'), true);
  assert.equal(C.mentions('then the queen asked', 'The Hollow Queen'), false);
  assert.equal(C.mentions('He climbed the ladder.', 'The Brass Ladder'), false);
  assert.equal(C.mentions('Kaelin waved.', 'Kael'), false, 'whole words only');
  assert.equal(C.mentions('Kael, waving.', 'Kael'), true);
  assert.equal(C.mentions('Ana Lin and Ana Varo', 'Ana Lin'), true);
});

test('facts are versioned when reworded or retired', () => {
  const f = fact('f1', 'Kael is seventeen.');
  assert.equal(C.reviseFact(f, '  Kael is seventeen. ', 2), false, 'no change, no new version');
  assert.equal(C.reviseFact(f, 'Kael is sixteen.', 3), true);
  assert.equal(f.v, 2);
  assert.equal(C.factTextAt(f, 1), 'Kael is seventeen.');
  assert.equal(C.factTextAt(f, 2), 'Kael is sixteen.');
  assert.equal(C.retireFact(f, 4), true);
  assert.equal(f.v, 3);
  assert.equal(C.factTextAt(f, 3), null);
  assert.equal(C.reviseFact(f, 'Kael is fifteen.', 5), false, 'a retired fact cannot be reworded');
});

function hollowMoon() {
  const w = world();
  const kael = { id: 'kael', kind: 'character', name: 'Kael', facts: [fact('fk1', 'Kael is seventeen.'), fact('fk2', 'Kael counts stairs when he is afraid.')] };
  const queen = {
    id: 'queen', kind: 'character', name: 'The Hollow Queen',
    facts: [fact('fq1', 'The Hollow Queen speaks only in questions.'), fact('fq2', "The Hollow Queen is Kael's mother.", { secret: true, reveal: 'c2' })],
  };
  const vesk = { id: 'vesk', kind: 'place', name: 'Vesk', facts: [fact('fv1', 'Vesk has nine hundred lamps.')] };
  const ladder = { id: 'ladder', kind: 'thing', name: 'The Brass Ladder', facts: [fact('fl1', 'The Brass Ladder is always one rung too long.', { origin: 'accepted' })] };
  const rule = { id: 'r1', kind: 'rule', name: 'Moonlight', facts: [fact('fr1', 'Moonlight makes you forget one thing you love.')] };
  const entities = [kael, queen, vesk, ladder, rule];
  const c1 = painted(3);
  c1.title = 'Nine Hundred Lamps';
  cast(c1, 'kael', 0);
  cast(c1, 'kael', 1);
  cast(c1, 'queen', 1);
  c1.mood.p_dread = new Array(N).fill(0.5);
  C.paintTension(c1.tension, { x: 0.34, y: 0.4 }, { x: 0.66, y: 0.95 });
  c1.pins.push({ id: 'pin1', scene: 1, text: 'The moon had a door in it, and the door was open.' });
  c1.notes.push({ id: 'n1', scene: 1, text: "she doesn't trust him yet; the Ladder creaks" });
  const c2 = painted(2);
  c2.title = 'The Door in the Moon';
  cast(c2, 'queen', 0);
  return { w, entities, chapters: new Map([['c1', c1], ['c2', c2]]), c1, c2 };
}

test('the brief carries the painted shape, pins, cast, canon and secrets', () => {
  const { w, entities, chapters } = hollowMoon();
  const b = C.buildBrief({ world: w, entities, chapters, chapterId: 'c1', k: 1, prevText: 'Kael counted the stairs: one, two, three.', nextText: '' });
  assert.match(b.prompt, /Tension: (high|at breaking point) .*rising sharply/);
  assert.match(b.prompt, /Mood: dread 100% \(strong\)/);
  assert.match(b.prompt, /In the scene: Kael, the Hollow Queen\./);
  assert.match(b.prompt, /first time Kael and the Hollow Queen share a scene/);
  const order = [...b.prompt.matchAll(/\[F(\d+)\]/g)].map((m) => Number(m[1]));
  assert.deepEqual(order.slice(0, new Set(order).size), [...new Set(order)].sort((x, y) => x - y), 'facts are numbered in the order shown');
  assert.ok(b.prompt.includes('1. The moon had a door in it, and the door was open.'), 'pin verbatim');
  assert.ok(b.prompt.includes('"she doesn\'t trust him yet; the Ladder creaks"'));
  // The Ladder is named in a note, so its fact comes along; the rule always does.
  assert.ok(b.prompt.includes('The Brass Ladder is always one rung too long.'));
  assert.ok(b.prompt.includes('Moonlight makes you forget one thing you love.'));
  // Vesk is not in this scene and not named anywhere near it.
  assert.ok(!b.prompt.includes('nine hundred lamps'));
  // The secret is fenced off in chapter 1...
  const canonPart = b.parts.canon, secretPart = b.parts.secrets;
  assert.ok(!canonPart.includes("Kael's mother"));
  assert.ok(secretPart.includes("Kael's mother"));
  assert.match(b.prompt, /THE STORY JUST BEFORE THIS SCENE/);
  assert.match(b.prompt, /LENGTH: about 300 to 500 words\./);
  assert.ok(b.prompt.endsWith('use [] if there are none.'));
  assert.ok(!b.display.includes('OUTPUT'), 'the display brief leaves out output plumbing');
  for (const [key, ref] of Object.entries(b.factMap)) {
    assert.match(key, /^F\d+$/);
    assert.equal(ref.v, 1);
    assert.ok(b.prompt.includes(`[${key}]`));
  }
  // ...may be revealed in chapter 2, and is plain canon after that.
  const b2 = C.buildBrief({ world: w, entities, chapters, chapterId: 'c2', k: 0 });
  assert.ok(b2.parts.reveals.includes("Kael's mother"));
  const w3 = { ...w, chapterOrder: ['c1', 'c2', 'c3'] };
  const c3 = painted(1);
  cast(c3, 'queen', 0);
  const b3 = C.buildBrief({ world: w3, entities, chapters: new Map([...chapters, ['c3', c3]]), chapterId: 'c3', k: 0 });
  assert.ok(b3.parts.canon.includes("Kael's mother"));
  assert.equal(b3.parts.secrets, '');
  // An unpainted scene says so instead of inventing a shape.
  const b4 = C.buildBrief({ world: w, entities, chapters, chapterId: 'c2', k: 1 });
  assert.match(b4.prompt, /Mood: not painted/);
});

test('reading the model output: prose, ledger and fallbacks', () => {
  const map = { F1: { id: 'fk1', v: 2 }, F2: { id: 'fq1', v: 1 } };
  const raw = '## Scene 2\n\nKael climbed.\n\n**The door** was open.\n\n===LEDGER===\n{"used": ["F1", "f2", "F9", "F1"], "new": [{"about": "Kael", "fact": "Kael fears ladders."}]}';
  const r = C.parseInkOutput(raw, map);
  assert.equal(r.prose, 'Kael climbed.\n\nThe door was open.');
  assert.deepEqual(r.used, [{ f: 'fk1', v: 2 }, { f: 'fq1', v: 1 }]);
  assert.deepEqual(r.fresh, [{ about: 'Kael', text: 'Kael fears ladders.' }]);
  assert.equal(r.ledger, true);
  const spaced = C.parseInkOutput('Text.\n=== LEDGER ===\n```json\n{"used":["F2"],"new":[]}\n```', map);
  assert.deepEqual(spaced.used, [{ f: 'fq1', v: 1 }]);
  const noMark = C.parseInkOutput('Text here.\n\n{"used": ["F1"], "new": []}', map);
  assert.equal(noMark.prose, 'Text here.');
  assert.equal(noMark.used.length, 1);
  const broken = C.parseInkOutput('Just prose.\n===LEDGER===\n{not json', map);
  assert.equal(broken.prose, 'Just prose.');
  assert.equal(broken.ledger, false);
  assert.deepEqual(broken.used, []);
  assert.equal(C.streamingProse('First.\n\nSecond.\n=== LED'), 'First.\n\nSecond.');
  assert.equal(C.cleanProse('* * *\nShe *ran* home.'), '* * *\nShe ran home.');
  const many = C.parseInkOutput('x\n===LEDGER===\n' + JSON.stringify({ used: [], new: Array.from({ length: 9 }, (_, i) => ({ about: 'A', fact: 'f' + i })) }), map);
  assert.equal(many.fresh.length, 5);
});

test("finding the author's pinned lines despite typography", () => {
  const text = 'He looked up. “The moon had a door in it,” he said, “and the door was open—wide.”\nThe moon had a door in it, and the door was open, and nobody saw.';
  const [hit, miss, quote] = C.findPins(text, [
    { id: 'a', text: 'The moon had a door in it, and the door was open.' },
    { id: 'b', text: 'Nobody climbs the brass ladder twice.' },
    { id: 'c', text: '"the moon had a door in it," he said' },
  ]);
  assert.equal(hit.found, true);
  assert.equal(text.slice(hit.start, hit.end), 'The moon had a door in it, and the door was open');
  assert.equal(miss.found, false);
  assert.equal(quote.found, true);
  assert.equal(text.slice(quote.start, quote.end), 'The moon had a door in it,” he said');
  const ell = C.findPins('Wait…  for   it.', [{ id: 'e', text: 'Wait... for it' }])[0];
  assert.equal(ell.found, true);
});

test('authorship spans follow edits', () => {
  const text = 'The lamps came on.';
  let spans = [{ s: 0, e: text.length, o: 'inked', wet: true }];
  // insert a word in the middle
  let r = C.applyEdit(text, spans, 'The old lamps came on.');
  assert.deepEqual(r.spans, [
    { s: 0, e: 4, o: 'inked', wet: true },
    { s: 4, e: 8, o: 'typed', wet: false },
    { s: 8, e: 22, o: 'inked', wet: true },
  ]);
  assert.deepEqual(r.edit, { at: 4, del: '', ins: 'old ' });
  // delete across the boundary
  r = C.applyEdit('The old lamps came on.', r.spans, 'The lamps came on.');
  assert.deepEqual(r.spans, [{ s: 0, e: 18, o: 'inked', wet: true }]);
  // replace a word: what the author types is theirs
  r = C.applyEdit(text, spans, 'The lamps went on.');
  assert.equal(C.handStats('The lamps went on.', r.spans).words.typed, 1);
  assert.deepEqual(r.spans.map((x) => x.o), ['inked', 'typed', 'inked']);
  // fixing one letter inside an inked word doesn't make the word the author's
  r = C.applyEdit(text, spans, 'The lamps cane on.');
  assert.equal(C.handStats('The lamps cane on.', r.spans).words.typed, 0);
  // append a sentence at the end
  r = C.applyEdit(text, spans, text + ' Kael ran.');
  assert.deepEqual(r.spans[r.spans.length - 1], { s: 18, e: 28, o: 'typed', wet: false });
  assert.equal(C.handStats(text + ' Kael ran.', r.spans).words.typed, 2);
  // unchanged text, unchanged spans
  assert.deepEqual(C.applyEdit(text, spans, text).spans, spans);
  // gaps are never counted as the author's
  assert.deepEqual(C.normSpans([{ s: 5, e: 10, o: 'typed' }], 12), [
    { s: 0, e: 5, o: 'inked', wet: false }, { s: 5, e: 10, o: 'typed', wet: false }, { s: 10, e: 12, o: 'inked', wet: false },
  ]);
});

test('overlay and splice keep spans covering the text exactly', () => {
  const sp = C.overlay([{ s: 0, e: 20, o: 'inked', wet: true }], 20, 5, 10, { o: 'pinned', wet: false });
  assert.deepEqual(sp, [{ s: 0, e: 5, o: 'inked', wet: true }, { s: 5, e: 10, o: 'pinned', wet: false }, { s: 10, e: 20, o: 'inked', wet: true }]);
  const r = C.splice('aaaaabbbbbccccc', [{ s: 0, e: 5, o: 'typed' }, { s: 5, e: 15, o: 'inked' }], 5, 10, 'XY', { o: 'inked', wet: true });
  assert.equal(r.text, 'aaaaaXYccccc');
  assert.deepEqual(r.spans, [{ s: 0, e: 5, o: 'typed', wet: false }, { s: 5, e: 7, o: 'inked', wet: true }, { s: 7, e: 12, o: 'inked', wet: false }]);
});

test('ink, set, stale, still true: the continuity ledger', () => {
  const { w, entities, chapters, c1 } = hollowMoon();
  const pins = c1.pins.filter((p) => p.scene === 1);
  const prose = 'Kael was seventeen and afraid of stairs. The moon had a door in it, and the door was open.';
  let p = C.inkedPassage({ chapterId: 'c1', k: 1, prose, used: [{ f: 'fk1', v: 1 }, { f: 'fq1', v: 1 }], fresh: [{ about: 'Kael', text: 'Kael hates heights.' }], pins, now: 10 });
  assert.equal(p.id, 'c1__s2');
  assert.equal(C.isWet(p), true);
  const pinned = p.spans.find((x) => x.o === 'pinned');
  assert.equal(prose.slice(pinned.s, pinned.e), 'The moon had a door in it, and the door was open');
  assert.equal(pinned.wet, false);
  assert.equal(p.proposals.length, 1);
  let idx = C.factIndex(entities);
  assert.equal(C.passageState(p, idx), 'wet');

  // a pin edited away blocks setting
  const broken = C.editPassage(p, 'Kael was seventeen and afraid of stairs.', pins, 11);
  const blocked = C.setPassage(broken, pins, 12);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'pins');

  const set = C.setPassage(p, pins, 20);
  assert.equal(set.ok, true);
  p = set.passage;
  assert.equal(C.isWet(p), false);
  assert.deepEqual(p.premises, [{ f: 'fk1', v: 1 }, { f: 'fq1', v: 1 }]);
  assert.deepEqual(p.pending, []);
  assert.equal(C.passageState(p, idx), 'set');

  // Changing a fact the passage used makes it stale; changing one it didn't use does not.
  C.reviseFact(entities[2].facts[0], 'Vesk has a thousand lamps.', 30);
  idx = C.factIndex(entities);
  assert.equal(C.passageState(p, idx), 'set');
  C.reviseFact(entities[0].facts[0], 'Kael is sixteen.', 31);
  idx = C.factIndex(entities);
  const st = C.staleness(p, idx);
  assert.equal(st.stale, true);
  assert.deepEqual(st.reasons.map((r) => [r.kind, r.entity, r.before, r.after]), [['changed', 'Kael', 'Kael is seventeen.', 'Kael is sixteen.']]);
  // Setting again doesn't refresh a premise...
  assert.equal(C.passageState(C.setPassage(p, pins, 32).passage, idx), 'stale');
  // ...re-reading does.
  const ok = C.stillTrue(p, idx, 33);
  assert.deepEqual(ok.premises, [{ f: 'fk1', v: 2 }, { f: 'fq1', v: 1 }]);
  assert.equal(C.passageState(ok, idx), 'set');

  // Retiring or deleting a fact is a change too.
  C.retireFact(entities[1].facts[0], 40);
  idx = C.factIndex(entities);
  assert.equal(C.staleness(ok, idx).reasons[0].kind, 'retired');
  const cleared = C.stillTrue(ok, idx, 41);
  assert.deepEqual(cleared.premises, [{ f: 'fk1', v: 2 }], 'a retired fact stops being a premise');
  const gone = C.staleness({ premises: [{ f: 'nope', v: 1 }], spans: [] }, idx);
  assert.equal(gone.reasons[0].kind, 'removed');

  // Wet ink can go stale before it is set.
  const wet = C.inkedPassage({ chapterId: 'c1', k: 0, prose: 'Kael ran.', used: [{ f: 'fk2', v: 1 }], fresh: [], pins: [], now: 50 });
  C.reviseFact(entities[0].facts[1], 'Kael counts lamps when he is afraid.', 51);
  idx = C.factIndex(entities);
  assert.equal(C.staleness(wet, idx).reasons[0].phase, 'wet');

  // Strict mode flags any change to anyone on the page, even facts the passage didn't use.
  const strictOpts = { strict: true, onPage: ['kael', 'queen'], entities: new Map(entities.map((e) => [e.id, e])) };
  const fresh = C.stillTrue(cleared, idx, 60);
  assert.equal(C.staleness(fresh, idx, strictOpts).stale, false);
  entities[0].facts.push(fact('fk3', 'Kael has a sister.', { at: 70 }));
  idx = C.factIndex(entities);
  assert.equal(C.staleness(fresh, idx).stale, false, 'scoped check ignores it');
  assert.equal(C.staleness(fresh, idx, strictOpts).reasons[0].kind, 'strict');
  assert.equal(C.staleness(C.stillTrue(fresh, idx, 80), idx, strictOpts).stale, false);
  assert.equal(C.dependents(new Map([['x', fresh]]), 'fk1').length, 1);
});

test('repainting a selection changes only that range', () => {
  const pins = [{ id: 'p', scene: 0, text: 'Nobody climbs twice.' }];
  let p = C.inkedPassage({ chapterId: 'c1', k: 0, prose: 'The ladder creaked. Nobody climbs twice. Kael went up.', used: [{ f: 'a', v: 1 }], fresh: [], pins, now: 1 });
  p = C.setPassage(p, pins, 2).passage;
  const s = p.text.indexOf('Kael went up.'), e = s + 'Kael went up.'.length;
  const q = C.repaintPassage(p, s, e, 'Kael climbed anyway, counting.', [{ f: 'b', v: 3 }], [], pins, 3);
  assert.equal(q.text, 'The ladder creaked. Nobody climbs twice. Kael climbed anyway, counting.');
  assert.deepEqual(q.premises, [{ f: 'a', v: 1 }], 'set premises still hold for the untouched text');
  assert.deepEqual(q.pending, [{ f: 'b', v: 3 }]);
  const wet = q.spans.filter((x) => x.wet);
  assert.equal(wet.length, 1);
  assert.equal(q.text.slice(wet[0].s, wet[0].e), 'Kael climbed anyway, counting.');
  assert.equal(q.repaints, 1);
  const again = C.setPassage(q, pins, 4).passage;
  assert.deepEqual(again.premises, [{ f: 'a', v: 1 }, { f: 'b', v: 3 }]);
});

test('publishing: problems block, and lore stays spoiler-safe', () => {
  const { w, entities, chapters, c1, c2 } = hollowMoon();
  const idx = C.factIndex(entities);
  const passages = new Map();
  let r = C.chapterProblems({ chapter: c1, chapterId: 'c1', passages, idx });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((x) => x.kind === 'nothing'));
  const p0 = C.setPassage(C.inkedPassage({ chapterId: 'c1', k: 0, prose: 'Kael lit the lamps of Vesk.', used: [{ f: 'fk1', v: 1 }], fresh: [], pins: [], now: 1 }), [], 2).passage;
  passages.set(p0.id, p0);
  const wet = C.inkedPassage({ chapterId: 'c1', k: 1, prose: 'No pin here.', used: [], fresh: [], pins: [], now: 3 });
  passages.set(wet.id, wet);
  r = C.chapterProblems({ chapter: c1, chapterId: 'c1', passages, idx });
  assert.deepEqual(r.problems.filter((x) => x.block).map((x) => x.kind).sort(), ['pins', 'wet']);
  passages.delete(wet.id);
  r = C.chapterProblems({ chapter: c1, chapterId: 'c1', passages, idx });
  assert.equal(r.ok, true, 'empty scenes are skipped, not blocking');

  const pc1 = C.publishedChapter({ world: w, chapter: c1, chapterId: 'c1', passages, now: 5 });
  assert.equal(pc1.order, 0);
  assert.deepEqual(pc1.scenes, ['Kael lit the lamps of Vesk.']);
  // Chapter 2 names the Queen and is the chapter that reveals her secret.
  const pc2 = { id: 'c2', title: c2.title, order: 1, scenes: ['The Hollow Queen asked him a question.'], words: 6, hand: 0.5 };
  let pub = C.publishedWorld({ world: w, entities, publishedChapters: [pc1], now: 6 });
  assert.ok(!JSON.stringify(pub).includes("Kael's mother"), 'an unrevealed secret never leaves the studio');
  assert.ok(!pub.lore.some((e) => e.name === 'The Hollow Queen'), 'not met yet in published chapters');
  pub = C.publishedWorld({ world: w, entities, publishedChapters: [pc1, pc2], now: 7 });
  const queen = pub.lore.find((e) => e.name === 'The Hollow Queen');
  assert.equal(queen.from, 1);
  assert.equal(queen.facts.find((f) => f.text.includes('mother')).from, 1);
  assert.deepEqual(C.visibleLore(pub, 0).map((e) => e.name).sort(), ['Kael', 'Moonlight', 'Vesk']);
  assert.ok(C.visibleLore(pub, 1).some((e) => e.name === 'The Hollow Queen'));
});

function unzip(bytes) {
  // Minimal reader for stored (uncompressed) ZIPs, checked against the central directory.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  const count = dv.getUint16(end + 10, true);
  let cd = dv.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50);
    const size = dv.getUint32(cd + 24, true), nameLen = dv.getUint16(cd + 28, true), off = dv.getUint32(cd + 42, true), crc = dv.getUint32(cd + 16, true);
    const name = new TextDecoder().decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    assert.equal(dv.getUint16(off + 8, true), 0, 'stored');
    const lnameLen = dv.getUint16(off + 26, true), extra = dv.getUint16(off + 28, true);
    const data = bytes.subarray(off + 30 + lnameLen + extra, off + 30 + lnameLen + extra + size);
    assert.equal(C.crc32(data), crc);
    files.push({ name, data, offset: off, extra });
    cd += 46 + nameLen;
  }
  return files;
}

test('exports: the EPUB is a valid stored zip with well-formed XHTML', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const model = {
    title: 'The Hollow <Moon> & Co', byline: 'R.', premise: 'A "hollow" moon.',
    chapters: [
      { id: 'c1', order: 0, title: 'Nine Hundred Lamps', scenes: [{ k: 0, text: 'One.\n\nTwo & three.', spans: [], stats: C.handStats('One.', []) }, { k: 1, text: 'Four <five>.', spans: [], stats: C.handStats('x', []) }] },
      { id: 'c2', order: 1, title: 'Empty', scenes: [] },
    ],
    stats: { words: { typed: 3, pinned: 0, inked: 1 }, total: 4, hand: 0.75 },
  };
  const bytes = C.exportEpub(model, Date.UTC(2026, 9, 1, 12, 0, 0));
  const files = unzip(bytes);
  assert.equal(files[0].name, 'mimetype');
  assert.equal(files[0].offset, 0);
  assert.equal(files[0].extra, 0);
  assert.equal(new TextDecoder().decode(files[0].data), 'application/epub+zip');
  const names = files.map((f) => f.name);
  for (const n of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/title.xhtml', 'OEBPS/ch1.xhtml', 'OEBPS/about.xhtml']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('OEBPS/ch2.xhtml'), 'chapters without set scenes are left out');
  const opf = new TextDecoder().decode(files.find((f) => f.name === 'OEBPS/content.opf').data);
  assert.match(opf, /<meta property="dcterms:modified">2026-10-01T12:00:00Z<\/meta>/);
  // Every XML file must parse. Use Python's standard XML parser as an independent check.
  const xmlFiles = files.filter((f) => /\.(xml|xhtml|opf)$/.test(f.name)).map((f) => ({ name: f.name, text: new TextDecoder().decode(f.data) }));
  const py = spawnSync('python3', ['-c', 'import json,sys,xml.dom.minidom as m\nfor f in json.load(sys.stdin): m.parseString(f["text"].encode())\nprint("ok")'], { input: JSON.stringify(xmlFiles) });
  assert.equal(py.stderr.toString(), '');
  assert.equal(py.stdout.toString().trim(), 'ok');
  const ch1 = xmlFiles.find((f) => f.name === 'OEBPS/ch1.xhtml').text;
  assert.ok(ch1.includes('Two &amp; three.') && ch1.includes('Four &lt;five&gt;.'));
  // Python's zipfile agrees it is a valid archive.
  const z = spawnSync('python3', ['-c', 'import io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nprint(z.namelist()[0])'], { input: Buffer.from(bytes) });
  assert.equal(z.stderr.toString(), '');
  assert.equal(z.stdout.toString().trim(), 'mimetype');
});

test('exports leave out wet scenes and report who wrote what', () => {
  const { w, entities, chapters } = hollowMoon();
  const passages = new Map();
  const pins = [];
  let p0 = C.inkedPassage({ chapterId: 'c1', k: 0, prose: 'Kael lit the lamps.', used: [], fresh: [], pins, now: 1 });
  p0 = C.editPassage(p0, 'Kael lit the lamps. He was tired.', pins, 2);
  p0 = C.recordEdit(p0, 'Kael lit the lamps.', 'Kael lit the lamps. He was tired.', 2);
  p0 = C.setPassage(p0, pins, Date.UTC(2026, 8, 30, 14, 2)).passage;
  passages.set(p0.id, p0);
  const wet = C.inkedPassage({ chapterId: 'c1', k: 2, prose: 'WET TEXT SHOULD NOT SHIP.', used: [], fresh: [], pins, now: 3 });
  passages.set(wet.id, wet);
  const model = C.bookModel({ world: w, chapters, passages });
  assert.equal(model.chapters[0].scenes.length, 1);
  const md = C.exportMarkdown(model);
  assert.ok(md.includes('## Chapter 1: Nine Hundred Lamps'));
  assert.ok(md.includes('Kael lit the lamps. He was tired.'));
  assert.ok(!md.includes('WET TEXT'));
  const html = C.exportHtml(model);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('WET TEXT'));
  assert.ok(html.includes('wrote 43% of the words by hand'), html.match(/wrote .* of the words/)[0]);
  const prov = C.exportProvenance({ world: w, entities, chapters, passages }, Date.UTC(2026, 9, 1));
  assert.equal(prov.json.summary.words, 7);
  assert.equal(prov.json.summary.byAuthor, 3);
  assert.equal(prov.json.summary.inkedKept, 4);
  assert.equal(prov.json.summary.edits, 1);
  assert.deepEqual(prov.json.summary.canon, { total: 7, author: 6, accepted: 1 });
  assert.ok(prov.md.includes('- Scene 1: 7 words, 43% by the author, 1 edits, set 2026-09-30 14:02 UTC'));
  const bible = C.exportBible({ world: w, entities, chapters }, 0);
  assert.equal(bible.entities[0].name, 'Kael');
  assert.equal(bible.entities.find((e) => e.name === 'The Hollow Queen').facts[1].revealedIn, 'The Door in the Moon');
  assert.deepEqual(bible.chapters[0].scenes[1].cast, ['Kael', 'The Hollow Queen']);
});

test('backups round-trip and bad files are refused', () => {
  const { w, entities, chapters } = hollowMoon();
  const c = [...chapters].map(([id, ch]) => ({ ...ch, id }));
  const b = C.exportBackup({ world: w, entities, chapters: c, passages: [], seeds: [] }, 0);
  const back = C.readBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(back.entities.length, 5);
  assert.equal(back.chapters.length, 2);
  assert.throws(() => C.readBackup({ format: 'other' }), /not an Inkwash backup/);
  assert.throws(() => C.readBackup({ ...b, entities: [{ id: 'bad/id' }] }), /bad id/);
});

test('continuity answers are anchored to verbatim quotes', () => {
  const text = 'Kael was seventeen, and the lamps of Vesk numbered nine hundred.';
  const map = { F1: { id: 'fk1', v: 2 }, F2: { id: 'fv1', v: 1 } };
  const out = C.parseContinuity({ conflicts: [
    { fact: 'F1', quote: '“Kael was seventeen”', why: 'Canon says sixteen.' },
    { fact: 'F2', quote: 'a thousand lamps', why: 'Not in the text.' },
    { fact: 'F7', quote: 'not there either', why: 'Unknown fact.' },
  ] }, text, map);
  assert.equal(out.length, 2);
  assert.equal(text.slice(out[0].start, out[0].end), 'Kael was seventeen');
  assert.equal(out[1].start, -1, 'kept, but marked as not found in the text');
  const { prompt, factMap } = C.buildContinuityPrompt({ world: { title: 'X' }, text, items: [{ e: { kind: 'character', name: 'Kael' }, f: { id: 'fk1', v: 2, text: 'Kael is sixteen.' } }] });
  assert.ok(prompt.includes('[F1] Kael: Kael is sixteen.'));
  assert.deepEqual(factMap.F1, { id: 'fk1', v: 2 });
});

test('dream seeds and repaint prompts', () => {
  const seeds = C.parseSeeds({ seeds: [{ kind: 'Place', name: 'The Smoke Gardens', fact: 'Candles grow there.' }, { kind: 'weird', name: 'X', fact: 'Y' }, { name: 'no fact' }] });
  assert.deepEqual(seeds.map((s) => [s.kind, s.name]), [['place', 'The Smoke Gardens'], ['thing', 'X']]);
  assert.ok(C.buildSeedPrompt({ world: { title: 'T' }, fragment: 'a ladder', names: ['Kael'] }).includes('Names already in the world: Kael.'));
  const { w, entities, chapters } = hollowMoon();
  const brief = C.buildBrief({ world: w, entities, chapters, chapterId: 'c1', k: 0 });
  const text = 'One. Two. Three.';
  const r = C.buildRepaintPrompt({ brief, text, s: 5, e: 9, direction: 'colder' });
  assert.ok(r.prompt.includes('One. ⟦Two.⟧ Three.'));
  assert.ok(r.prompt.includes('DIRECTION: colder'));
  const out = C.parseRepaint('"Two, said coldly."\n===LEDGER===\n{"used":[],"new":[]}', brief.factMap);
  assert.equal(out.prose, '"Two, said coldly."');
  assert.equal(C.parseRepaint('⟦Chapter two was cold.⟧', {}).prose, 'Chapter two was cold.', 'keeps a first line that only looks like a heading');
});

test('the bundled example world loads and shows set, stale and wet scenes', () => {
  const ex = require('../example-world.json');
  const data = C.readBackup(ex);
  const idx = C.factIndex(data.entities);
  const states = Object.fromEntries(data.passages.map((p) => [p.id, C.passageState(p, idx)]));
  assert.deepEqual(states, { c_lamps__s1: 'set', c_lamps__s2: 'stale', c_lamps__s3: 'wet' });
  const st = C.staleness(data.passages[1], idx);
  assert.deepEqual(st.reasons.map((r) => [r.before, r.after]), [['Kael is seventeen.', 'Kael is sixteen.']]);
  const chapters = new Map(data.chapters.map((c) => [c.id, c]));
  const b = C.buildBrief({ world: data.world, entities: data.entities, chapters, chapterId: 'c_door', k: 0, prevText: data.passages[2].text });
  assert.ok(b.prompt.includes('The moon had a door in it, and the door was open.'));
  assert.equal(b.parts.reveals, '', 'the Queen is not in scene 1, so her secret stays out of its brief');
  const b2 = C.buildBrief({ world: data.world, entities: data.entities, chapters, chapterId: 'c_door', k: 1 });
  assert.ok(b2.parts.reveals.includes('Kael’s mother'));
  assert.match(b2.prompt, /first time Kael and the Hollow Queen share a scene/);
});

test('changing the scene count keeps each scene’s painting under it', () => {
  const ch = C.newChapter('X', 3, 0);
  const [a, b] = C.sceneRange(3, 1);
  for (let i = a; i < b; i++) ch.tension[i] = 0.9;
  ch.mood.p = new Array(N).fill(0);
  C.washScene(ch.mood.p, 3, 2, 0.5);
  ch.pins.push({ id: 'x', scene: 2, text: 'last' });
  const four = C.resampleScenes(ch, 4);
  const [c, d] = C.sceneRange(4, 1);
  assert.ok(four.tension.slice(c, d).every((v) => v === 0.9));
  const [e, f] = C.sceneRange(4, 3);
  assert.ok(four.tension.slice(e, f).every((v) => v === null), 'the new scene is blank');
  assert.ok(four.mood.p.slice(...C.sceneRange(4, 2)).every((v) => v === 0.5));
  const two = C.resampleScenes(ch, 2);
  assert.equal(two.pins.length, 0, 'pins on a removed scene go with it');
  assert.ok(two.tension.slice(...C.sceneRange(2, 1)).every((v) => v === 0.9));
});

test('a place named anywhere in a chapter’s notes is the setting of every scene in it', () => {
  const { w, entities, chapters } = hollowMoon();
  const b0 = C.buildBrief({ world: w, entities, chapters, chapterId: 'c1', k: 0 });
  assert.ok(b0.parts.canon.includes('The Brass Ladder is always one rung too long.'), 'named in scene 2’s note, carried in scene 1');
  const b1 = C.buildBrief({ world: w, entities, chapters, chapterId: 'c1', k: 1 });
  assert.ok(b1.parts.shape.includes("- The author's notes for this scene:\n    \"she doesn't trust him yet; the Ladder creaks\""), 'one note per line, no doubled punctuation');
  assert.ok(!b0.parts.shape.includes('notes for this scene'), 'notes stay with their own scene');
});
