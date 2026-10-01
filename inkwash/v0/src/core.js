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
  function newFact(text, origin, now) {
    return { id: uid('f'), text: String(text).trim(), v: 1, origin: origin === 'accepted' ? 'accepted' : 'human', secret: false, reveal: null, at: now || 0, history: [], retired: false };
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
  function factTextAt(fact, v) {
    if (fact.v === v && !fact.retired) return fact.text;
    const h = (fact.history || []).find((x) => x.v === v);
    return h ? h.text : null;
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

  function factBlock(items, tag) {
    const groups = new Map();
    for (const { e, f } of items) {
      const label = e.kind === 'rule' ? 'Rules of the world' : `${e.name} (${e.kind})`;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(`  [${tag(f)}] ${f.text}`);
    }
    const out = [];
    for (const [label, lines] of groups) out.push(label, ...lines);
    return out.join('\n');
  }

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
        return byId.get(c.id).name + (bits.length ? ` (${bits.join(', ')})` : '');
      }).join(', ') + '.');
      for (const [a, b] of firsts.slice(0, 3)) shape.push(`- This is the first time ${byId.get(a).name} and ${byId.get(b).name} share a scene.`);
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
    const used = [], seen = new Set();
    for (const key of meta && Array.isArray(meta.used) ? meta.used : []) {
      const ref = factMap[String(key).trim().toUpperCase().replace(/^\[|\]$/g, '')];
      if (ref && !seen.has(ref.id)) { seen.add(ref.id); used.push({ f: ref.id, v: ref.v }); }
    }
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
  function findPins(text, pins) {
    const { norm, map } = normMap(text);
    return (pins || []).map((p) => {
      const core = pinCore(p.text);
      if (!core) return { id: p.id, text: p.text, found: true, start: -1, end: -1 };
      const at = norm.indexOf(core);
      if (at < 0) return { id: p.id, text: p.text, found: false, start: -1, end: -1 };
      return { id: p.id, text: p.text, found: true, start: map[at], end: map[at + core.length - 1] + 1 };
    });
  }

  // ---------------------------------------------------------------- authorship spans
  // A passage's text is covered by spans {s, e, o, wet}: o is 'typed' or 'pinned' (the author's
  // hand) or 'inked' (the model's). Ink stays wet until the author sets it.

  function normSpans(spans, len) {
    const out = [];
    const push = (y) => {
      const last = out[out.length - 1];
      if (last && last.e === y.s && last.o === y.o && last.wet === y.wet) last.e = y.e;
      else out.push(y);
    };
    const sorted = (spans || [])
      .map((x) => ({ s: clamp(x.s | 0, 0, len), e: clamp(x.e | 0, 0, len), o: x.o === 'typed' || x.o === 'pinned' ? x.o : 'inked', wet: !!x.wet }))
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
  // The author changed oldText into newText: whatever they inserted is theirs.
  function applyEdit(oldText, spans, newText) {
    if (oldText === newText) return { spans: normSpans(spans, newText.length), edit: null };
    const d = diffRange(oldText, newText);
    const delEnd = d.at + d.del.length, shift = d.ins.length - d.del.length;
    const out = [];
    for (const x of normSpans(spans, oldText.length)) {
      if (x.s < d.at) out.push(Object.assign({}, x, { e: Math.min(x.e, d.at) }));
      if (x.e > delEnd) out.push(Object.assign({}, x, { s: Math.max(x.s, delEnd) + shift, e: x.e + shift }));
    }
    if (d.ins.length) out.push({ s: d.at, e: d.at + d.ins.length, o: 'typed', wet: false });
    return { spans: normSpans(out, newText.length), edit: d };
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

  function handStats(text, spans) {
    text = String(text || '');
    const words = { typed: 0, pinned: 0, inked: 0 };
    const chars = { typed: 0, pinned: 0, inked: 0 };
    const ns = normSpans(spans, text.length);
    for (const x of ns) chars[x.o] += x.e - x.s;
    const re = /\S+/g;
    let m, j = 0;
    while ((m = re.exec(text))) {
      while (j < ns.length && ns[j].e <= m.index) j++;
      words[ns[j] ? ns[j].o : 'inked']++;
    }
    const total = words.typed + words.pinned + words.inked;
    return { words, chars, total, hand: total ? (words.typed + words.pinned) / total : 0 };
  }
  function sumStats(list) {
    const words = { typed: 0, pinned: 0, inked: 0 };
    for (const s of list) for (const k of Object.keys(words)) words[k] += s.words[k];
    const total = words.typed + words.pinned + words.inked;
    return { words, total, hand: total ? (words.typed + words.pinned) / total : 0 };
  }

  // ---------------------------------------------------------------- passages and the ledger

  function passageId(chapterId, k) { return chapterId + '__s' + (k + 1); }

  function mergePremises(a, b) {
    const m = new Map((a || []).map((x) => [x.f, x.v]));
    for (const x of b || []) m.set(x.f, x.v);
    return [...m].map(([f, v]) => ({ f, v }));
  }

  // A freshly inked scene: all of it wet, except the author's pinned lines.
  function inkedPassage({ chapterId, k, prose, used, fresh, pins, now, prev }) {
    const base = [{ s: 0, e: prose.length, o: 'inked', wet: true }];
    const { spans, results } = markPins(prose, base, pins);
    return {
      id: passageId(chapterId, k), chapter: chapterId, scene: k,
      text: prose, spans,
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
      text: r.text, spans,
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
  // The author edited the text by hand.
  function editPassage(p, newText, pins, now) {
    if (newText === p.text) return p;
    const r = applyEdit(p.text, p.spans, newText);
    const { spans, results } = markPinsTypedOnly(newText, r.spans, pins);
    return Object.assign({}, p, { text: newText, spans, pinChecks: results.map((x) => ({ id: x.id, found: x.found })), updatedAt: now || 0 });
  }
  // Pins found in the author's own edits are already theirs; pins inside ink become pinned.
  function markPinsTypedOnly(text, spans, pins) { return markPins(text, spans, pins); }

  function recordEdit(p, before, after, now) {
    const d = diffRange(before, after);
    if (!d.del && !d.ins) return p;
    const edits = (p.edits || []).concat([{ at: now || 0, pos: d.at, del: d.del.slice(0, 300), ins: d.ins.slice(0, 300) }]).slice(-120);
    return Object.assign({}, p, { edits, editCount: (p.editCount || 0) + 1 });
  }

  // Setting a passage dries the ink and records its premises: the version of every fact it used.
  function setPassage(p, pins, now) {
    if (!p.text.trim()) return { ok: false, reason: 'empty', missing: [] };
    const results = findPins(p.text, pins);
    const missing = results.filter((r) => !r.found);
    if (missing.length) return { ok: false, reason: 'pins', missing };
    let spans = normSpans(p.spans.map((x) => Object.assign({}, x, { wet: false })), p.text.length);
    for (const r of results) if (r.start >= 0) spans = overlay(spans, p.text.length, r.start, r.end, { o: 'pinned', wet: false });
    return {
      ok: true,
      passage: Object.assign({}, p, {
        spans, premises: mergePremises(p.premises, p.pending), pending: [],
        pinChecks: results.map((x) => ({ id: x.id, found: true })),
        setAt: now || 0, reviewedAt: null, updatedAt: now || 0,
      }),
    };
  }

  // Stale: a fact this passage relied on has changed since. Scoped to the facts it used; strict
  // mode also flags any change to anyone on the page.
  function staleness(p, idx, opts) {
    const reasons = [];
    if (!p) return { stale: false, reasons };
    const check = (list, phase) => {
      for (const pr of list || []) {
        const hit = idx.get(pr.f);
        if (!hit) { reasons.push({ f: pr.f, kind: 'removed', phase, from: pr.v, before: null, after: null, entity: null }); continue; }
        const { fact, entity } = hit;
        if (fact.retired) reasons.push({ f: pr.f, kind: 'retired', phase, entity: entity.name, entityId: entity.id, before: factTextAt(fact, pr.v), after: null, from: pr.v, to: fact.v });
        else if (fact.v !== pr.v) reasons.push({ f: pr.f, kind: 'changed', phase, entity: entity.name, entityId: entity.id, before: factTextAt(fact, pr.v), after: fact.text, from: pr.v, to: fact.v });
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
      + 'List only clear contradictions: places where the scene states or implies something that conflicts with a canon fact. '
      + "Ignore style, and ignore anything the canon doesn't cover.\n\n"
      + 'CANON\n' + (lines.join('\n') || '(none)') + '\n\n'
      + 'SCENE\n"""\n' + String(text || '') + '\n"""\n\n'
      + 'Reply with only JSON in this form: {"conflicts": [{"fact": "F2", "quote": "exact words copied from the scene, under 20 words", "why": "one short sentence"}]}. '
      + 'If there are none, reply {"conflicts": []}.';
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
        const at = norm.indexOf(core);
        if (at >= 0) { start = map[at]; end = map[at + core.length - 1] + 1; }
      }
      return { f: ref ? ref.id : null, quote: q.slice(0, 200), why: String((c && c.why) || '').slice(0, 240), start, end };
    }).filter((c) => c.f || c.start >= 0);
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
      const miss = findPins(p.text, (chapter.pins || []).filter((x) => x.scene === k)).filter((r) => !r.found);
      if (miss.length) problems.push({ k, kind: 'pins', block: true, missing: miss });
      if (!p.setAt && !isWet(p)) problems.push({ k, kind: 'unset', block: true });
    }
    if (!included) problems.push({ k: -1, kind: 'nothing', block: true });
    return { ok: !problems.some((x) => x.block), problems };
  }

  function publishedChapter({ world, chapter, chapterId, passages, now }) {
    const scenes = [], stats = [];
    for (let k = 0; k < chapter.scenes; k++) {
      const p = getFrom(passages, passageId(chapterId, k));
      if (!p || !String(p.text || '').trim()) continue;
      scenes.push(p.text);
      stats.push(handStats(p.text, p.spans));
    }
    const sum = sumStats(stats);
    return { id: chapterId, title: chapter.title, order: chapterIndex(world, chapterId), scenes, words: sum.total, hand: round2(sum.hand), publishedAt: now || 0 };
  }

  // The public face of a world: only published chapters, and lore that a reader meets no sooner
  // than the chapter that introduces or reveals it. Unrevealed secrets never leave the studio.
  function publishedWorld({ world, entities, publishedChapters, now }) {
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
      lore.push({ name: e.name, kind: e.kind, from: e.kind === 'rule' ? Math.min(...facts.map((f) => f.from)) : firstSeen, facts });
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

  // Exports carry set scenes only: wet ink never leaves the studio.
  function bookModel({ world, chapters, passages }) {
    const out = [];
    (world.chapterOrder || []).forEach((cid, order) => {
      const ch = getFrom(chapters, cid);
      if (!ch) return;
      const scenes = [];
      for (let k = 0; k < ch.scenes; k++) {
        const p = getFrom(passages, passageId(cid, k));
        if (!p || !String(p.text || '').trim() || isWet(p) || !p.setAt) continue;
        scenes.push({ k, text: p.text, spans: p.spans, stats: handStats(p.text, p.spans), setAt: p.setAt });
      }
      out.push({ id: cid, order, title: ch.title, scenes });
    });
    const sum = sumStats(out.flatMap((c) => c.scenes.map((s) => s.stats)));
    return { title: world.title || 'Untitled', byline: world.byline || '', premise: world.premise || '', chapters: out, stats: sum };
  }
  function paragraphs(text) { return String(text || '').split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean); }
  function pct(x) { return Math.round((x || 0) * 100) + '%'; }
  function howMade(model) {
    const s = model.stats;
    if (!s.total) return 'Made with Inkwash.';
    return `Made with Inkwash. The author painted the shape of every scene and wrote ${pct(s.hand)} of the words by hand. `
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
    + '@media (prefers-color-scheme:dark){body{background:#13151b;color:#e7e5dc}.byline,.premise,.made{color:#b4b6bd}}';

  function exportHtml(model) {
    const body = [];
    body.push(`<h1>${esc(model.title)}</h1>`);
    if (model.byline) body.push(`<p class="byline">by ${esc(model.byline)}</p>`);
    if (model.premise) body.push(`<p class="premise">${esc(model.premise)}</p>`);
    for (const ch of model.chapters) {
      if (!ch.scenes.length) continue;
      body.push(`<h2>Chapter ${ch.order + 1}: ${esc(ch.title)}</h2>`);
      body.push(ch.scenes.map((s) => paragraphs(s.text).map((p) => `<p>${esc(p)}</p>`).join('\n')).join('\n<p class="break">* * *</p>\n'));
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
  function exportEpub(model, when) {
    const now = new Date(when || Date.now());
    const modified = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const chapters = model.chapters.filter((c) => c.scenes.length);
    const files = [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n' },
      { name: 'OEBPS/style.css', data: 'body{font-family:serif;line-height:1.5}h1,h2{text-align:center}p{margin:0;text-indent:1.4em}p.first,p.break,p.byline,p.made{text-indent:0}p.break{text-align:center;margin:1em 0}p.byline{text-align:center;font-style:italic}p.made{font-style:italic;margin-top:2em}\n' },
      { name: 'OEBPS/title.xhtml', data: xhtml(model.title, `<h1>${xmlText(model.title)}</h1>` + (model.byline ? `\n<p class="byline">by ${xmlText(model.byline)}</p>` : '') + (model.premise ? `\n<p class="first">${xmlText(model.premise)}</p>` : '')) },
    ];
    chapters.forEach((ch, i) => {
      const body = [`<h2>Chapter ${ch.order + 1}: ${xmlText(ch.title)}</h2>`];
      ch.scenes.forEach((s, j) => {
        if (j) body.push('<p class="break">* * *</p>');
        paragraphs(s.text).forEach((p, n) => body.push(`<p${n === 0 ? ' class="first"' : ''}>${xmlText(p)}</p>`));
      });
      files.push({ name: `OEBPS/ch${i + 1}.xhtml`, data: xhtml(ch.title, body.join('\n')) });
    });
    files.push({ name: 'OEBPS/about.xhtml', data: xhtml('How this book was made', `<h2>How this book was made</h2>\n<p class="made">${xmlText(howMade(model))}</p>`) });
    const navItems = chapters.map((ch, i) => `<li><a href="ch${i + 1}.xhtml">Chapter ${ch.order + 1}: ${xmlText(ch.title)}</a></li>`).join('');
    files.push({ name: 'OEBPS/nav.xhtml', data: xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="title.xhtml">${xmlText(model.title)}</a></li>${navItems}<li><a href="about.xhtml">How this book was made</a></li></ol></nav>`) });
    const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="css" href="style.css" media-type="text/css"/>', '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>']
      .concat(chapters.map((c, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`))
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
        facts: (e.facts || []).filter((f) => !f.retired).map((f) => ({ text: f.text, secret: !!f.secret, revealedIn: f.secret && f.reveal ? titleOf(f.reveal) : null, origin: f.origin === 'accepted' ? 'suggested by AI, kept by the author' : 'written by the author' })),
      }))),
      chapters: (world.chapterOrder || []).map((cid) => getFrom(chapters, cid)).filter(Boolean).map((ch) => ({
        title: ch.title, scenes: Array.from({ length: ch.scenes }, (_, k) => describeScene(world, ch, k, byId)),
      })),
    };
  }

  // The provenance report: who wrote what, from the authorship record.
  function exportProvenance({ world, entities, chapters, passages }, now) {
    const model = bookModel({ world, chapters, passages });
    const list = valuesOf(entities);
    const facts = list.flatMap((e) => (e.facts || []).filter((f) => !f.retired));
    const canon = { total: facts.length, author: facts.filter((f) => f.origin !== 'accepted').length, accepted: facts.filter((f) => f.origin === 'accepted').length };
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
        return { scene: s.k + 1, words: s.stats.total, byAuthor: s.stats.words.typed + s.stats.words.pinned, typed: s.stats.words.typed, pinned: s.stats.words.pinned, inked: s.stats.words.inked, edits: p.editCount || 0, inks: p.inks || 0, repaints: p.repaints || 0, setAt: s.setAt ? new Date(s.setAt).toISOString() : null, spans: s.spans };
      }),
    }));
    const edits = rows.reduce((s, c) => s + c.scenes.reduce((t, x) => t + x.edits, 0), 0);
    const json = {
      format: 'inkwash-provenance/1', exportedAt: new Date(now || Date.now()).toISOString(),
      world: model.title, byline: model.byline,
      summary: { words: model.stats.total, byAuthor: model.stats.words.typed + model.stats.words.pinned, inkedKept: model.stats.words.inked, authorShare: round2(model.stats.hand), edits, direction, canon },
      chapters: rows,
      note: 'Inkwash records, for every passage, which text the author typed or pinned, which text an AI model inked, and when the author set it. This is a record of process, not legal advice.',
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
        `- Edits by the author: ${s.edits}`,
        `- Direction: ${direction.strokes} brush strokes, ${direction.notes} notes, ${direction.pins} pinned lines`,
        `- Canon: ${canon.total} facts, ${canon.author} written by the author and ${canon.accepted} suggested by AI and kept by the author`,
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

  // ---------------------------------------------------------------- backups

  function exportBackup({ world, entities, chapters, passages, seeds }, now) {
    return {
      format: 'inkwash-backup/1', exportedAt: new Date(now || Date.now()).toISOString(),
      world: clone(world), entities: clone(valuesOf(entities)), chapters: clone(valuesOf(chapters)),
      passages: clone(valuesOf(passages)), seeds: clone(valuesOf(seeds)),
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
    };
  }

  return {
    SAMPLES, KINDS, KIND_LABEL, LEDGER_MARK,
    uid, uuid, clamp, round2, clone, mentions, tail, head,
    sceneRange, sceneAt, newChapter, paintTension, eraseLine, paintWash, paintLine, nudgeTension, washScene, setPresence, resampleScenes,
    tensionSummary, moodMix, castIn, firstMeetings,
    newEntity, newFact, factIndex, reviseFact, retireFact, factTextAt, chapterIndex, sceneFacts,
    buildBrief, wordRange, parseJsonLoose, cleanProse, streamingProse, parseInkOutput, guessUsed,
    normMap, pinCore, findPins,
    normSpans, diffRange, applyEdit, overlay, splice, markPins, isWet, handStats, sumStats,
    passageId, mergePremises, inkedPassage, handPassage, repaintPassage, editPassage, recordEdit, setPassage,
    staleness, stillTrue, passageState, dependents,
    buildContinuityPrompt, parseContinuity, buildSeedPrompt, parseSeeds, buildRepaintPrompt, parseRepaint,
    chapterProblems, publishedChapter, publishedWorld, visibleLore,
    bookModel, exportMarkdown, exportHtml, exportEpub, exportBible, exportProvenance, exportBackup, readBackup,
    zipStore, crc32, esc, paragraphs, howMade, describeScene,
  };
});
