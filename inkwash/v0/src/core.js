/* Inkwash core: the pure logic behind the studio. No DOM and no platform calls, so the page and
 * the Node tests share exactly this code. Loaded in the page as window.InkCore. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Every chapter's score is sampled at this many points from left to right.
  const SAMPLES = 120;
  const KINDS = ['character', 'place', 'faction', 'thing', 'rule'];
  const KIND_LABEL = {
    character: 'Characters', place: 'Places', faction: 'Factions',
    thing: 'Things and creatures', rule: 'Rules of the world',
  };
  const LEDGER_MARK = '===LEDGER===';

  // ---------------------------------------------------------------- small helpers

  function uid(prefix) {
    let r = '';
    const g = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint32Array(2))
      : [Math.random() * 4294967296, Math.random() * 4294967296];
    for (const n of g) r += (n >>> 0).toString(36);
    return (prefix ? prefix + '_' : '') + r.slice(0, 10);
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else s += h[Math.floor(Math.random() * 16)];
    }
    return s;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round2 = (x) => Math.round(x * 100) / 100;
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function tail(s, n) { s = String(s || ''); return s.length > n ? '…' + s.slice(s.length - n).replace(/^\S*\s/, '') : s; }
  function head(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s; }
  function getFrom(coll, id) { return coll && (typeof coll.get === 'function' ? coll.get(id) : coll[id]); }
  function valuesOf(coll) { return !coll ? [] : (typeof coll.values === 'function' ? [...coll.values()] : Object.values(coll)); }

  // ---------------------------------------------------------------- the score

  function sceneRange(sceneCount, k) {
    const n = Math.max(1, sceneCount | 0);
    const i0 = Math.floor((k * SAMPLES) / n);
    const i1 = Math.floor(((k + 1) * SAMPLES) / n);
    return [i0, Math.max(i0 + 1, i1)];
  }
  function sceneAt(sceneCount, x) {
    const n = Math.max(1, sceneCount | 0);
    return clamp(Math.floor(clamp(x, 0, 0.99999) * n), 0, n - 1);
  }

  function newChapter(title, scenes, now) {
    return {
      title: title || 'Untitled chapter', scenes: scenes || 3,
      tension: new Array(SAMPLES).fill(null), mood: {}, threads: {}, cast: [],
      pins: [], notes: [], strokes: 0, createdAt: now || 0, updatedAt: now || 0,
    };
  }

  // Paint along the segment a->b (x in 0..1 across the chapter). valueFn(i, t) gives each sample.
  function paintLine(arr, a, b, valueFn) {
    const ia = Math.round(clamp(a.x, 0, 1) * (SAMPLES - 1));
    const ib = Math.round(clamp(b.x, 0, 1) * (SAMPLES - 1));
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    for (let i = lo; i <= hi; i++) {
      const t = ia === ib ? 1 : (i - ia) / (ib - ia);
      arr[i] = valueFn(i, clamp(t, 0, 1));
    }
    return arr;
  }
  // Tension: y is 0 (calm) .. 1 (breaking point).
  function paintTension(arr, a, b) {
    return paintLine(arr, a, b, (i, t) => round2(clamp(a.y + (b.y - a.y) * t, 0, 1)));
  }
  function eraseLine(arr, a, b, value) {
    return paintLine(arr, a, b, () => (value === undefined ? null : value));
  }
  // A wash deposits pigment with a soft edge. Negative strength lifts pigment off.
  function paintWash(arr, a, b, strength, radius) {
    const r = radius || 4;
    const ia = clamp(a.x, 0, 1) * (SAMPLES - 1), ib = clamp(b.x, 0, 1) * (SAMPLES - 1);
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    for (let i = Math.max(0, Math.floor(lo - r)); i <= Math.min(SAMPLES - 1, Math.ceil(hi + r)); i++) {
      const d = i < lo ? lo - i : i > hi ? i - hi : 0;
      if (d > r) continue;
      const fall = 0.5 * (1 + Math.cos((Math.PI * d) / r));
      arr[i] = round2(clamp((arr[i] || 0) + strength * fall, 0, 1));
    }
    return arr;
  }
  // Keyboard painting: raise or lower one scene's tension, keeping its painted shape.
  function nudgeTension(arr, sceneCount, k, delta) {
    const [i0, i1] = sceneRange(sceneCount, k);
    let painted = 0;
    for (let i = i0; i < i1; i++) if (arr[i] != null) painted++;
    for (let i = i0; i < i1; i++) {
      const base = painted ? (arr[i] == null ? null : arr[i]) : 0.5;
      if (base != null) arr[i] = round2(clamp(base + delta, 0, 1));
    }
    return arr;
  }
  function washScene(arr, sceneCount, k, delta) {
    const [i0, i1] = sceneRange(sceneCount, k);
    for (let i = i0; i < i1; i++) arr[i] = round2(clamp((arr[i] || 0) + delta, 0, 1));
    return arr;
  }
  // Change a chapter's scene count, keeping each surviving scene's painting under that scene.
  function resampleScenes(chapter, count) {
    const from = chapter.scenes, to = Math.max(1, count | 0);
    const remap = (arr, blank) => {
      if (!arr) return arr;
      const out = new Array(SAMPLES).fill(blank);
      for (let j = 0; j < Math.min(from, to); j++) {
        const [a, b] = sceneRange(from, j), [c, d] = sceneRange(to, j);
        for (let i = c; i < d; i++) out[i] = arr[Math.min(b - 1, a + Math.floor(((i - c) * (b - a)) / (d - c)))];
      }
      return out;
    };
    const mood = {}, threads = {};
    for (const [k, v] of Object.entries(chapter.mood || {})) mood[k] = remap(v, 0);
    for (const [k, v] of Object.entries(chapter.threads || {})) threads[k] = remap(v, 0);
    return Object.assign({}, chapter, {
      scenes: to, tension: remap(chapter.tension || new Array(SAMPLES).fill(null), null), mood, threads,
      pins: (chapter.pins || []).filter((p) => p.scene < to), notes: (chapter.notes || []).filter((n) => n.scene < to),
    });
  }
  function setPresence(arr, sceneCount, k, on) {
    const [i0, i1] = sceneRange(sceneCount, k);
    for (let i = i0; i < i1; i++) arr[i] = on ? 1 : 0;
    return arr;
  }

  function tensionSummary(tension, i0, i1) {
    const vals = [];
    for (let i = i0; i < i1; i++) if (tension && tension[i] != null) vals.push(tension[i]);
    if (vals.length < Math.max(2, (i1 - i0) * 0.2)) return null;
    const mean = avg(vals);
    const k = Math.max(1, Math.round(vals.length * 0.2));
    const start = avg(vals.slice(0, k)), end = avg(vals.slice(-k));
    const max = Math.max(...vals), min = Math.min(...vals);
    const delta = end - start;
    let shape;
    if (delta > 0.25) shape = 'rising sharply';
    else if (delta > 0.08) shape = 'rising';
    else if (delta < -0.25) shape = 'falling away';
    else if (delta < -0.08) shape = 'easing';
    else if (max - Math.max(start, end) > 0.18) shape = 'spiking in the middle, then settling';
    else if (Math.min(start, end) - min > 0.18) shape = 'dipping in the middle';
    else shape = 'steady';
    const level = mean < 0.2 ? 'calm' : mean < 0.4 ? 'low' : mean < 0.6 ? 'taut' : mean < 0.8 ? 'high' : 'at breaking point';
    return { mean: round2(mean), start: round2(start), end: round2(end), shape, level };
  }

  function moodMix(mood, pigments, i0, i1) {
    const out = [];
    let total = 0;
    for (const p of pigments || []) {
      const arr = mood && mood[p.id];
      if (!arr) continue;
      let w = 0;
      for (let i = i0; i < i1; i++) w += arr[i] || 0;
      if (w > 0.001) { out.push({ id: p.id, name: p.name, line: p.line, color: p.color, weight: w, strength: w / (i1 - i0) }); total += w; }
    }
    for (const m of out) {
      m.pct = Math.round((100 * m.weight) / total);
      m.feel = m.strength < 0.2 ? 'faint' : m.strength < 0.5 ? 'present' : 'strong';
    }
    return out.filter((m) => m.pct >= 8).sort((a, b) => b.weight - a.weight);
  }

  // Who is in scene k: a thread present for at least a quarter of the scene.
  function castIn(chapter, k) {
    const [i0, i1] = sceneRange(chapter.scenes, k);
    const out = [];
    for (const id of chapter.cast || []) {
      const arr = (chapter.threads || {})[id];
      if (!arr) continue;
      let on = 0, first = -1, last = -1;
      for (let i = i0; i < i1; i++) if (arr[i]) { on++; if (first < 0) first = i; last = i; }
      const n = i1 - i0;
      if (on / n >= 0.25) out.push({ id, enters: (first - i0) / n > 0.35, leaves: (last - i0 + 1) / n < 0.65 });
    }
    return out;
  }

  // Pairs of characters who share a scene for the first time in the book at (chapterId, k).
  function firstMeetings(world, chapters, chapterId, k) {
    const seen = new Set();
    const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    for (const cid of world.chapterOrder || []) {
      const ch = getFrom(chapters, cid);
      if (!ch) continue;
      for (let j = 0; j < ch.scenes; j++) {
        const ids = castIn(ch, j).map((c) => c.id);
        if (cid === chapterId && j === k) {
          const firsts = [];
          for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
            if (!seen.has(key(ids[a], ids[b]))) firsts.push([ids[a], ids[b]]);
          }
          return firsts;
        }
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) seen.add(key(ids[a], ids[b]));
      }
    }
    return [];
  }

  // ---------------------------------------------------------------- canon

  function newEntity(kind, name, now) {
    return { id: uid('e'), kind: KINDS.includes(kind) ? kind : 'thing', name: String(name || '').trim() || 'Unnamed', facts: [], createdAt: now || 0, updatedAt: now || 0 };
  }
  // Where a fact came from: written by the author in the studio ('human'), suggested by a model
  // and kept ('accepted'), or brought in from the author's notes ('imported': made outside the
  // studio, so its origin isn't verified).
  const FACT_ORIGINS = new Set(['human', 'accepted', 'imported']);
  function newFact(text, origin, now) {
    return { id: uid('f'), text: String(text).trim(), v: 1, origin: FACT_ORIGINS.has(origin) ? origin : 'human', secret: false, reveal: null, at: now || 0, history: [], retired: false };
  }
  function factIndex(entities) {
    const idx = new Map();
    for (const e of valuesOf(entities)) for (const f of e.facts || []) idx.set(f.id, { fact: f, entity: e });
    return idx;
  }
  // Rewording a fact makes a new version. Passages that relied on the old one go stale.
  function reviseFact(fact, text, now) {
    text = String(text || '').trim();
    if (!text || text === fact.text || fact.retired) return false;
    fact.history = (fact.history || []).concat([{ v: fact.v, text: fact.text, at: fact.at }]).slice(-20);
    fact.v += 1;
    fact.text = text;
    fact.at = now || 0;
    return true;
  }
  function retireFact(fact, now) {
    if (fact.retired) return false;
    fact.history = (fact.history || []).concat([{ v: fact.v, text: fact.text, at: fact.at }]).slice(-20);
    fact.v += 1;
    fact.retired = true;
    fact.at = now || 0;
    return true;
  }
  // Undo puts a fact back the way it read, as a new version. Versions only move forward, so a
  // scene set against the wording being undone goes stale, and one set against the words put back
  // holds again (see staleness).
  function restoreFact(fact, text, retired, now) {
    text = String(text || '').trim();
    if (!text || (text === fact.text && !!retired === !!fact.retired)) return false;
    fact.history = (fact.history || []).concat([Object.assign({ v: fact.v, text: fact.text, at: fact.at }, fact.retired ? { retired: true } : {})]).slice(-20);
    fact.v += 1;
    fact.text = text;
    fact.retired = !!retired;
    fact.at = now || 0;
    return true;
  }
  function factTextAt(fact, v) {
    if (fact.v === v && !fact.retired) return fact.text;
    const h = (fact.history || []).find((x) => x.v === v);
    return h && !h.retired ? h.text : null;
  }

  function chapterIndex(world, chapterId) { return (world.chapterOrder || []).indexOf(chapterId); }

  // Is this entity named in the text? The full name matches in any case. A word of a longer name
  // matches only capitalized, so "the Queen" finds The Hollow Queen but "the ladder" doesn't find
  // The Brass Ladder.
  const SMALL_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'from', 'with']);
  function mentions(text, name) {
    if (!text || !name) return false;
    const bound = (s, flags) => new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(s) + '($|[^\\p{L}\\p{N}])', flags);
    const full = String(name).replace(/^the\s+/i, '').trim();
    if (full.length >= 3 && bound(full.toLowerCase(), 'iu').test(text)) return true;
    const words = full.split(/\s+/).filter((w) => w.length >= 4 && !SMALL_WORDS.has(w.toLowerCase()));
    if (words.length < 2) return false;
    return words.some((w) => bound(w[0].toUpperCase() + w.slice(1), 'u').test(text));
  }

  // The facts a scene's brief carries: everyone on the page, anything named in the chapter's title,
  // pins and notes (a place named once is the setting of the whole chapter) or in the story just
  // before, and every rule of the world. Secrets are split out by chapter.
  function sceneFacts({ world, entities, chapter, chapterId, k, extraText }) {
    const list = valuesOf(entities);
    const onPage = castIn(chapter, k).map((c) => c.id);
    const text = [
      chapter.title,
      ...(chapter.pins || []).map((p) => p.text),
      ...(chapter.notes || []).map((n) => n.text),
      extraText || '',
    ].join('\n');
    const chosen = new Set(onPage);
    for (const e of list) if (!chosen.has(e.id) && (e.kind === 'rule' || mentions(text, e.name))) chosen.add(e.id);
    const order = chapterIndex(world, chapterId);
    const canon = [], secrets = [], reveals = [];
    for (const e of list) {
      if (!chosen.has(e.id)) continue;
      for (const f of e.facts || []) {
        if (f.retired) continue;
        if (f.secret) {
          const ro = f.reveal ? chapterIndex(world, f.reveal) : -1;
          if (ro >= 0 && ro < order) canon.push({ e, f });
          else if (ro >= 0 && ro === order) reveals.push({ e, f });
          else secrets.push({ e, f });
        } else canon.push({ e, f });
      }
    }
    return { onPage, canon: canon.slice(0, 60), secrets: secrets.slice(0, 15), reveals: reveals.slice(0, 10) };
  }

  // ---------------------------------------------------------------- the brief

  function wordRange(target) {
    const t = clamp(Number(target) || 450, 120, 2500);
    return [Math.round((t * 0.75) / 10) * 10, Math.round((t * 1.25) / 10) * 10];
  }

  // Facts grouped by who or what they are about, numbered in the order they are shown.
  function factBlock(items, tag) {
    const groups = new Map();
    for (const { e, f } of items) {
      const label = e.kind === 'rule' ? 'Rules of the world' : `${e.name} (${e.kind})`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(f);
    }
    const out = [];
    for (const [label, facts] of groups) {
      out.push(label);
      for (const f of facts) out.push(`  [${tag(f)}] ${f.text}`);
    }
    return out.join('\n');
  }
  // "The Hollow Queen" reads as "the Hollow Queen" in the middle of a sentence.
  const inSentence = (name) => String(name).replace(/^The /, 'the ');

  // Everything the model gets for one scene, built only from what the author painted, pinned,
  // noted and wrote. `parts` lets repaint reuse the same canon and voice sections.
  function buildBrief(ctx) {
    const { world, chapterId, k } = ctx;
    const entities = valuesOf(ctx.entities);
    const byId = new Map(entities.map((e) => [e.id, e]));
    const chapter = getFrom(ctx.chapters, chapterId);
    const order = chapterIndex(world, chapterId);
    const [i0, i1] = sceneRange(chapter.scenes, k);
    const t = tensionSummary(chapter.tension, i0, i1);
    const moods = moodMix(chapter.mood, world.pigments, i0, i1);
    const cast = castIn(chapter, k).filter((c) => byId.has(c.id));
    const firsts = firstMeetings(world, ctx.chapters, chapterId, k).filter(([a, b]) => byId.has(a) && byId.has(b));
    const pins = (chapter.pins || []).filter((p) => p.scene === k);
    const notes = (chapter.notes || []).filter((n) => n.scene === k);
    const facts = sceneFacts({ world, entities, chapter, chapterId, k, extraText: tail(ctx.prevText, 700) });

    const factMap = {};
    const label = new Map();
    let n = 0;
    const tag = (f) => {
      if (!label.has(f.id)) { const key = 'F' + ++n; label.set(f.id, key); factMap[key] = { id: f.id, v: f.v }; }
      return label.get(f.id);
    };

    const shape = ['SHAPE OF THIS SCENE (painted by the author)'];
    if (t) {
      const span = Math.abs(t.end - t.start) > 0.08 ? ` from ${t.start.toFixed(2)} to ${t.end.toFixed(2)}` : '';
      shape.push(`- Tension: ${t.level} (${t.mean.toFixed(2)} on a 0 to 1 scale), ${t.shape}${span}.`);
    } else shape.push('- Tension: not painted. Use your judgment.');
    if (moods.length) {
      shape.push('- Mood: ' + moods.map((m) => `${m.name.toLowerCase()} ${m.pct}% (${m.feel})`).join(', ') + '.');
      const defs = moods.filter((m) => m.line).map((m) => `    ${m.name.toLowerCase()}: "${m.line}"`);
      if (defs.length) shape.push("  The author's own line for each feeling (use it to understand the feeling; don't copy it):", ...defs);
    } else shape.push('- Mood: not painted. Use your judgment.');
    if (cast.length) {
      shape.push('- In the scene: ' + cast.map((c) => {
        const bits = [];
        if (c.enters) bits.push('enters partway through');
        if (c.leaves) bits.push('leaves before the end');
        return inSentence(byId.get(c.id).name) + (bits.length ? ` (${bits.join(', ')})` : '');
      }).join(', ') + '.');
      for (const [a, b] of firsts.slice(0, 3)) shape.push(`- This is the first time ${inSentence(byId.get(a).name)} and ${inSentence(byId.get(b).name)} share a scene.`);
    } else shape.push('- In the scene: not painted. Choose who appears from the story so far.');
    if (pins.length) {
      shape.push("- Include these lines of the author's word for word, exactly as written:");
      pins.forEach((p, i) => shape.push(`  ${i + 1}. ${p.text}`));
    }
    if (notes.length) shape.push("- The author's notes for this scene:", ...notes.map((x) => `    "${x.text}"`));

    const canonPart = facts.canon.length
      ? 'CANON (facts you may rely on; never contradict them)\n' + factBlock(facts.canon, tag)
      : 'CANON: nothing recorded yet for this scene.';
    const secretPart = facts.secrets.length
      ? "SECRETS the reader must not learn yet. Don't reveal them or hint at them directly, and don't contradict them:\n" + factBlock(facts.secrets, tag)
      : '';
    const revealPart = facts.reveals.length
      ? 'THIS CHAPTER MAY REVEAL (only if it fits this scene):\n' + factBlock(facts.reveals, tag)
      : '';

    const context = [];
    if (ctx.prevText && ctx.prevText.trim()) context.push('THE STORY JUST BEFORE THIS SCENE:\n"""\n' + tail(ctx.prevText, 900) + '\n"""');
    else if (order <= 0 && k === 0) context.push('This is the opening scene of the book.');
    else context.push("The scene before this one isn't written yet.");
    if (ctx.nextText && ctx.nextText.trim()) context.push('THE SCENE THAT FOLLOWS (already written; lead into it):\n"""\n' + head(ctx.nextText, 500) + '\n"""');

    const voice = world.voice && world.voice.trim()
      ? "THE AUTHOR'S VOICE. Match the rhythm, diction and sentence length of this sample of the author's own writing. Don't reuse its content:\n\"\"\"\n" + world.voice.trim().slice(0, 4000) + '\n"""'
      : "THE AUTHOR'S VOICE: no sample given. Write plain, concrete prose.";
    const [lo, hi] = wordRange(world.sceneWords);

    const parts = {
      intro: 'You are inking one scene of a novel for its author. The author designed this scene by painting its shape, choosing who is in it and pinning lines of their own. Follow that design exactly and write in the author\'s voice.',
      header: `WORLD: ${world.title || 'Untitled'}${world.premise ? '. ' + world.premise : ''}\nCHAPTER ${order + 1}: ${chapter.title || 'Untitled'}. Scene ${k + 1} of ${chapter.scenes}.`,
      shape: shape.join('\n'),
      canon: canonPart, secrets: secretPart, reveals: revealPart,
      context: context.join('\n\n'),
      voice,
      length: `LENGTH: about ${lo} to ${hi} words.`,
      output: 'OUTPUT\nWrite the scene as plain prose paragraphs separated by blank lines. No title, no headings, no markdown, no commentary.\n'
        + `After the scene, write a line containing only ${LEDGER_MARK} and then one line of JSON in this form:\n`
        + '{"used": ["F1", "F3"], "new": [{"about": "Kael", "fact": "Kael has a burn scar on his left palm."}]}\n'
        + '"used" lists every fact above that the scene relies on or mentions. "new" lists up to 5 lasting new facts the scene establishes about a person, place or the world; use [] if there are none.',
    };
    const order_ = ['intro', 'header', 'shape', 'canon', 'secrets', 'reveals', 'context', 'voice', 'length'];
    const display = order_.slice(1).map((p) => parts[p]).filter(Boolean).join('\n\n');
    const prompt = order_.map((p) => parts[p]).filter(Boolean).join('\n\n') + '\n\n' + parts.output;
    return { prompt, display, parts, factMap, pins, notes, cast, tension: t, moods, k, chapterId };
  }

  // ---------------------------------------------------------------- reading model output

  function parseJsonLoose(s) {
    s = String(s || '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  function cleanProse(s, opts) {
    let t = String(s || '').replace(/\r\n?/g, '\n');
    t = t.replace(/^\s*```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '');
    if (!(opts && opts.keepFirstLine)) {
      const lines = t.split('\n');
      while (lines.length && (/^\s*$/.test(lines[0]) || /^\s*#{1,6}\s/.test(lines[0])
        || /^\s*(\*\*)?\s*(scene|chapter)\b[^.!?\n]{0,60}(\*\*)?\s*$/i.test(lines[0]))) lines.shift();
      t = lines.join('\n');
    }
    t = t.replace(/\*\*([^*\s](?:[^*\n]*[^*\s])?)\*\*/g, '$1').replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![*\w])/g, '$1$2');
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return t;
  }

  // While the answer streams in, show only the prose: stop at the first line that starts with '='.
  function streamingProse(raw) {
    const s = String(raw || '').replace(/\r\n?/g, '\n');
    const m = s.match(/(^|\n)[ \t]*=/);
    return m ? s.slice(0, m.index) : s;
  }

  // Fact keys from a model's answer ("F3", "[F3]", "f3") as premises, once each.
  function refsFrom(list, factMap) {
    const out = [], seen = new Set();
    for (const key of Array.isArray(list) ? list : []) {
      const ref = factMap[String(key).trim().toUpperCase().replace(/^\[|\]$/g, '')];
      if (ref && !seen.has(ref.id)) { seen.add(ref.id); out.push({ f: ref.id, v: ref.v }); }
    }
    return out;
  }

  function parseInkOutput(raw, factMap, opts) {
    raw = String(raw || '').replace(/\r\n?/g, '\n');
    let prose = raw, meta = null;
    const m = /^[ \t]*={2,}[ \t]*LEDGER[ \t]*={2,}[ \t]*$/im.exec(raw);
    if (m) { prose = raw.slice(0, m.index); meta = parseJsonLoose(raw.slice(m.index + m[0].length)); }
    else {
      const at = raw.search(/\{\s*"used"\s*:/);
      if (at >= 0) { const cand = parseJsonLoose(raw.slice(at)); if (cand) { meta = cand; prose = raw.slice(0, at); } }
    }
    prose = cleanProse(prose, opts);
    const used = refsFrom(meta && meta.used, factMap);
    const fresh = (meta && Array.isArray(meta.new) ? meta.new : [])
      .filter((x) => x && typeof x.fact === 'string' && x.fact.trim())
      .slice(0, 5)
      .map((x) => ({ about: String(x.about || '').trim().slice(0, 80), text: x.fact.trim().slice(0, 300) }));
    return { prose, used, fresh, ledger: !!meta };
  }

  // When the model returns no ledger, fall back to every fact about anyone it names. That is a
  // superset of what it relied on, so a later change flags too much rather than too little.
  function guessUsed(prose, factMap, entities) {
    const byFact = factIndex(entities);
    const out = [];
    for (const key of Object.keys(factMap)) {
      const ref = factMap[key];
      const hit = byFact.get(ref.id);
      if (hit && hit.entity.kind !== 'rule' && mentions(prose, hit.entity.name)) out.push({ f: ref.id, v: ref.v });
    }
    return out;
  }

  // ---------------------------------------------------------------- what a scene relies on
  // The model's list of the facts it used can miss some, and a scene written by hand has no list
  // at all. Two more witnesses: the scene's own words (a fact whose distinctive words are on the
  // page) and the continuity check, which lists every fact the scene depends on. A scene's
  // premises are everything any witness found, so a change flags too much rather than too little.
  const STOP = new Set(('a an the and or but if then than so as of in on at to from by with without for into onto upon over under '
    + 'about after before when while where who whom whose which what that this these those is are was were be been being am '
    + 'has have had do does did not no nor can could will would shall should may might must it its he him his she her hers '
    + 'they them their theirs we us our you your i me my mine one ones there here also only just very too more most less '
    + 'some any all each every own same such up down out off again once ever never always still yet now like '
    // Words too common in prose to say a fact is on the page.
    + 'time times way ways thing things people person place places part parts piece pieces side sides kind lot '
    + 'take takes took taken taking keep keeps kept keeping move moves moved moving make makes made making '
    + 'come comes came coming go goes went gone going get gets got look looks looked looking seem seems seemed '
    + 'give gives gave given say says said tell tells told know knows knew see sees saw seen '
    + 'toward towards back away across around through along between behind inside outside near far '
    + 'new old first last next other another many much little big small large long short good bad whole fresh different real '
    + 'actually nearly almost already really quite rather perhaps maybe').split(' '));
  function textWords(text) {
    return String(text || '').toLowerCase().replace(/[’']s(?![\p{L}\p{N}])/gu, '').match(/[\p{L}\p{N}]+/gu) || [];
  }
  // A word and its plain inflections: counts, counted, counting all meet at "count".
  function wordForms(w) {
    const out = [w];
    if (w.length > 3) {
      if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
      if (w.endsWith('es')) out.push(w.slice(0, -2));
      if (w.endsWith('s')) out.push(w.slice(0, -1));
      if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
      if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
    }
    return out;
  }
  // The words that make a fact this fact: not its subject's name, not the small words.
  function factTerms(e, f) {
    const name = new Set(e.kind === 'rule' ? [] : textWords(e.name));
    return [...new Set(textWords(f.text).filter((t) => (t.length >= 3 || /\d/.test(t)) && !STOP.has(t) && !name.has(t)))];
  }
  // Facts whose distinctive words are on the page. `items` are {e, f} pairs, optionally with the
  // version `v` the writer was shown.
  function relies(text, items) {
    const have = new Set();
    for (const w of textWords(text)) for (const x of wordForms(w)) have.add(x);
    const out = [], seen = new Set();
    for (const it of items || []) {
      const { e, f } = it;
      if (!e || !f || f.retired || seen.has(f.id)) continue;
      const terms = factTerms(e, f);
      if (!terms.length) continue;
      const hits = terms.filter((t) => wordForms(t).some((x) => have.has(x))).length;
      const need = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.4));
      if (hits >= need) { seen.add(f.id); out.push({ f: f.id, v: it.v != null ? it.v : f.v }); }
    }
    return out;
  }
  // The facts a brief showed the writer, as items for `relies`, at the versions it showed.
  function briefItems(factMap, idx) {
    return Object.values(factMap || {}).map((ref) => { const hit = idx.get(ref.id); return hit ? { e: hit.entity, f: hit.fact, v: ref.v } : null; }).filter(Boolean);
  }

  // ---------------------------------------------------------------- matching the author's pins

  const CHAR_MAP = {
    '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
    '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
    '—': '-', '–': '-', '‒': '-', '−': '-', ' ': ' ',
  };
  // Normalize quotes, dashes, ellipses, whitespace and case, keeping a map back to the original.
  function normMap(s) {
    s = String(s || '');
    let out = '';
    const map = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
      let c = s[i];
      if (c === '…') { for (let j = 0; j < 3; j++) { out += '.'; map.push(i); } prevSpace = false; continue; }
      c = CHAR_MAP[c] || c;
      if (/\s/.test(c)) { if (prevSpace) continue; out += ' '; map.push(i); prevSpace = true; continue; }
      prevSpace = false;
      const low = c.toLowerCase();
      for (let j = 0; j < low.length; j++) { out += low[j]; map.push(i); }
    }
    return { norm: out, map };
  }
  function pinCore(text) {
    let n = normMap(text).norm.trim();
    n = n.replace(/^["']+/, '').replace(/[.!?,;:"']+$/, '').trim();
    return n;
  }
  // Where `core` occurs in `norm` as whole words: "he" is not found inside "The".
  const WORD_CH = /[\p{L}\p{N}]/u;
  function findWhole(norm, core) {
    const head = WORD_CH.test(core[0]), tail = WORD_CH.test(core[core.length - 1]);
    for (let at = norm.indexOf(core); at >= 0; at = norm.indexOf(core, at + 1)) {
      if (head && at > 0 && WORD_CH.test(norm[at - 1])) continue;
      const end = at + core.length;
      if (tail && end < norm.length && WORD_CH.test(norm[end])) continue;
      return at;
    }
    return -1;
  }
  function findPins(text, pins) {
    const { norm, map } = normMap(text);
    return (pins || []).map((p) => {
      const core = pinCore(p.text);
      if (!core) return { id: p.id, text: p.text, found: true, start: -1, end: -1 };
      const at = findWhole(norm, core);
      if (at < 0) return { id: p.id, text: p.text, found: false, start: -1, end: -1 };
      return { id: p.id, text: p.text, found: true, start: map[at], end: map[at + core.length - 1] + 1 };
    });
  }

  // ---------------------------------------------------------------- authorship spans
  // A passage's text is covered by spans {s, e, o, wet}: o is 'typed' or 'pinned' (the author's
  // hand), 'inked' (the model's) or 'pasted' (came in from outside the studio, so nobody's hand
  // as far as the record knows). Ink stays wet until the author sets it.

  const ORIGINS = new Set(['typed', 'pinned', 'pasted']);
  function normSpans(spans, len) {
    const out = [];
    const push = (y) => {
      const last = out[out.length - 1];
      if (last && last.e === y.s && last.o === y.o && last.wet === y.wet) last.e = y.e;
      else out.push(y);
    };
    const sorted = (spans || [])
      .map((x) => ({ s: clamp(x.s | 0, 0, len), e: clamp(x.e | 0, 0, len), o: ORIGINS.has(x.o) ? x.o : 'inked', wet: !!x.wet }))
      .filter((x) => x.e > x.s)
      .sort((a, b) => a.s - b.s);
    let pos = 0;
    for (const x of sorted) {
      // A gap has no known author. Count it as inked so the author's share is never overstated.
      if (x.s > pos) push({ s: pos, e: x.s, o: 'inked', wet: false });
      const s = Math.max(x.s, pos);
      if (x.e <= s) continue;
      push({ s, e: x.e, o: x.o, wet: x.o === 'inked' ? x.wet : false });
      pos = x.e;
    }
    if (pos < len) push({ s: pos, e: len, o: 'inked', wet: false });
    return out;
  }
  function diffRange(a, b) {
    let p = 0;
    const max = Math.min(a.length, b.length);
    while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let s = 0;
    while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    return { at: p, del: a.slice(p, a.length - s), ins: b.slice(p, b.length - s) };
  }
  // The spans of text[s, e), relative to s.
  function sliceSpans(spans, len, s, e) {
    const out = [];
    for (const x of normSpans(spans, len)) {
      const a = Math.max(x.s, s), b = Math.min(x.e, e);
      if (b > a) out.push({ s: a - s, e: b - s, o: x.o, wet: x.wet });
    }
    return out;
  }

  // Where inserted text came from. Each source is {text, spans}. A source equal to the whole
  // insertion (an undo, a cut pasted back) is taken whole, whatever its length; otherwise runs of
  // at least TRACE characters found in a source keep the origin they have there. The rest gets
  // `fallback`. Runs are found through a rolling hash of every TRACE-long window of the sources.
  // TRACE is long enough that common phrases (" all the way to the ", 20 characters) don't match
  // by chance, even against the 400,000 characters of sources a world can offer.
  const TRACE = 24;
  function traceInsert(ins, sources, fallback) {
    const L = ins.length;
    const srcs = (sources || []).filter((x) => x && x.text);
    const norm = new Map();
    const spansOf = (si) => { if (!norm.has(si)) norm.set(si, normSpans(srcs[si].spans, srcs[si].text.length)); return norm.get(si); };
    const out = [];
    const take = (si, at, n, to) => {
      for (const x of spansOf(si)) {
        const s = Math.max(x.s, at), e = Math.min(x.e, at + n);
        if (e > s) out.push({ s: to + s - at, e: to + e - at, o: x.o, wet: x.wet });
      }
    };
    const whole = srcs.findIndex((x) => x.text === ins);
    if (whole >= 0) { take(whole, 0, L, 0); return normSpans(out, L); }
    const hashAt = [];
    const index = new Map();
    if (L >= TRACE) {
      let BK = 1;
      for (let i = 1; i < TRACE; i++) BK = Math.imul(BK, 257);
      const roll = (t, fn) => {
        let hh = 0;
        for (let j = 0; j < t.length; j++) {
          if (j >= TRACE) hh = (hh - Math.imul(t.charCodeAt(j - TRACE), BK)) | 0;
          hh = (Math.imul(hh, 257) + t.charCodeAt(j)) | 0;
          if (j >= TRACE - 1) fn(hh, j - TRACE + 1);
        }
      };
      roll(ins, (hh, at) => { hashAt[at] = hh; });
      const want = new Set(hashAt);
      srcs.forEach((x, si) => roll(x.text, (hh, at) => {
        if (!want.has(hh)) return;
        const list = index.get(hh);
        if (!list) index.set(hh, [si, at]);
        else if (list.length < 16) list.push(si, at);
      }));
    }
    let i = 0, miss = -1;
    const endMiss = (to) => { if (miss >= 0) { out.push({ s: miss, e: to, o: fallback, wet: false }); miss = -1; } };
    while (i < L) {
      let best = null;
      const list = i + TRACE <= L ? index.get(hashAt[i]) : null;
      if (list) {
        for (let q = 0; q < list.length; q += 2) {
          const t = srcs[list[q]].text, at = list[q + 1];
          let n = 0;
          while (i + n < L && at + n < t.length && ins.charCodeAt(i + n) === t.charCodeAt(at + n)) n++;
          if (n >= TRACE && (!best || n > best.n)) best = { si: list[q], at, n };
        }
      }
      if (best) { endMiss(i); take(best.si, best.at, best.n, i); i += best.n; }
      else { if (miss < 0) miss = i; i++; }
    }
    endMiss(L);
    return normSpans(out, L);
  }

  // The author changed oldText into newText. What they type is theirs. What they paste, drop or
  // bring back with undo (`how`: 'paste' or 'restore') keeps the origin it had where it came
  // from: this scene, text removed earlier, the model's own output (`sources`). What can't be
  // traced is 'pasted'. Returns the new spans, the edit, and what was removed with its origins.
  function applyEdit(oldText, spans, newText, opts) {
    if (oldText === newText) return { spans: normSpans(spans, newText.length), edit: null, removed: null };
    const how = (opts && opts.how) || 'type';
    const d = diffRange(oldText, newText);
    const delEnd = d.at + d.del.length, shift = d.ins.length - d.del.length;
    const old = normSpans(spans, oldText.length);
    const out = [];
    for (const x of old) {
      if (x.s < d.at) out.push(Object.assign({}, x, { e: Math.min(x.e, d.at) }));
      if (x.e > delEnd) out.push(Object.assign({}, x, { s: Math.max(x.s, delEnd) + shift, e: x.e + shift }));
    }
    if (d.ins.length && how === 'type') out.push({ s: d.at, e: d.at + d.ins.length, o: 'typed', wet: false });
    else if (d.ins.length) {
      const sources = ((opts && opts.sources) || []).concat([{ text: oldText, spans: old }]);
      for (const x of traceInsert(d.ins, sources, 'pasted')) out.push(Object.assign({}, x, { s: x.s + d.at, e: x.e + d.at }));
    }
    const removed = d.del ? { text: d.del, at: d.at, spans: sliceSpans(old, oldText.length, d.at, delEnd) } : null;
    return { spans: normSpans(out, newText.length), edit: d, removed };
  }

  // Text the author removed, kept for a while so that an undo or a paste can give it back its
  // origin. A run of backspaces (or of deletes) is one piece, the way the browser undoes it.
  // Pieces are {text, spans, at, kind, key}: kind is the browser's input type, key the scene.
  function rememberRemoved(list, piece) {
    const out = (list || []).slice();
    if (!piece || !piece.text) return out;
    const join = (a, b) => ({ text: a.text + b.text, spans: (a.spans || []).concat((b.spans || []).map((x) => Object.assign({}, x, { s: x.s + a.text.length, e: x.e + a.text.length }))) });
    const last = out[out.length - 1];
    if (last && /^delete/.test(piece.kind || '') && last.kind === piece.kind && last.key === piece.key) {
      if (piece.at + piece.text.length === last.at) out[out.length - 1] = Object.assign({}, last, join(piece, last), { at: piece.at });
      else if (piece.at === last.at) out[out.length - 1] = Object.assign({}, last, join(last, piece));
      else out.push(piece);
    } else out.push(piece);
    let total = 0, from = out.length;
    while (from > 0 && out.length - from < 40 && total + out[from - 1].text.length <= 60000) total += out[--from].text.length;
    return out.slice(Math.min(from, out.length - 1));
  }
  function overlay(spans, len, s, e, attrs) {
    const out = [];
    for (const x of normSpans(spans, len)) {
      if (x.e <= s || x.s >= e) { out.push(x); continue; }
      if (x.s < s) out.push(Object.assign({}, x, { e: s }));
      out.push(Object.assign({}, x, attrs, { s: Math.max(x.s, s), e: Math.min(x.e, e) }));
      if (x.e > e) out.push(Object.assign({}, x, { s: e }));
    }
    return normSpans(out, len);
  }
  function splice(text, spans, s, e, repl, attrs) {
    const next = text.slice(0, s) + repl + text.slice(e);
    const shift = repl.length - (e - s);
    const out = [];
    for (const x of normSpans(spans, text.length)) {
      if (x.s < s) out.push(Object.assign({}, x, { e: Math.min(x.e, s) }));
      if (x.e > e) out.push(Object.assign({}, x, { s: Math.max(x.s, e) + shift, e: x.e + shift }));
    }
    if (repl.length) out.push(Object.assign({ s, e: s + repl.length }, attrs));
    return { text: next, spans: normSpans(out, next.length) };
  }
  function markPins(text, spans, pins) {
    let sp = normSpans(spans, text.length);
    const results = findPins(text, pins);
    for (const r of results) if (r.found && r.start >= 0) sp = overlay(sp, text.length, r.start, r.end, { o: 'pinned', wet: false });
    return { spans: sp, results };
  }
  function isWet(p) { return !!(p && (p.spans || []).some((x) => x.wet)); }

  // Words by origin. A word belongs to whoever wrote its first letter. Only typed and pinned
  // words are the author's hand; pasted words are counted, but not as anyone's.
  function handStats(text, spans) {
    text = String(text || '');
    const words = { typed: 0, pinned: 0, inked: 0, pasted: 0 };
    const chars = { typed: 0, pinned: 0, inked: 0, pasted: 0 };
    const ns = normSpans(spans, text.length);
    for (const x of ns) chars[x.o] += x.e - x.s;
    const re = /\S+/g;
    let m, j = 0;
    while ((m = re.exec(text))) {
      while (j < ns.length && ns[j].e <= m.index) j++;
      words[ns[j] ? ns[j].o : 'inked']++;
    }
    const total = words.typed + words.pinned + words.inked + words.pasted;
    return { words, chars, total, hand: total ? (words.typed + words.pinned) / total : 0 };
  }
  function sumStats(list) {
    const words = { typed: 0, pinned: 0, inked: 0, pasted: 0 };
    for (const s of list) for (const k of Object.keys(words)) words[k] += s.words[k] || 0;
    const total = words.typed + words.pinned + words.inked + words.pasted;
    return { words, total, hand: total ? (words.typed + words.pinned) / total : 0 };
  }

  // ---------------------------------------------------------------- passages and the ledger

  function passageId(chapterId, k) { return chapterId + '__s' + (k + 1); }

  function mergePremises(a, b) {
    const m = new Map((a || []).map((x) => [x.f, x.v]));
    for (const x of b || []) m.set(x.f, x.v);
    return [...m].map(([f, v]) => ({ f, v }));
  }

  // Everything the model has written for a scene, newest first, so that its words are known as
  // its words even after they were deleted and pasted back. Kept under 30,000 characters.
  const INK_KEEP = 30000;
  function inkedRuns(p) {
    if (!p || !p.text) return [];
    return normSpans(p.spans, p.text.length).filter((x) => x.o === 'inked').map((x) => p.text.slice(x.s, x.e)).filter((t) => t.trim().length >= TRACE);
  }
  function inkHistory(newer, p) {
    const all = (newer || []).concat(p ? p.inkSource || inkedRuns(p) : []);
    const out = [];
    let total = 0;
    for (const t of all) { if (!t || total + t.length > INK_KEEP) continue; out.push(t); total += t.length; }
    return out;
  }
  const inkPiece = (t) => ({ text: t, spans: [{ s: 0, e: t.length, o: 'inked', wet: true }] });

  // A freshly inked scene: all of it wet, except the author's pinned lines.
  function inkedPassage({ chapterId, k, prose, used, fresh, pins, now, prev }) {
    const base = [{ s: 0, e: prose.length, o: 'inked', wet: true }];
    const { spans, results } = markPins(prose, base, pins);
    return {
      id: passageId(chapterId, k), chapter: chapterId, scene: k,
      text: prose, spans, inkSource: inkHistory([prose], prev),
      premises: [], pending: used || [],
      proposals: (fresh || []).map((x) => ({ id: uid('nf'), about: x.about, text: x.text, status: 'new' })),
      pinChecks: results.map((r) => ({ id: r.id, found: r.found })),
      conflicts: [], checkedAt: null,
      edits: [], editCount: prev ? prev.editCount || 0 : 0,
      inks: (prev ? prev.inks || 0 : 0) + 1, repaints: prev ? prev.repaints || 0 : 0,
      inkedAt: now || 0, setAt: null, reviewedAt: null, updatedAt: now || 0,
    };
  }
  // A scene the author writes by hand.
  function handPassage({ chapterId, k, now }) {
    return {
      id: passageId(chapterId, k), chapter: chapterId, scene: k, text: '', spans: [],
      premises: [], pending: [], proposals: [], pinChecks: [], conflicts: [], checkedAt: null,
      edits: [], editCount: 0, inks: 0, repaints: 0, inkedAt: null, setAt: null, reviewedAt: null, updatedAt: now || 0,
    };
  }
  // Repainting a selection replaces only that range. Earlier premises still hold for the rest.
  function repaintPassage(p, s, e, repl, used, fresh, pins, now) {
    const r = splice(p.text, p.spans, s, e, repl, { o: 'inked', wet: true });
    const { spans, results } = markPins(r.text, r.spans, pins);
    return Object.assign({}, p, {
      text: r.text, spans, inkSource: inkHistory([repl], p),
      pending: mergePremises(p.pending, used),
      proposals: (p.proposals || []).concat((fresh || []).map((x) => ({ id: uid('nf'), about: x.about, text: x.text, status: 'new' }))).slice(-12),
      pinChecks: results.map((x) => ({ id: x.id, found: x.found })),
      conflicts: (p.conflicts || []).filter((c) => c.end <= s || c.start >= e || c.start < 0).map((c) => {
        if (c.start >= e) { const d = repl.length - (e - s); return Object.assign({}, c, { start: c.start + d, end: c.end + d }); }
        return c;
      }),
      repaints: (p.repaints || 0) + 1, updatedAt: now || 0,
    });
  }
  // The author edited the text: typed it (the default), or pasted, dropped or restored it
  // (`opts.how`), in which case the model's earlier words for this scene are a source too.
  function editPassage(p, newText, pins, now, opts) {
    if (newText === p.text) return p;
    const inkSource = p.inkSource || inkHistory([], p);
    const how = (opts && opts.how) || 'type';
    const r = applyEdit(p.text, p.spans, newText, how === 'type' ? null : { how, sources: ((opts && opts.sources) || []).concat(inkSource.map(inkPiece)) });
    const { spans, results } = markPins(newText, r.spans, pins);
    return Object.assign({}, p, { text: newText, spans, inkSource, pinChecks: results.map((x) => ({ id: x.id, found: x.found })), updatedAt: now || 0 });
  }

  function recordEdit(p, before, after, now) {
    const d = diffRange(before, after);
    if (!d.del && !d.ins) return p;
    const edits = (p.edits || []).concat([{ at: now || 0, pos: d.at, del: d.del.slice(0, 300), ins: d.ins.slice(0, 300) }]).slice(-120);
    return Object.assign({}, p, { edits, editCount: (p.editCount || 0) + 1 });
  }

  // Setting a passage dries the ink and records its premises: the version of every fact it used.
  // `found` adds what the finished text shows it relies on (see `relies`); a premise the ledger
  // already holds keeps its version, so setting never hides a change. A scene with a missing pin
  // or an open contradiction can't be set.
  function setPassage(p, pins, now, found) {
    if (!p.text.trim()) return { ok: false, reason: 'empty', missing: [] };
    const results = findPins(p.text, pins);
    const missing = results.filter((r) => !r.found);
    if (missing.length) return { ok: false, reason: 'pins', missing };
    const open = openConflicts(p);
    if (open.length) return { ok: false, reason: 'conflicts', missing: [], conflicts: open };
    let spans = normSpans(p.spans.map((x) => Object.assign({}, x, { wet: false })), p.text.length);
    for (const r of results) if (r.start >= 0) spans = overlay(spans, p.text.length, r.start, r.end, { o: 'pinned', wet: false });
    return {
      ok: true,
      passage: Object.assign({}, p, {
        spans, premises: mergePremises(found || [], mergePremises(p.premises, p.pending)), pending: [],
        pinChecks: results.map((x) => ({ id: x.id, found: true })),
        setAt: now || 0, reviewedAt: null, updatedAt: now || 0,
      }),
    };
  }

  // Stale: a fact this passage relied on has changed since. Scoped to the facts it used; strict
  // mode also flags any change to anyone on the page. A newer version that reads exactly as the
  // one relied on (a change undone, or reworded back) still holds; an unknown old wording doesn't.
  function staleness(p, idx, opts) {
    const reasons = [];
    if (!p) return { stale: false, reasons };
    const check = (list, phase) => {
      for (const pr of list || []) {
        const hit = idx.get(pr.f);
        if (!hit) { reasons.push({ f: pr.f, kind: 'removed', phase, from: pr.v, before: null, after: null, entity: null }); continue; }
        const { fact, entity } = hit;
        if (fact.retired) reasons.push({ f: pr.f, kind: 'retired', phase, entity: entity.name, entityId: entity.id, before: factTextAt(fact, pr.v), after: null, from: pr.v, to: fact.v });
        else if (fact.v !== pr.v && factTextAt(fact, pr.v) !== fact.text) reasons.push({ f: pr.f, kind: 'changed', phase, entity: entity.name, entityId: entity.id, before: factTextAt(fact, pr.v), after: fact.text, from: pr.v, to: fact.v });
      }
    };
    check(p.premises, 'set');
    check(p.pending, 'wet');
    if (opts && opts.strict && p.setAt && opts.onPage && opts.entities) {
      const since = Math.max(p.setAt || 0, p.reviewedAt || 0);
      const have = new Set((p.premises || []).map((x) => x.f));
      for (const eid of opts.onPage) {
        const e = getFrom(opts.entities, eid);
        if (!e) continue;
        for (const f of e.facts || []) {
          if (!have.has(f.id) && (f.at || 0) > since) reasons.push({ f: f.id, kind: 'strict', phase: 'set', entity: e.name, entityId: e.id, before: null, after: f.retired ? null : f.text, to: f.v });
        }
      }
    }
    return { stale: reasons.length > 0, reasons };
  }

  // The author re-read the passage against the changed facts and it still holds.
  function stillTrue(p, idx, now, factIds) {
    const want = factIds ? new Set(factIds) : null;
    const fix = (list) => (list || []).flatMap((pr) => {
      if (want && !want.has(pr.f)) return [pr];
      const hit = idx.get(pr.f);
      if (!hit || hit.fact.retired) return [];
      return [{ f: pr.f, v: hit.fact.v }];
    });
    return Object.assign({}, p, { premises: fix(p.premises), pending: fix(p.pending), reviewedAt: now || 0, updatedAt: now || 0 });
  }

  function passageState(p, idx, opts) {
    if (!p || !String(p.text || '').trim()) return 'empty';
    if (staleness(p, idx, opts).stale) return 'stale';
    if (isWet(p)) return 'wet';
    if (p.setAt) return 'set';
    return 'draft';
  }

  // Which passages rely on a fact: shown next to the fact, before anyone changes it.
  function dependents(passages, factId) {
    return valuesOf(passages).filter((p) => (p.premises || []).concat(p.pending || []).some((x) => x.f === factId));
  }

  // ---------------------------------------------------------------- continuity check

  function buildContinuityPrompt({ world, text, items }) {
    const factMap = {};
    let n = 0;
    const lines = [];
    for (const { e, f } of items) {
      const key = 'F' + ++n;
      factMap[key] = { id: f.id, v: f.v };
      lines.push(`[${key}] ${e.kind === 'rule' ? 'World rule' : e.name}: ${f.text}`);
    }
    const prompt = `You are checking one scene of the novel "${world.title || 'Untitled'}" against the author's canon. `
      + 'First, list only clear contradictions: places where the scene states or implies something that conflicts with a canon fact. '
      + "Ignore style, and ignore anything the canon doesn't cover. "
      + 'Second, list every canon fact the scene relies on: facts it states, shows, or would have to change if the fact changed, whether or not it contradicts them.\n\n'
      + 'CANON\n' + (lines.join('\n') || '(none)') + '\n\n'
      + 'SCENE\n"""\n' + String(text || '') + '\n"""\n\n'
      + 'Reply with only JSON in this form: {"conflicts": [{"fact": "F2", "quote": "exact words copied from the scene, under 20 words", "why": "one short sentence"}], "relies": ["F1", "F2"]}. '
      + 'If there are no contradictions, "conflicts" is []. If the scene relies on none of the facts, "relies" is [].';
    return { prompt, factMap };
  }
  function parseContinuity(json, text, factMap) {
    const list = json && Array.isArray(json.conflicts) ? json.conflicts : [];
    const { norm, map } = normMap(text);
    return list.slice(0, 8).map((c) => {
      const ref = factMap[String((c && c.fact) || '').trim().toUpperCase().replace(/^\[|\]$/g, '')];
      const q = String((c && c.quote) || '').trim();
      let start = -1, end = -1;
      const core = normMap(q.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')).norm.trim();
      if (core) {
        let at = findWhole(norm, core);
        if (at < 0) at = norm.indexOf(core);
        if (at >= 0) { start = map[at]; end = map[at + core.length - 1] + 1; }
      }
      return { id: uid('cf'), f: ref ? ref.id : null, quote: q.slice(0, 200), why: String((c && c.why) || '').slice(0, 240), start, end, kept: null };
    }).filter((c) => c.f || c.start >= 0);
  }
  // The facts the check says the scene depends on, contradicted or not.
  function parseRelies(json, factMap) { return refsFrom(json && json.relies, factMap); }

  // Contradictions the author has neither fixed nor kept. Each one blocks setting the scene.
  function openConflicts(p) { return ((p && p.conflicts) || []).filter((c) => !c.kept); }
  // The author keeps a contradiction on purpose (a lie, a mistake the character makes, canon
  // about to change), or takes that back. `ref` is the conflict's id, or its index for old ones.
  function keepConflict(p, ref, now, keep) {
    const on = keep !== false;
    const conflicts = (p.conflicts || []).map((c, i) => ((c.id != null ? c.id === ref : i === ref) ? Object.assign({}, c, { kept: on ? now || 1 : null }) : c));
    return Object.assign({}, p, { conflicts, updatedAt: now || 0 });
  }
  // A re-check reports the same contradictions again; the ones the author kept stay kept.
  function mergeConflicts(old, fresh) {
    const key = (c) => (c.f || '') + '|' + normMap(String(c.quote || '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')).norm.trim();
    const kept = new Map((old || []).filter((c) => c.kept).map((c) => [key(c), c.kept]));
    return (fresh || []).map((c) => (kept.has(key(c)) ? Object.assign({}, c, { kept: kept.get(key(c)) }) : c));
  }

  // ---------------------------------------------------------------- the dream inbox

  function buildSeedPrompt({ world, fragment, names }) {
    return `A writer caught this fragment from a dream or daydream, for their story world "${world.title || 'Untitled'}"`
      + (world.premise ? ` (${world.premise})` : '') + '.\n\n'
      + 'FRAGMENT\n"""\n' + String(fragment || '').slice(0, 4000) + '\n"""\n\n'
      + (names && names.length ? 'Names already in the world: ' + names.slice(0, 60).join(', ') + '.\n\n' : '')
      + "Suggest up to 5 seeds the writer might keep: a place, a character, a faction, a thing or creature, or a rule of the world. Ground each one in the fragment's own images. "
      + 'If a seed adds to something already in the world, use its existing name.\n\n'
      + 'Reply with only JSON in this form: {"seeds": [{"kind": "place", "name": "short name", "fact": "one sentence the writer could keep as canon"}]}. Kind is one of: character, place, faction, thing, rule.';
  }
  function parseSeeds(json) {
    const list = json && Array.isArray(json.seeds) ? json.seeds : [];
    return list.slice(0, 6).filter((s) => s && s.name && s.fact).map((s) => ({
      id: uid('sd'),
      kind: KINDS.includes(String(s.kind).toLowerCase()) ? String(s.kind).toLowerCase() : 'thing',
      name: String(s.name).trim().slice(0, 80), fact: String(s.fact).trim().slice(0, 300), status: 'new',
    }));
  }

  // ---------------------------------------------------------------- ripples

  // A fact is never alone. Ripples think one through with its author, who overthinks it and
  // decides. Claude checks what the fact breaks, then offers four directions it could lead, each a
  // question with four possible answers: the author picks one, rewrites it, or answers in their own
  // words. Claude never adds a fact itself. The canon goes in nearest first: the fact's own
  // entity, then everything the fact names, then the rest.
  function rippleCanon(entities, eid, fid, limit) {
    const all = valuesOf(entities), self = all.find((e) => e.id === eid);
    const fact = self && (self.facts || []).find((f) => f.id === fid);
    const text = fact ? fact.text : '';
    const rank = (e) => (e.id === eid ? 0 : mentions(text, e.name) ? 1 : 2);
    const items = [];
    for (const e of all.slice().sort((a, b) => rank(a) - rank(b))) for (const f of e.facts || []) if (!f.retired && f.id !== fid) items.push({ e, f });
    return items.slice(0, limit || 120);
  }
  // The scenes it may touch: the ones that rely on the fact, then the ones that name its subject.
  function rippleScenes(passages, entity, fid, where, limit) {
    const list = valuesOf(passages).filter((p) => p && p.text);
    const relies = (p) => (p.premises || []).concat(p.pending || []).some((x) => x.f === fid);
    const picked = list.filter(relies).concat(list.filter((p) => !relies(p) && entity && entity.kind !== 'rule' && mentions(p.text, entity.name)));
    return picked.slice(0, limit || 6).map((p) => ({ p, where: where ? where(p) : '' }));
  }
  // `toward`, when the author asks for help with an idea of their own: one question that takes it
  // further, and nothing else.
  function buildRipplePrompt({ world, entity, fact, items, scenes, toward }) {
    const refMap = {}, lines = [], sceneLines = [];
    const own = String(toward || '').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 200);
    let n = 0, m = 0;
    for (const { e, f } of items || []) {
      const key = 'F' + ++n;
      refMap[key] = { type: 'fact', id: f.id, v: f.v, eid: e.id };
      lines.push(`[${key}] ${e.kind === 'rule' ? 'World rule' : e.name}: ${f.text}`);
    }
    for (const { p, where } of own ? [] : scenes || []) {
      const key = 'S' + ++m;
      refMap[key] = { type: 'scene', id: p.id, chapter: p.chapter, scene: p.scene };
      sceneLines.push(`[${key}] ${where || 'A scene'}:\n"""\n${String(p.text).slice(0, 600)}\n"""`);
    }
    const was = (fact.history || []).length ? fact.history[fact.history.length - 1].text : null;
    const head = `You are thinking through one fact of the story world "${world.title || 'Untitled'}"` + (world.premise ? ` (${world.premise})` : '')
      + ' with its author, who overthinks it. The author decides what is true in this world, never you: you show them what the fact breaks and where it could lead, and they choose.\n\n'
      + 'THE FACT\n' + `${entity.kind === 'rule' ? 'World rule' : entity.name}: ${fact.text}` + (was ? `\n(It used to say: ${was})` : '') + '\n\n'
      + 'THE REST OF THE CANON\n' + (lines.join('\n') || '(none)') + '\n\n'
      + (sceneLines.length ? 'SCENES THAT MAY BE AFFECTED\n' + sceneLines.join('\n\n') + '\n\n' : '');
    const way = '{"label": "where it leads, in 2 to 4 words", "about": "the entry of the canon an answer would belong to, using an existing name where there is one", "kind": "character|place|faction|thing|rule", "question": "one question for the author to decide, under 20 words", "options": ["a possible answer: one sentence that could stand in the canon as written"]}';
    const options = 'Each way has 4 options that differ from each other and that the canon allows: possibilities for the author to pick from or rewrite, not your preference. Ground everything in the world as written.';
    const prompt = own
      ? head + `The author has an idea of where it leads: "${own}".\n\nReply with only JSON in this form: {"ways": [${way}]}. Exactly 1 way: a question that takes the author's idea further, without deciding it for them. ` + options
      : head + `Reply with only JSON in this form: {"breaks": [{"ref": "F2", "why": "one short sentence"}], "ways": [${way}]}. `
        + 'Exactly 4 ways, each a different thread the fact pulls on, named for the part of the world it leads to: a people, a place, a power, a thing, what came before, what comes next. ' + options + ' '
        + 'In breaks, only clear contradictions with the canon or the scenes above, by their key. If nothing breaks, "breaks" is [].';
    return { prompt, refMap };
  }
  // `max`: how many ways to keep (4, or 1 for help with the author's own idea)
  function parseRipples(json, refMap, max) {
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const seen = new Set();
    const once = (k) => { k = k.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; };
    const list = (k) => (json && Array.isArray(json[k]) ? json[k] : []);
    const breaks = list('breaks').slice(0, 12)
      .map((x) => ({ key: clean(x && (x.ref || x.fact || x.scene), 12).toUpperCase().replace(/^\[|\]$/g, ''), why: clean(x && x.why, 240) }))
      .filter((x) => refMap && refMap[x.key] && once('b:' + x.key)).slice(0, 6)
      .map((x) => { const t = refMap[x.key]; return Object.assign({ id: uid('rp'), type: t.type, target: t.id }, t.type === 'fact' ? { eid: t.eid, v: t.v } : { chapter: t.chapter, scene: t.scene }, { why: x.why }); });
    const ways = list('ways').slice(0, 8).filter((x) => x && typeof x === 'object')
      .map((x) => {
        const said = new Set();
        const options = (Array.isArray(x.options) ? x.options : []).slice(0, 8)
          .map((o) => clean(typeof o === 'string' ? o : o && (o.text || o.answer), 300))
          .filter((o) => o && !said.has(o.toLowerCase()) && said.add(o.toLowerCase())).slice(0, 4);
        const kind = String(x.kind).toLowerCase();
        return { label: clean(x.label, 60), about: clean(x.about, 80), kind: KINDS.includes(kind) ? kind : 'thing', question: clean(x.question, 200), options };
      })
      .filter((x) => x.question && once('w:' + x.question)).slice(0, max || 4)
      .map((x) => Object.assign({ id: uid('rp'), status: 'new' }, x, { label: x.label || x.about || 'Another way' }));
    return { breaks, ways };
  }
  // A fact keeps the ripples of the wording they were made from.
  function withRipples(entity, fid, ripples, now) {
    const e = clone(entity);
    const f = (e.facts || []).find((x) => x.id === fid);
    if (f) f.ripples = Object.assign({ at: now || 0, v: f.v }, ripples);
    return e;
  }
  // The directions of a fact's ripples. Ripples from before directions offer their open questions.
  function rippleWays(r) {
    if (!r) return [];
    if (Array.isArray(r.ways)) return r.ways;
    return (r.asks || []).map((q) => ({ id: q.id, label: 'An open question', about: '', kind: 'thing', question: q.text, options: [], status: q.status }));
  }
  // a way of the author's own joins the others: a question about their idea, or the idea itself
  function addRippleWay(entity, fid, way) {
    const e = clone(entity);
    const f = (e.facts || []).find((x) => x.id === fid);
    if (f && f.ripples && way) f.ripples.ways = rippleWays(f.ripples).concat([way]);
    return e;
  }
  // what the author did with a direction: answered (`extra` says with what) or later; and with a
  // consequence or question of earlier ripples: kept, dismissed, answered or later
  function setRippleStatus(entity, fid, rid, status, extra) {
    const e = clone(entity);
    const f = (e.facts || []).find((x) => x.id === fid);
    if (f && f.ripples) for (const r of [].concat(f.ripples.ways || [], f.ripples.follows || [], f.ripples.asks || [])) if (r.id === rid) Object.assign(r, extra || {}, { status });
    return e;
  }
  // Whose fact is it? The author's, unless most of its words came from one of the answers offered.
  function factOrigin(text, offered) {
    const words = (t) => String(t || '').toLowerCase().replace(/[’‘]/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}']+/gu) || [];
    const mine = words(text);
    if (!mine.length) return 'human';
    for (const o of offered || []) {
      const pool = new Map();
      for (const w of words(o)) pool.set(w, (pool.get(w) || 0) + 1);
      let borrowed = 0;
      for (const w of mine) { const k = pool.get(w); if (k) { borrowed++; pool.set(w, k - 1); } }
      if (borrowed * 2 > mine.length) return 'accepted';
    }
    return 'human';
  }

  // ---------------------------------------------------------------- repaint a selection

  function buildRepaintPrompt({ brief, text, s, e, direction }) {
    const parts = brief.parts;
    const marked = text.slice(0, s) + '⟦' + text.slice(s, e) + '⟧' + text.slice(e);
    const prompt = [
      "You are repainting part of a scene for its author. Rewrite only the marked part so it follows the author's direction and fits the text around it. Keep the author's voice and the facts of the world.",
      parts.header,
      'DIRECTION: ' + (String(direction || '').trim() || 'make it better, keeping its meaning'),
      parts.canon, parts.secrets,
      parts.voice,
      'THE SCENE (the part to rewrite is between ⟦ and ⟧):\n"""\n' + marked + '\n"""',
      'OUTPUT\nWrite only the replacement for the marked part: no quotes, no markers, no commentary. Keep roughly the same length unless the direction asks otherwise.\n'
        + `Then write a line containing only ${LEDGER_MARK} and one line of JSON in this form: {"used": ["F1"], "new": []}`,
    ].filter(Boolean).join('\n\n');
    return { prompt, factMap: brief.factMap };
  }
  function parseRepaint(raw, factMap) {
    const r = parseInkOutput(raw, factMap, { keepFirstLine: true });
    r.prose = r.prose.replace(/[⟦⟧]/g, '').replace(/^"""\s*|\s*"""$/g, '').trim();
    return r;
  }

  // ---------------------------------------------------------------- publishing

  function chapterProblems({ chapter, chapterId, passages, idx, strict, entities }) {
    const problems = [];
    let included = 0;
    for (let k = 0; k < chapter.scenes; k++) {
      const p = getFrom(passages, passageId(chapterId, k));
      if (!p || !String(p.text || '').trim()) { problems.push({ k, kind: 'empty', block: false }); continue; }
      included++;
      if (isWet(p)) problems.push({ k, kind: 'wet', block: true });
      const st = staleness(p, idx, { strict, onPage: castIn(chapter, k).map((c) => c.id), entities });
      if (st.stale) problems.push({ k, kind: 'stale', block: true, reasons: st.reasons });
      const open = openConflicts(p);
      if (open.length) problems.push({ k, kind: 'conflict', block: true, conflicts: open });
      const miss = findPins(p.text, (chapter.pins || []).filter((x) => x.scene === k)).filter((r) => !r.found);
      if (miss.length) problems.push({ k, kind: 'pins', block: true, missing: miss });
      if (!p.setAt && !isWet(p)) problems.push({ k, kind: 'unset', block: true });
    }
    if (!included) problems.push({ k: -1, kind: 'nothing', block: true });
    return { ok: !problems.some((x) => x.block), problems };
  }

  // A plate is keyed by what it illustrates: a scene shares its passage's id, an entity is ent__<id>.
  const plateOf = (plates, id) => { const pl = plates ? getFrom(plates, id) : null; return pl && pl.spec ? pl.spec : null; };

  function publishedChapter({ world, chapter, chapterId, passages, plates, now }) {
    const scenes = [], stats = [], pics = [];
    for (let k = 0; k < chapter.scenes; k++) {
      const p = getFrom(passages, passageId(chapterId, k));
      if (!p || !String(p.text || '').trim()) continue;
      scenes.push(p.text);
      stats.push(handStats(p.text, p.spans));
      pics.push(plateOf(plates, passageId(chapterId, k)));
    }
    const sum = sumStats(stats);
    const out = { id: chapterId, title: chapter.title, order: chapterIndex(world, chapterId), scenes, words: sum.total, hand: round2(sum.hand), publishedAt: now || 0 };
    if (pics.some(Boolean)) out.plates = pics;
    return out;
  }

  // The public face of a world: only published chapters, and lore that a reader meets no sooner
  // than the chapter that introduces or reveals it. Unrevealed secrets never leave the studio.
  function publishedWorld({ world, entities, publishedChapters, plates, now }) {
    const pubs = valuesOf(publishedChapters).slice().sort((a, b) => a.order - b.order);
    const orderOf = new Map(pubs.map((c) => [c.id, c.order]));
    const lore = [];
    for (const e of valuesOf(entities)) {
      let firstSeen = null;
      if (e.kind === 'rule') firstSeen = null;
      else for (const c of pubs) { if (mentions(c.scenes.join('\n'), e.name)) { firstSeen = c.order; break; } }
      if (e.kind !== 'rule' && firstSeen == null) continue;
      const facts = [];
      for (const f of e.facts || []) {
        if (f.retired) continue;
        if (!f.secret) facts.push({ text: f.text, from: e.kind === 'rule' ? (pubs[0] ? pubs[0].order : 0) : firstSeen });
        else if (f.reveal && orderOf.has(f.reveal)) facts.push({ text: f.text, from: Math.max(orderOf.get(f.reveal), firstSeen || 0) });
      }
      if (!facts.length) continue;
      const entry = { name: e.name, kind: e.kind, from: e.kind === 'rule' ? Math.min(...facts.map((f) => f.from)) : firstSeen, facts };
      const pic = plateOf(plates, 'ent__' + e.id);
      if (pic) entry.plate = pic;
      lore.push(entry);
    }
    const words = pubs.reduce((s, c) => s + (c.words || 0), 0);
    const handWords = pubs.reduce((s, c) => s + (c.words || 0) * (c.hand || 0), 0);
    return {
      title: world.title, premise: world.premise || '', byline: world.byline || '',
      chapters: pubs.map((c) => ({ id: c.id, title: c.title, order: c.order })),
      lore, words, hand: words ? round2(handWords / words) : 0, publishedAt: now || 0,
    };
  }
  function visibleLore(pubWorld, upTo) {
    return (pubWorld.lore || [])
      .filter((e) => e.from == null || e.from <= upTo)
      .map((e) => Object.assign({}, e, { facts: e.facts.filter((f) => f.from == null || f.from <= upTo) }))
      .filter((e) => e.facts.length);
  }

  // ---------------------------------------------------------------- the book and exports

  // Exports carry set scenes only: wet ink never leaves the studio. Given the canon, the model
  // also lists set scenes that are stale or contradict it, so an export can't carry them silently.
  function bookModel({ world, chapters, passages, entities, plates }) {
    const out = [], problems = [];
    const idx = entities ? factIndex(entities) : null;
    (world.chapterOrder || []).forEach((cid, order) => {
      const ch = getFrom(chapters, cid);
      if (!ch) return;
      const scenes = [];
      for (let k = 0; k < ch.scenes; k++) {
        const p = getFrom(passages, passageId(cid, k));
        if (!p || !String(p.text || '').trim() || isWet(p) || !p.setAt) continue;
        scenes.push({ k, text: p.text, spans: p.spans, stats: handStats(p.text, p.spans), setAt: p.setAt, plate: plateOf(plates, passageId(cid, k)) });
        if (!idx) continue;
        const st = staleness(p, idx, { strict: !!world.strict, onPage: castIn(ch, k).map((c) => c.id), entities });
        if (st.stale) problems.push({ chapter: cid, order, title: ch.title, k, kind: 'stale', reasons: st.reasons });
        const open = openConflicts(p);
        if (open.length) problems.push({ chapter: cid, order, title: ch.title, k, kind: 'conflict', conflicts: open });
      }
      out.push({ id: cid, order, title: ch.title, scenes });
    });
    const sum = sumStats(out.flatMap((c) => c.scenes.map((s) => s.stats)));
    return { title: world.title || 'Untitled', byline: world.byline || '', premise: world.premise || '', chapters: out, stats: sum, problems };
  }
  function paragraphs(text) { return String(text || '').split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean); }
  function pct(x) { return Math.round((x || 0) * 100) + '%'; }
  function howMade(model) {
    const s = model.stats;
    if (!s.total) return 'Made with Inkwash.';
    const pasted = s.words.pasted || 0;
    return `Made with Inkwash. The author wrote ${pct(s.hand)} of the words by hand. `
      + (pasted ? `${pct(pasted / s.total)} was pasted in from elsewhere. ` : '')
      + 'An AI model inked the rest from the author\'s design, and the author kept or edited every line before setting it.';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function xmlText(s) { return esc(String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')); }

  function exportMarkdown(model) {
    const out = [`# ${model.title}`];
    if (model.byline) out.push(`*by ${model.byline}*`);
    if (model.premise) out.push(`> ${model.premise}`);
    for (const ch of model.chapters) {
      if (!ch.scenes.length) continue;
      out.push(`## Chapter ${ch.order + 1}: ${ch.title}`);
      out.push(ch.scenes.map((s) => paragraphs(s.text).join('\n\n')).join('\n\n* * *\n\n'));
    }
    out.push('---', `*${howMade(model)}*`);
    return out.join('\n\n') + '\n';
  }

  const BOOK_CSS = 'body{font-family:Alegreya,Georgia,serif;line-height:1.6;margin:0 auto;max-width:36em;padding:2em 1.25em;color:#1c2230;background:#f8f9f6}'
    + 'h1{font-size:2.2em;line-height:1.15;margin:1.5em 0 .2em}h2{font-size:1.35em;margin:2.5em 0 1em}'
    + '.byline{font-style:italic;color:#4a5263}.premise{color:#4a5263}p{margin:0 0 .9em;text-indent:0}p+p{text-indent:1.4em;margin-top:-.9em}'
    + '.break{text-align:center;letter-spacing:.6em;color:#7c8496;margin:1.4em 0}.made{margin-top:3em;font-size:.9em;color:#4a5263;font-style:italic}'
    + '.plate{margin:1.4em 0}.plate svg{display:block;width:100%;height:auto}'
    + '@media (prefers-color-scheme:dark){body{background:#13151b;color:#e7e5dc}.byline,.premise,.made{color:#b4b6bd}}';

  // A scene's plate, painted by `paint` (InkPlates.paint) when the caller passes it.
  const plateHtml = (s, paint, id) => (paint && s.plate ? `<figure class="plate">${paint(s.plate, { id })}</figure>` : '');

  function exportHtml(model, opts) {
    const paint = opts && opts.paint;
    const body = [];
    body.push(`<h1>${esc(model.title)}</h1>`);
    if (model.byline) body.push(`<p class="byline">by ${esc(model.byline)}</p>`);
    if (model.premise) body.push(`<p class="premise">${esc(model.premise)}</p>`);
    for (const ch of model.chapters) {
      if (!ch.scenes.length) continue;
      body.push(`<h2>Chapter ${ch.order + 1}: ${esc(ch.title)}</h2>`);
      body.push(ch.scenes.map((s) => plateHtml(s, paint, `${ch.id}_${s.k}`) + paragraphs(s.text).map((p) => `<p>${esc(p)}</p>`).join('\n')).join('\n<p class="break">* * *</p>\n'));
    }
    body.push(`<p class="made">${esc(howMade(model))}</p>`);
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + `<title>${esc(model.title)}</title>`
      + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,700;1,400&display=swap">'
      + `<style>${BOOK_CSS}</style></head><body>\n${body.join('\n')}\n</body></html>\n`;
  }

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  // A ZIP with every file stored uncompressed: all an EPUB needs, and its mimetype must be stored.
  function zipStore(files, when) {
    const enc = new TextEncoder();
    const d = new Date(when || Date.now());
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  function xhtml(title, body) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
      + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">\n'
      + `<head><meta charset="UTF-8"/><title>${xmlText(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n`
      + `<body>\n${body}\n</body>\n</html>\n`;
  }
  function exportEpub(model, when, opts) {
    const paint = opts && opts.paint;
    const now = new Date(when || Date.now());
    const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const chapters = model.chapters.filter((c) => c.scenes.length);
    const files = [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n' },
      { name: 'OEBPS/style.css', data: 'body{font-family:serif;line-height:1.5}h1,h2{text-align:center}p{margin:0;text-indent:1.4em}p.first,p.break,p.byline,p.made{text-indent:0}p.break{text-align:center;margin:1em 0}p.byline{text-align:center;font-style:italic}p.made{font-style:italic;margin-top:2em}figure.plate{margin:1em 0}figure.plate svg{width:100%;height:auto}\n' },
      { name: 'OEBPS/title.xhtml', data: xhtml(model.title, `<h1>${xmlText(model.title)}</h1>` + (model.byline ? `\n<p class="byline">by ${xmlText(model.byline)}</p>` : '') + (model.premise ? `\n<p class="first">${xmlText(model.premise)}</p>` : '')) },
    ];
    chapters.forEach((ch, i) => {
      const body = [`<h2>Chapter ${ch.order + 1}: ${xmlText(ch.title)}</h2>`];
      ch.scenes.forEach((s, j) => {
        if (j) body.push('<p class="break">* * *</p>');
        const pic = plateHtml(s, paint, `${ch.id}_${s.k}`);
        if (pic) body.push(pic);
        paragraphs(s.text).forEach((p, n) => body.push(`<p${n === 0 ? ' class="first"' : ''}>${xmlText(p)}</p>`));
      });
      files.push({ name: `OEBPS/ch${i + 1}.xhtml`, data: xhtml(ch.title, body.join('\n')) });
    });
    files.push({ name: 'OEBPS/about.xhtml', data: xhtml('How this book was made', `<h2>How this book was made</h2>\n<p class="made">${xmlText(howMade(model))}</p>`) });
    const navItems = chapters.map((ch, i) => `<li><a href="ch${i + 1}.xhtml">Chapter ${ch.order + 1}: ${xmlText(ch.title)}</a></li>`).join('');
    files.push({ name: 'OEBPS/nav.xhtml', data: xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="title.xhtml">${xmlText(model.title)}</a></li>${navItems}<li><a href="about.xhtml">How this book was made</a></li></ol></nav>`) });
    const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="css" href="style.css" media-type="text/css"/>', '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>']
      .concat(chapters.map((c, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"${paint && c.scenes.some((s) => s.plate) ? ' properties="svg"' : ''}/>`))
      .concat(['<item id="about" href="about.xhtml" media-type="application/xhtml+xml"/>']);
    const spine = ['<itemref idref="title"/>'].concat(chapters.map((c, i) => `<itemref idref="ch${i + 1}"/>`), ['<itemref idref="about"/>']);
    files.push({
      name: 'OEBPS/content.opf',
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">\n'
        + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        + `<dc:identifier id="bookid">urn:uuid:${uuid()}</dc:identifier>\n<dc:title>${xmlText(model.title)}</dc:title>\n`
        + (model.byline ? `<dc:creator>${xmlText(model.byline)}</dc:creator>\n` : '')
        + `<dc:language>en</dc:language>\n<meta property="dcterms:modified">${modified}</meta>\n</metadata>\n`
        + `<manifest>\n${manifest.join('\n')}\n</manifest>\n<spine>\n${spine.join('\n')}\n</spine>\n</package>\n`,
    });
    return zipStore(files, now.getTime());
  }

  function describeScene(world, chapter, k, byId) {
    const [i0, i1] = sceneRange(chapter.scenes, k);
    const t = tensionSummary(chapter.tension, i0, i1);
    return {
      scene: k + 1,
      tension: t ? `${t.level}, ${t.shape}` : null,
      mood: moodMix(chapter.mood, world.pigments, i0, i1).map((m) => `${m.name} ${m.pct}%`),
      cast: castIn(chapter, k).map((c) => (byId.get(c.id) || {}).name).filter(Boolean),
      pins: (chapter.pins || []).filter((p) => p.scene === k).map((p) => p.text),
      notes: (chapter.notes || []).filter((n) => n.scene === k).map((n) => n.text),
    };
  }

  // The bible: the world as data a show or a game can be built from.
  function exportBible({ world, entities, chapters }, now) {
    const list = valuesOf(entities);
    const byId = new Map(list.map((e) => [e.id, e]));
    const titleOf = (cid) => { const c = getFrom(chapters, cid); return c ? c.title : null; };
    return {
      format: 'inkwash-bible/1', exportedAt: new Date(now || Date.now()).toISOString(),
      world: { title: world.title, premise: world.premise || '', byline: world.byline || '' },
      entities: KINDS.flatMap((kind) => list.filter((e) => e.kind === kind).map((e) => ({
        kind, name: e.name,
        facts: (e.facts || []).filter((f) => !f.retired).map((f) => ({ text: f.text, secret: !!f.secret, revealedIn: f.secret && f.reveal ? titleOf(f.reveal) : null, origin: originWords(f) })),
      }))),
      chapters: (world.chapterOrder || []).map((cid) => getFrom(chapters, cid)).filter(Boolean).map((ch) => ({
        title: ch.title, scenes: Array.from({ length: ch.scenes }, (_, k) => describeScene(world, ch, k, byId)),
      })),
    };
  }

  function originWords(f) {
    if (f.origin === 'accepted') return 'suggested by AI, kept by the author';
    if (f.origin === 'imported') return f.declared ? 'brought in from notes the author declared as their own writing (a statement, not verified)' : 'brought in from notes made outside the studio (origin not verified)';
    return 'written by the author';
  }
  // The provenance report: who wrote what, from the authorship record.
  function exportProvenance({ world, entities, chapters, passages, plates }, now) {
    const model = bookModel({ world, chapters, passages, plates });
    const list = valuesOf(entities);
    const facts = list.flatMap((e) => (e.facts || []).filter((f) => !f.retired));
    const imported = facts.filter((f) => f.origin === 'imported');
    const canon = { total: facts.length, author: facts.filter((f) => f.origin !== 'accepted' && f.origin !== 'imported').length, accepted: facts.filter((f) => f.origin === 'accepted').length, imported: imported.length, declaredOwn: imported.filter((f) => f.declared).length };
    const chs = (world.chapterOrder || []).map((cid) => getFrom(chapters, cid)).filter(Boolean);
    const direction = {
      strokes: chs.reduce((s, c) => s + (c.strokes || 0), 0),
      notes: chs.reduce((s, c) => s + (c.notes || []).length, 0),
      pins: chs.reduce((s, c) => s + (c.pins || []).length, 0),
    };
    const rows = model.chapters.map((ch) => ({
      chapter: ch.order + 1, title: ch.title,
      scenes: ch.scenes.map((s) => {
        const p = getFrom(passages, passageId(ch.id, s.k)) || {};
        return { scene: s.k + 1, words: s.stats.total, byAuthor: s.stats.words.typed + s.stats.words.pinned, typed: s.stats.words.typed, pinned: s.stats.words.pinned, inked: s.stats.words.inked, pasted: s.stats.words.pasted, edits: p.editCount || 0, inks: p.inks || 0, repaints: p.repaints || 0, setAt: s.setAt ? new Date(s.setAt).toISOString() : null, spans: s.spans };
      }),
    }));
    const edits = rows.reduce((s, c) => s + c.scenes.reduce((t, x) => t + x.edits, 0), 0);
    const platesPainted = model.chapters.reduce((s, c) => s + c.scenes.filter((x) => x.plate).length, 0);
    const json = {
      format: 'inkwash-provenance/1', exportedAt: new Date(now || Date.now()).toISOString(),
      world: model.title, byline: model.byline,
      summary: { words: model.stats.total, byAuthor: model.stats.words.typed + model.stats.words.pinned, inkedKept: model.stats.words.inked, pastedIn: model.stats.words.pasted, authorShare: round2(model.stats.hand), edits, direction, canon, plates: platesPainted },
      chapters: rows,
      note: 'Inkwash records, for every passage, which text the author typed or pinned, which text an AI model inked, which text was pasted in from outside the studio (its origin unknown, so it is not counted as the author\'s), and when the author set it. Canon facts brought in from notes are counted apart, because their origin is outside the studio; a declaration that they are the author\'s own writing is recorded as a statement, not verified. This is a record of process. It is not legal advice and does not establish copyright ownership.',
    };
    const s = json.summary;
    const md = [
      `# How "${model.title}" was made`,
      `Exported ${json.exportedAt.slice(0, 10)} from Inkwash.` + (model.byline ? ` Author: ${model.byline}.` : ''),
      '## Summary',
      [
        `- Words in set scenes: ${s.words}`,
        `- Written by the author (typed or pinned): ${s.byAuthor} (${pct(s.authorShare)})`,
        `- Inked by an AI model and kept by the author: ${s.inkedKept}`,
        ...(s.pastedIn ? [`- Pasted in from outside the studio, origin unknown: ${s.pastedIn}`] : []),
        `- Edits by the author: ${s.edits}`,
        `- Direction: ${direction.strokes} brush strokes, ${direction.notes} notes, ${direction.pins} pinned lines`,
        ...(s.plates ? [`- Illustrations: ${s.plates} plates, composed by an AI model and painted by Inkwash`] : []),
        `- Canon: ${canon.total} facts, ${canon.author} written by the author and ${canon.accepted} suggested by AI and kept by the author`
          + (canon.imported ? `; ${canon.imported} brought in from notes made outside the studio, origin not verified` + (canon.declaredOwn ? ` (the author declared ${canon.declaredOwn} of them their own writing; that is the author's statement, which Inkwash can't verify)` : '') : ''),
      ].join('\n'),
      '## Chapter by chapter',
      rows.map((c) => `### Chapter ${c.chapter}: ${c.title}\n` + (c.scenes.length
        ? c.scenes.map((x) => `- Scene ${x.scene}: ${x.words} words, ${x.words ? pct(x.byAuthor / x.words) : '0%'} by the author, ${x.edits} edits, set ${x.setAt ? x.setAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'never'}`).join('\n')
        : '- No set scenes yet.')).join('\n\n'),
      '## About this record',
      json.note,
    ].join('\n\n') + '\n';
    return { json, md };
  }

  // ---------------------------------------------------------------- dreamed worlds

  // How a place is spoken of in its first fact, and where on the map a region lies.
  const PLACE_WORD = { capital: 'capital', city: 'city', town: 'town', village: 'village', port: 'port', fortress: 'fortress', ruin: 'ruin', temple: 'temple', tower: 'tower', mine: 'mine', camp: 'camp', wreck: 'wreck', landmark: 'landmark' };
  const FEATURE_WORD = { range: 'mountain range', forest: 'forest', desert: 'desert', marsh: 'marsh', lake: 'lake', river: 'river', chasm: 'chasm', volcano: 'volcano', plain: 'plain', bay: 'bay', island: 'island' };
  const lies = (at) => (at === 'center' ? 'at the heart of' : `in the ${at} of`);
  const slugId = (prefix, name, taken) => {
    const base = prefix + '_' + (String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x');
    let id = base, k = 2;
    while (taken.has(id)) id = `${base}_${k++}`;
    taken.add(id);
    return id;
  };

  // A dreamed world as the studio keeps it: the world itself, a canon of everything in it (each
  // fact marked as suggested and kept), and the atlas that places it all on a map. The geography
  // goes into the canon too, so a scene's brief knows where things are.
  function worldFromDream(d, { now, seed, dream }) {
    const entities = [], add = (kind, name, list) => {
      const e = newEntity(kind, name, now);
      e.facts = list.filter(Boolean).map((t) => newFact(t, 'accepted', now));
      entities.push(e);
      return e;
    };
    for (const r of d.rules) add('rule', r.name, r.facts);
    const regionEnt = new Map();
    for (const g of d.regions) regionEnt.set(g.name, add('place', g.name, [`${g.name} lies ${lies(g.at)} ${d.title}.`].concat(g.facts)));
    const placeEnt = d.places.map((p) => add('place', p.name, [`${p.name} is a ${PLACE_WORD[p.kind] || 'place'} in ${p.region}.`].concat(p.facts)));
    const featureEnt = d.features.map((f) => add('place', f.name, [`${f.name} is a ${FEATURE_WORD[f.kind] || 'feature'} in ${f.region}.`].concat(f.facts)));
    for (const f of d.factions) add('faction', f.name, f.facts);
    for (const c of d.characters) add('character', c.name, c.facts);
    const taken = new Set(), regionId = new Map();
    const regions = d.regions.map((g) => { const id = slugId('r', g.name, taken); regionId.set(g.name, id); return { id, name: g.name, biome: g.biome, at: g.at, size: g.size, relief: g.relief, entity: regionEnt.get(g.name).id }; });
    const atlas = {
      seed, title: d.title, subtitle: d.subtitle, shape: d.shape, climate: d.climate, accent: d.accent, regions,
      places: d.places.map((p, i) => ({ id: slugId('p', p.name, taken), name: p.name, kind: p.kind, region: regionId.get(p.region), near: p.near, entity: placeEnt[i].id })),
      features: d.features.map((f, i) => ({ id: slugId('f', f.name, taken), name: f.name, kind: f.kind, region: regionId.get(f.region), entity: featureEnt[i].id })),
      seas: d.seas,
    };
    const pigments = (d.pigments.length ? d.pigments : [{ name: 'Wonder', color: '#c4952b' }, { name: 'Dread', color: '#3d4f8f' }, { name: 'Grief', color: '#6b7f95' }])
      .slice(0, 5).map((p) => ({ id: uid('p'), name: p.name, color: p.color, line: '' }));
    const world = { title: d.title, premise: d.premise, byline: '', voice: '', sceneWords: 450, pigments, strict: false, example: false, dream: String(dream || '').slice(0, 8000) };
    return { world, entities, atlas };
  }

  // A map drawn for a world that already has a canon: places the canon already names keep their
  // entities and facts untouched; only what the map adds becomes new canon.
  function atlasForWorld(d, entities, { now, seed, title }) {
    const byName = new Map();
    for (const e of valuesOf(entities)) if (e.kind === 'place' || e.kind === 'faction') byName.set(e.name.toLowerCase(), e);
    const fresh = [], use = (name, kind, first, list) => {
      const old = byName.get(name.toLowerCase());
      if (old) return old;
      const e = newEntity(kind, name, now);
      e.facts = [first].concat(list).filter(Boolean).map((t) => newFact(t, 'accepted', now));
      fresh.push(e); byName.set(name.toLowerCase(), e);
      return e;
    };
    const taken = new Set(), regionId = new Map();
    const regions = d.regions.map((g) => {
      const id = slugId('r', g.name, taken); regionId.set(g.name, id);
      return { id, name: g.name, biome: g.biome, at: g.at, size: g.size, relief: g.relief, entity: use(g.name, 'place', `${g.name} lies ${lies(g.at)} ${title}.`, g.facts).id };
    });
    const places = d.places.filter((p) => !regionId.has(p.name)).map((p) => ({ id: slugId('p', p.name, taken), name: p.name, kind: p.kind, region: regionId.get(p.region), near: p.near, entity: use(p.name, 'place', `${p.name} is a ${PLACE_WORD[p.kind] || 'place'} in ${p.region}.`, p.facts).id }));
    const features = d.features.map((f) => ({ id: slugId('f', f.name, taken), name: f.name, kind: f.kind, region: regionId.get(f.region), entity: use(f.name, 'place', `${f.name} is a ${FEATURE_WORD[f.kind] || 'feature'} in ${f.region}.`, f.facts).id }));
    return { entities: fresh, atlas: { seed, title, subtitle: d.subtitle, shape: d.shape, climate: d.climate, accent: d.accent, regions, places, features, seas: d.seas } };
  }

  // Exploring a region adds its new places to the canon and the atlas. Names already on the map
  // are skipped, and nothing already placed moves.
  function exploreRegion(atlas, regionId, x, { now }) {
    const region = (atlas.regions || []).find((g) => g.id === regionId);
    if (!region || !x) return null;
    const known = new Set((atlas.places || []).concat(atlas.features || []).map((p) => p.name.toLowerCase()));
    const taken = new Set((atlas.places || []).concat(atlas.features || [], atlas.regions || []).map((p) => p.id));
    const entities = [], places = [], features = [];
    for (const p of x.places) {
      if (known.has(p.name.toLowerCase())) continue;
      known.add(p.name.toLowerCase());
      const e = newEntity('place', p.name, now);
      e.facts = [`${p.name} is a ${PLACE_WORD[p.kind] || 'place'} in ${region.name}.`].concat(p.facts).map((t) => newFact(t, 'accepted', now));
      entities.push(e);
      places.push({ id: slugId('p', p.name, taken), name: p.name, kind: p.kind, region: regionId, near: p.near, entity: e.id });
    }
    for (const f of x.features) {
      if (known.has(f.name.toLowerCase())) continue;
      known.add(f.name.toLowerCase());
      const e = newEntity('place', f.name, now);
      e.facts = [`${f.name} is a ${FEATURE_WORD[f.kind] || 'feature'} in ${region.name}.`].concat(f.facts).map((t) => newFact(t, 'accepted', now));
      entities.push(e);
      features.push({ id: slugId('f', f.name, taken), name: f.name, kind: f.kind, region: regionId, entity: e.id });
    }
    const next = Object.assign({}, atlas, { places: (atlas.places || []).concat(places), features: (atlas.features || []).concat(features) });
    return { atlas: next, entities, regionFacts: x.facts.map((t) => newFact(t, 'accepted', now)), added: places.length + features.length };
  }

  // ---------------------------------------------------------------- bringing notes in

  // A creator's notes become a proposal to review, never canon on their own. Headings name the
  // entries and the lines under them become their facts, in the creator's own words: nothing is
  // invented, reworded or summed up, only split at sentence ends and cleared of markup. A section
  // heading ("Characters", "Places") gives the kind of every entry under it; anything else has its
  // kind guessed from its name and words, and is marked as a guess. Entries and facts already in
  // the world are recognized, so notes brought in twice add nothing twice.
  const IMPORT_MAX = 200000; // bytes of UTF-8: notes are kept whole in one document, and a document holds 256 KiB
  // The size a string takes stored as UTF-8, which is what the store's limit counts.
  function utf8Bytes(s) {
    s = String(s == null ? '' : s);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  const SECTION_KINDS = [
    ['character', /^(the )?(characters?|people|persons|cast|npcs?|figures|heroes|villains|who'?s who|dramatis personae)$/i],
    ['place', /^(the )?(places?|locations?|regions?|geography|settings?|cities|towns|lands|realms|kingdoms|countries|landmarks|world map|map)$/i],
    ['faction', /^(the )?(factions?|groups?|organi[sz]ations?|orders?|houses|guilds?|clans|families|nations|peoples|cults?|religions?|churches|companies)$/i],
    ['thing', /^(the )?(things?|items?|objects?|artifacts?|artefacts?|relics?|creatures?|bestiary|monsters?|animals?|species|races|beasts|flora|fauna|technology|tech|ships?|weapons?)$/i],
    ['rule', /^(the )?(rules?|laws?|magic|magic system|how magic works|physics|world rules|systems?|curses?|metaphysics|cosmology)$/i],
  ];
  const NAME_HINTS = [
    ['place', /\b(city|town|village|hamlet|river|mountains?|mount|peaks?|sea|ocean|lake|forest|woods|isles?|island|castle|keep|tower|harbou?r|port|valley|desert|kingdom|empire|coast|bay|plains?|marsh|swamp|fen|caves?|caverns?|ruins?|temple|abbey|citadel|fortress|fort|street|district|quarter|bridge|gate|road|pass|highlands?|lowlands?|realm|province|capital|wastes?|reach|vale|hollow)\b/i],
    ['faction', /\b(guild|order|house|clan|tribe|church|cult|council|company|brotherhood|sisterhood|league|legion|court|syndicate|circle|society|army|navy|fleet|crew|union|alliance|dynasty|wardens|knights|riders|keepers|rangers|sentinels|watch)\b/i],
    ['rule', /\b(magic|laws?|rules?|curse|physics|calendar|cosmology|faith|system)\b/i],
    ['thing', /\b(sword|blade|ring|crown|book|tome|map|key|stone|ship|engine|potion|beast|creature|dragon|wolf|machine|relic|artifact|artefact|amulet|staff|wand)\b/i],
  ];
  const TITLE_WORDS = /^(sir|lady|lord|king|queen|prince|princess|captain|brother|sister|mother|father|dr\.?|mr\.?|mrs\.?|ms\.?|admiral|general|duke|duchess|count|countess|baron|baroness|emperor|empress|saint|master|mistress|elder)\b/i;
  const ROLE = /\b(is|was) (a|an|the) [^.]*?\b(king|queen|priest|priestess|captain|soldier|merchant|thief|mage|wizard|witch|knight|lord|lady|prince|princess|daughter|son|mother|father|brother|sister|keeper|smith|healer|scholar|sailor|hunter|farmer|guard|spy|assassin|bard|monk|nun|child|girl|boy|woman|man|widow|orphan|apprentice|leader|commander|ruler|steward)\b/i;
  const RULE_WORDS = /\b(anyone|everyone|whoever|no one|nobody|cannot|can't|must|always|never)\b/i;
  const BULLET = /^\s*(?:[-*+•▪◦‣]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
  const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const SETEXT = /^\s{0,3}(=+|-{2,})\s*$/;
  const RULE_LINE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const BOLD_LINE = /^\s*(\*\*|__)([^*_].*?)\1\s*:?\s*$/;
  const LABEL_LINE = /^\s*([A-Z][^:.!?]{0,40}):\s*$/;
  const NAMED = /^\s*(?:\*\*|__)?([^:—–*_]{1,60}?)(?:\*\*|__)?\s*(?::|—|–|\s-\s)\s*(.*)$/;
  const ABBREV = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|mt|ft|vs|etc|e\.g|i\.e|no|vol|ch|jr|sr|capt|gen|col|lt|sgt|prof|rev|approx|ca|cf)\.$/i;
  // "Age: 34" or "Note: ..." is a fact about whatever it sits under, never an entry of its own
  const ATTRIBUTE = /^(note|notes|nb|also|age|born|died|status|role|title|location|type|kind|description|appearance|personality|occupation|species|race|gender|height|weight|alias|aliases|aka|motto|ruler|population|capital|language|languages|religion|currency|climate|era|date|summary|todo|idea|ideas|question|questions|update|edit|important)$/i;

  function normName(s) { return String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function normFact(s) { return String(s || '').toLowerCase().replace(/[“”"‘’']/g, '').replace(/\s+/g, ' ').replace(/[\s.!?…]+$/, '').trim(); }
  function normSource(s) { return String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
  // FNV-1a, with the length beside it: enough to tell the same notes from different ones
  function hashText(s) {
    let h = 2166136261 >>> 0;
    const str = String(s);
    for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, '0') + '-' + str.length.toString(36);
  }
  // A line as words: markup cleared, links keep where they point, nothing else changes.
  function cleanLine(s) {
    return String(s == null ? '' : s)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*\|(.*)\|\s*$/, (m, row) => row.split('|').map((c) => c.trim()).filter(Boolean).join(' — '))
      .replace(/\s+/g, ' ').trim();
  }
  // Split at sentence ends, not at "Dr." or an initial.
  function sentences(text) {
    const out = [];
    const re = /[.!?…]+["”’)\]]*(?=\s+["“‘(\[]?[A-Z0-9])/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      const piece = text.slice(start, end).trim();
      if (ABBREV.test(piece) || /(?:^|\s)[A-Z]\.$/.test(piece)) continue;
      out.push(piece);
      start = end;
    }
    const last = text.slice(start).trim();
    if (last) out.push(last);
    return out;
  }
  function sectionKind(name) {
    const n = cleanLine(name).replace(/[:.]+$/, '').trim();
    for (const [kind, re] of SECTION_KINDS) if (re.test(n)) return kind;
    return null;
  }
  // a short name, not a sentence: "Harrowgate", "Brother Salt", "The Old Coast"
  function isName(s) {
    const n = cleanLine(s);
    if (ATTRIBUTE.test(n)) return false;
    const words = n.split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= 6 && n.length <= 60 && /^[\p{Lu}\p{N}]/u.test(n)
      && !/[.!?]$/.test(n) && !words.slice(1).some((w) => /^(is|are|was|were|has|have|had|can|will|would|could|should|must|did|does)$/i.test(w));
  }
  // The kind an entry's name and words suggest. Only a guess: the review says so.
  function guessKind(name, facts) {
    if (TITLE_WORDS.test(name)) return { kind: 'character', why: 'the title in its name' };
    for (const [kind, re] of NAME_HINTS) if (re.test(name)) return { kind, why: 'its name' };
    if (facts.some((t) => ROLE.test(t)) || /^(he|she)\b/i.test(facts[0] || '')) return { kind: 'character', why: 'how your notes describe it' };
    if (facts.length && facts.filter((t) => RULE_WORDS.test(t)).length * 2 >= facts.length) return { kind: 'rule', why: 'how your notes describe it' };
    return { kind: 'thing', why: null };
  }

  // Read notes into a plan to review. `entities` and `sources` are the world's own, so what is
  // already there is marked; `split: false` keeps each paragraph as one fact.
  function planImport(text, opts) {
    opts = opts || {};
    const raw = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const base = { title: null, entries: [], hash: null, chars: raw.length, seenBefore: null, counts: { entries: 0, newEntries: 0, facts: 0, newFacts: 0, dupFacts: 0, guessed: 0 } };
    if (!raw.trim()) return Object.assign(base, { empty: true });
    if (raw.length > IMPORT_MAX || utf8Bytes(raw) > IMPORT_MAX) return Object.assign(base, { tooBig: true, max: IMPORT_MAX });
    const lines = raw.split('\n');
    const entries = [], byKey = new Map();
    const firstContent = lines.findIndex((l) => l.trim());
    const topHeadings = lines.filter((l) => /^\s{0,3}#\s/.test(l)).length;
    let title = null, section = null, current = null, entryIndent = -1, closeAtBlank = false;
    let para = [];
    const entryFor = (name, line, kind, from) => {
      const key = normName(name);
      if (!key) return null;
      let e = byKey.get(key);
      if (!e) { e = { key, name, line, kind: kind || null, from: kind ? from : null, facts: [] }; byKey.set(key, e); entries.push(e); }
      else if (!e.kind && kind) { e.kind = kind; e.from = from; }
      return e;
    };
    const unsorted = () => { const e = entryFor('Unsorted notes', 0, null, null); e.unsorted = true; return e; };
    const sectionEntry = () => (section && section.kind === 'rule' ? entryFor(section.name, section.line, 'rule', 'section') : null);
    const addFact = (e, t, line) => { t = cleanLine(t); if (t && /[\p{L}\p{N}]/u.test(t)) e.facts.push({ text: t, line }); };
    const flushPara = () => {
      if (!para.length) return;
      const target = current || sectionEntry() || unsorted();
      const joined = cleanLine(para.map((x) => x.text).join(' '));
      for (const t of opts.split === false ? [joined] : sentences(joined)) addFact(target, t, para[0].line);
      para = [];
      if (closeAtBlank) { current = null; closeAtBlank = false; }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], n = i + 1;
      if (!line.trim()) { flushPara(); continue; }
      let heading = null, level = 0;
      const atx = ATX.exec(line);
      if (atx) { heading = atx[2]; level = atx[1].length; }
      else if (para.length === 1 && SETEXT.test(line) && !BULLET.test(para[0].text)) { heading = para[0].text; level = line.trim()[0] === '=' ? 1 : 2; para = []; }
      else if (RULE_LINE.test(line)) { flushPara(); continue; }
      else if (!BULLET.test(line) && BOLD_LINE.test(line)) { heading = BOLD_LINE.exec(line)[2]; level = 7; }
      else if (!BULLET.test(line) && !para.length && LABEL_LINE.test(line)) { heading = LABEL_LINE.exec(line)[1]; level = 7; }
      if (heading != null) {
        flushPara();
        const name = cleanLine(heading).replace(/[:.]+$/, '').trim();
        if (!name) continue;
        if (level === 1 && i <= firstContent + 1 && topHeadings <= 1 && !title && !entries.length) { title = name; current = null; section = null; continue; }
        if (section && level <= section.level) section = null;
        const sk = sectionKind(name);
        if (sk) { section = { kind: sk, name, line: n, level }; current = null; entryIndent = -1; continue; }
        current = entryFor(name, n, section && section.kind, 'section');
        entryIndent = -1; closeAtBlank = false;
        continue;
      }
      // a table: each row is a fact, its cells kept in order; the rule under the header row isn't
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara();
        if (!/^\s*\|[\s|:-]+\|\s*$/.test(line)) addFact(current || sectionEntry() || unsorted(), line, n);
        continue;
      }
      const bullet = BULLET.exec(line);
      if (bullet) {
        flushPara();
        const indent = line.search(/\S/), rest = line.slice(bullet[0].length);
        if (current && entryIndent >= 0 && indent <= entryIndent) { current = null; entryIndent = -1; }
        if (!current) {
          const named = NAMED.exec(rest);
          if (named && isName(named[1]) && (section || named[2].trim())) {
            current = entryFor(cleanLine(named[1]), n, section && section.kind, 'section');
            entryIndent = indent;
            if (named[2].trim()) addFact(current, named[2], n);
            continue;
          }
        }
        addFact(current || sectionEntry() || unsorted(), rest, n);
        continue;
      }
      // "Name: what it is" on a line of its own starts an entry, even straight after another one
      if ((!current && !para.length) || closeAtBlank) {
        const named = NAMED.exec(line);
        if (named && isName(named[1]) && named[2].trim()) {
          flushPara();
          current = entryFor(cleanLine(named[1]), n, section && section.kind, 'section');
          closeAtBlank = true;
          para.push({ text: named[2], line: n });
          continue;
        }
      }
      para.push({ text: line.trim(), line: n });
    }
    flushPara();

    const existing = valuesOf(opts.entities);
    const byName = new Map(existing.map((e) => [normName(e.name), e]));
    const counts = { entries: 0, newEntries: 0, facts: 0, newFacts: 0, dupFacts: 0, guessed: 0 };
    for (const e of entries) {
      const hit = e.unsorted ? null : byName.get(e.key);
      if (hit) { e.match = { id: hit.id, name: hit.name, kind: hit.kind }; e.kind = hit.kind; e.from = 'canon'; e.certain = true; }
      else if (e.kind) { e.match = null; e.certain = true; }
      else { const g = guessKind(e.name, e.facts.map((f) => f.text)); e.match = null; e.kind = g.kind; e.from = 'guess'; e.why = g.why; e.certain = false; }
      const have = new Set(hit ? (hit.facts || []).filter((f) => !f.retired).map((f) => normFact(f.text)) : []);
      const seen = new Set();
      e.facts = e.facts.filter((f) => { const k = normFact(f.text); if (!k || seen.has(k)) return false; seen.add(k); return true; })
        .map((f, j) => { const dup = have.has(normFact(f.text)); return { key: e.key + '#' + j, text: f.text, line: f.line, dup, keep: !dup }; });
      e.keep = !(hit && e.facts.every((f) => f.dup));
      counts.entries++;
      if (!hit) counts.newEntries++;
      if (!e.certain) counts.guessed++;
      for (const f of e.facts) { counts.facts++; if (f.dup) counts.dupFacts++; else counts.newFacts++; }
    }
    const hash = hashText(normSource(raw));
    const seen = valuesOf(opts.sources).filter((x) => x && x.hash === hash).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return Object.assign(base, { title, entries, hash, counts, seenBefore: seen ? { id: seen.id, name: seen.name, at: seen.at } : null });
  }

  // Turn what the creator kept in the review into canon: new entries, and facts added to entries
  // already there. Every fact keeps where it came from; the notes themselves are kept as written.
  function applyImport(plan, { entities, now, sourceId, sourceName, text, declared }) {
    const touched = new Map(), factIds = [];
    for (const e of plan.entries || []) {
      if (!e.keep) continue;
      const facts = (e.facts || []).filter((f) => f.keep && String(f.text || '').trim());
      const have = e.match && getFrom(entities, e.match.id);
      if (have && !facts.length) continue;
      const ent = have ? (touched.get(have.id) || clone(have)) : newEntity(e.kind, String(e.name || '').replace(/\s+/g, ' ').trim() || 'Unnamed entry', now);
      ent.facts = ent.facts || [];
      for (const f of facts) {
        const nf = newFact(f.text, 'imported', now);
        nf.src = sourceId;
        if (declared) nf.declared = true;
        if (f.edited) nf.editedOnImport = true;
        ent.facts.push(nf);
        factIds.push(nf.id);
      }
      ent.updatedAt = now || 0;
      touched.set(ent.id, ent);
    }
    const source = { id: sourceId, name: String(sourceName || 'Pasted notes').slice(0, 120), text: String(text || ''), hash: plan.hash, at: now || 0, declared: !!declared, entries: touched.size, facts: factIds.length, factIds };
    return { entities: [...touched.values()], source };
  }

  // ---------------------------------------------------------------- history: what can be undone

  function stableJson(x) {
    if (Array.isArray(x)) return '[' + x.map(stableJson).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableJson(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  function docHash(doc) { return doc == null ? 'none' : hashText(stableJson(doc)); }
  // What undo needs to know of an entry after a step: each fact's version and words, and a print
  // of its ripples, so a later change to any of them is noticed.
  function trimEntity(e) {
    return e ? { name: e.name, kind: e.kind, facts: (e.facts || []).map((f) => ({ id: f.id, v: f.v, text: f.text, retired: !!f.retired, secret: !!f.secret, reveal: f.reveal || null, rh: docHash(f.ripples || null) })) } : null;
  }
  // What undo compares to tell whether a document changed since a step: what's in it, not when it
  // was saved, nor what a continuity check last found in a scene (a check doesn't change the scene,
  // and runs on its own right after inking).
  const DERIVED = { passages: ['updatedAt', 'conflicts', 'checkedAt', 'pending'] };
  function contentOf(coll, doc) {
    if (doc == null) return null;
    const out = Object.assign({}, doc);
    for (const k of DERIVED[coll] || ['updatedAt']) delete out[k];
    return out;
  }
  // A step remembers how each document it touched looked before it, and enough of how each looked
  // after it to tell, later, whether anything has changed since: for a canon entry, each fact's
  // version and words; for anything else (scenes, the map, chapters, plates, notes), a print.
  function historyStep({ id, label, kind, at, docs }) {
    return {
      id: id || uid('h'), label: String(label || 'A change'), kind: kind || 'edit', at: at || 0, undone: false,
      docs: (docs || []).map(({ coll, id: did, before, after }) => (coll === 'canon'
        ? { coll, id: did, before: before ? clone(before) : null, after: trimEntity(after) }
        : { coll, id: did, before: before ? clone(before) : null, afterHash: docHash(contentOf(coll, after)) })),
    };
  }
  const sameFact = (a, b) => !!a && !!b && a.v === b.v && a.text === b.text && !!a.retired === !!b.retired;
  // Undo one entry's part of a step, fact by fact. B is the entry before the step, A after it
  // (trimmed), X as it is now. Returns the entry to write (null deletes it; undefined leaves it)
  // and what was left alone because it changed since.
  function undoEntity(B, A, X, now) {
    const kept = [];
    if (!X) return B && !A ? { write: clone(B), kept } : { kept };
    if (B && !A) { kept.push(`${X.name} was made again since`); return { kept }; }
    const next = clone(X);
    const aFacts = new Map(((A && A.facts) || []).map((f) => [f.id, f]));
    const bFacts = new Map(((B && B.facts) || []).map((f) => [f.id, f]));
    let changed = false;
    next.facts = (next.facts || []).filter((f) => {
      if (bFacts.has(f.id) || !aFacts.has(f.id)) return true;
      if (sameFact(f, aFacts.get(f.id))) { changed = true; return false; }
      kept.push(`“${head(f.text, 60)}” changed since, so it stays`);
      return true;
    });
    for (const f of next.facts) {
      const b = bFacts.get(f.id), a = aFacts.get(f.id);
      if (!b || !a) continue;
      if (!sameFact(f, a)) { if (!sameFact(a, b)) kept.push(`“${head(f.text, 60)}” changed since, so it stays`); continue; }
      if (a.text !== b.text || !!a.retired !== !!b.retired) { restoreFact(f, b.text, b.retired, now); changed = true; }
      if (!!f.secret === !!a.secret && (f.reveal || null) === (a.reveal || null) && (!!a.secret !== !!b.secret || (a.reveal || null) !== (b.reveal || null))) { f.secret = !!b.secret; f.reveal = b.reveal || null; changed = true; }
      if (docHash(f.ripples || null) === a.rh && docHash(b.ripples || null) !== a.rh) { if (b.ripples) f.ripples = clone(b.ripples); else delete f.ripples; changed = true; }
    }
    for (const [fid, b] of bFacts) if (!aFacts.has(fid) && !next.facts.some((f) => f.id === fid)) { next.facts.push(clone(b)); changed = true; }
    if (B && A) {
      if (next.name === A.name && A.name !== B.name) { next.name = B.name; changed = true; }
      if (next.kind === A.kind && A.kind !== B.kind) { next.kind = B.kind; changed = true; }
    }
    if (!B && !next.facts.length && A && next.name === A.name) return { write: null, kept };
    if (changed) next.updatedAt = now || 0;
    return changed ? { write: next, kept } : { kept };
  }
  // Undo a step: what it changed goes back, document by document, and anything changed since is
  // left alone and named. `current` holds the world as it is, collection by collection.
  function undoStep(step, current, now) {
    const writes = [], kept = [];
    if (!step || step.undone) return { writes, kept, nothing: true };
    for (const d of step.docs || []) {
      const cur = getFrom(current[d.coll], d.id) || null;
      if (d.coll === 'canon') {
        const r = undoEntity(d.before, d.after, cur, now);
        if (r.write !== undefined) writes.push({ coll: 'canon', id: d.id, doc: r.write });
        kept.push(...r.kept);
      } else if (docHash(contentOf(d.coll, cur)) !== d.afterHash) kept.push(d.coll === 'passages' ? 'a scene changed since, so it stays as it is' : 'something it touched changed since, so it stays');
      else writes.push({ coll: d.coll, id: d.id, doc: d.before ? clone(d.before) : null });
    }
    return { writes, kept };
  }

  // ---------------------------------------------------------------- what a creator did, day by day

  // Counts only, never words: the activity a creator can read in the studio and choose to share.
  // In the first person, because it's the creator's own report. [one, many]
  const ACTIVITY = {
    own: ['fact written in my own words', 'facts written in my own words'], kept: ['suggestion from Claude kept', 'suggestions from Claude kept'],
    imported: ['fact brought in from my notes', 'facts brought in from my notes'], entries: ['new entry', 'new entries'],
    rippleOwn: ['ripple decided in my own words', 'ripples decided in my own words'], rippleClaude: ["ripple decided from Claude's answers", "ripples decided from Claude's answers"],
    edits: ['fact reworded or retired', 'facts reworded or retired'], later: ['question saved for later', 'questions saved for later'],
    sceneEdits: ['stretch of writing in a scene', 'stretches of writing in scenes'], inked: ['scene inked by Claude', 'scenes inked by Claude'],
    scenesSet: ['scene set', 'scenes set'], undos: ['change undone', 'changes undone'],
  };
  function bumpActivity(doc, day, counts) {
    const d = clone(doc) || {};
    d.days = d.days || {};
    const row = Object.assign({}, d.days[day] || {});
    let any = false;
    for (const [k, n] of Object.entries(counts || {})) if (ACTIVITY[k] && n) { row[k] = (row[k] || 0) + n; any = true; }
    if (!any) return null;
    d.days[day] = row;
    return d;
  }
  // `worlds`: [{ example, days }] for every world. Worlds are numbered, never named.
  function activitySummary(worlds, today) {
    const own = (worlds || []).filter((w) => !w.example);
    const allDays = new Set();
    const rows = own.map((w, i) => {
      const days = Object.keys(w.days || {}).sort();
      days.forEach((d) => allDays.add(d));
      const totals = {};
      for (const d of days) for (const [k, n] of Object.entries(w.days[d])) totals[k] = (totals[k] || 0) + n;
      return { world: `World ${i + 1}`, days: days.length, first: days[0] || null, last: days[days.length - 1] || null, totals };
    });
    const days = [...allDays].sort();
    const exampleDays = new Set((worlds || []).filter((w) => w.example).flatMap((w) => Object.keys(w.days || {})));
    const md = [
      '# My Inkwash activity',
      `Made by Inkwash${today ? ' on ' + today : ''}, from counts only: none of my worlds' words are in here.`,
      `- Days I made something in my own worlds: ${days.length}${days.length ? ` (${days.join(', ')})` : ''}`,
      `- Days I only tried an example world: ${[...exampleDays].filter((d) => !allDays.has(d)).length}`,
      ...rows.map((r) => `- ${r.world}: ${r.days} day${r.days === 1 ? '' : 's'}` + (r.first ? `, from ${r.first} to ${r.last}` : '')
        + (Object.keys(r.totals).length ? '. ' + Object.entries(ACTIVITY).filter(([k]) => r.totals[k]).map(([k, label]) => `${r.totals[k]} ${label[r.totals[k] === 1 ? 0 : 1]}`).join(', ') : '')),
    ].join('\n') + '\n';
    return { days, rows, md };
  }

  // ---------------------------------------------------------------- backups

  // Backups carry the notes a world was brought in from. A backup from before that had none, and
  // a reader from before that ignores them, so the format stays inkwash-backup/1.
  function exportBackup({ world, entities, chapters, passages, seeds, plates, atlas, sources }, now) {
    const srcs = valuesOf(sources);
    return {
      format: 'inkwash-backup/1', exportedAt: new Date(now || Date.now()).toISOString(),
      world: clone(world), entities: clone(valuesOf(entities)), chapters: clone(valuesOf(chapters)),
      passages: clone(valuesOf(passages)), seeds: clone(valuesOf(seeds)), plates: clone(valuesOf(plates)),
      ...(atlas ? { atlas: clone(atlas) } : {}),
      ...(srcs.length ? { sources: clone(srcs) } : {}),
    };
  }
  const SEG = /^[A-Za-z0-9_\-.~:@+]{1,180}$/;
  function readBackup(data) {
    if (!data || data.format !== 'inkwash-backup/1' || !data.world || typeof data.world !== 'object') throw new Error('This file is not an Inkwash backup.');
    const need = (arr, what) => {
      if (!Array.isArray(arr)) throw new Error(`The backup has no ${what} list.`);
      for (const x of arr) if (!x || typeof x !== 'object' || !SEG.test(String(x.id || ''))) throw new Error(`A ${what} entry in the backup has a bad id.`);
      return arr;
    };
    return {
      world: data.world,
      entities: need(data.entities || [], 'canon'),
      chapters: need(data.chapters || [], 'chapter'),
      passages: need(data.passages || [], 'passage'),
      seeds: need(data.seeds || [], 'dream'),
      plates: need(data.plates || [], 'plate'),
      atlas: data.atlas && typeof data.atlas === 'object' && !Array.isArray(data.atlas) ? data.atlas : null,
      sources: need(data.sources || [], 'notes'),
    };
  }

  return {
    SAMPLES, KINDS, KIND_LABEL, LEDGER_MARK,
    uid, uuid, clamp, round2, clone, mentions, tail, head,
    sceneRange, sceneAt, newChapter, paintTension, eraseLine, paintWash, paintLine, nudgeTension, washScene, setPresence, resampleScenes,
    tensionSummary, moodMix, castIn, firstMeetings,
    newEntity, newFact, factIndex, reviseFact, retireFact, factTextAt, chapterIndex, sceneFacts,
    buildBrief, wordRange, parseJsonLoose, cleanProse, streamingProse, parseInkOutput, guessUsed, relies, briefItems,
    normMap, pinCore, findPins,
    normSpans, diffRange, sliceSpans, traceInsert, applyEdit, rememberRemoved, overlay, splice, markPins, isWet, handStats, sumStats,
    passageId, mergePremises, inkedPassage, handPassage, repaintPassage, editPassage, recordEdit, setPassage,
    staleness, stillTrue, passageState, dependents,
    buildContinuityPrompt, parseContinuity, parseRelies, openConflicts, keepConflict, mergeConflicts,
    buildSeedPrompt, parseSeeds, rippleCanon, rippleScenes, buildRipplePrompt, parseRipples, withRipples, rippleWays, addRippleWay, setRippleStatus, factOrigin, buildRepaintPrompt, parseRepaint,
    chapterProblems, publishedChapter, publishedWorld, visibleLore,
    bookModel, exportMarkdown, exportHtml, exportEpub, exportBible, exportProvenance, exportBackup, readBackup,
    planImport, applyImport, cleanLine, sentences, guessKind, normName, normFact, hashText, normSource, IMPORT_MAX, utf8Bytes,
    restoreFact, stableJson, docHash, trimEntity, historyStep, undoEntity, undoStep, ACTIVITY, bumpActivity, activitySummary,
    worldFromDream, atlasForWorld, exploreRegion,
    zipStore, crc32, esc, paragraphs, howMade, describeScene,
  };
});
