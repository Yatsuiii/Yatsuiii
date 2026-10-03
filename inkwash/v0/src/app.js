/* Inkwash studio: the page. It reaches the claude.ai runtime only through claude.use(), keeps every
 * world in the db capability (or in this browser, in sketchbook mode), and paints the score on a
 * canvas. The logic that has to be exactly right lives in core.js (window.InkCore). */
(function () {
  'use strict';
  const C = window.InkCore;
  const PL = window.InkPlates;
  const AT = window.InkAtlas;
  const N = C.SAMPLES;

  // ---------------------------------------------------------------- DOM helpers

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'selected') el.selected = !!v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { for (const k of kid) add(el, k); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  const $ = (s, root) => (root || document).querySelector(s);
  const now = () => Date.now();
  const pct = (x) => Math.round((x || 0) * 100) + '%';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  function when(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
  }
  function slug(s) { return String(s || 'world').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'world'; }

  // Per-viewer conveniences only (last world, last tab). Never the work itself.
  const local = {
    get(k, d) { try { const v = localStorage.getItem('inkwash.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('inkwash.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: fine */ } },
  };

  // ---------------------------------------------------------------- state

  const S = {
    mode: 'loading', // loading | welcome | form | studio | reader
    persist: null, // db | local
    readOnly: false,
    db: null, user: null, sample: null, downloads: null,
    worlds: new Map(), worldsReady: false, pubWorlds: new Map(),
    wid: null, loaded: new Set(),
    canon: new Map(), chapters: new Map(), passages: new Map(), seeds: new Map(), plates: new Map(), atlas: new Map(), pub: new Map(),
    history: new Map(), sources: new Map(), meta: new Map(), // undoable steps, notes brought in, the activity counts
    recording: null, editBefore: {}, importDraft: null, leftOff: null,
    atlasSel: null, dreamDraft: null,
    codexSel: null, codexBack: null, codexFind: '', // the canon's open entry, the one before it, and what the index is filtered by
    view: 'score', cid: null, k: 0,
    tool: 'brush', pigment: null,
    showHand: local.get('showHand', true),
    busy: {}, aiOff: null, form: null,
    confirmReink: null, selection: null, flash: null,
    publishTried: {}, preview: false,
    ripple: { open: {}, idea: {}, pick: {}, draft: {} }, // per fact: the open way and the author's own idea; per way: the answer picked and drafted
    reader: { wid: null, chapters: new Map(), pos: 0, unsub: null },
    editBase: {}, editTimers: {}, removed: [],
    unsub: [], ver: 0,
    dbError: null,
  };
  const bump = () => { S.ver++; };

  async function use(name) {
    try { return window.claude && typeof window.claude.use === 'function' ? await window.claude.use(name) : null; }
    catch (e) { return null; }
  }

  // ---------------------------------------------------------------- storage
  // One write at a time per document, coalesced: the db capability asks for exactly this.

  // A trial copy (dist/inkwash-trial.html) gives everyone who can save a studio of their own, and
  // publishes nothing. With store 'self' (the default), a person's worlds live under their own
  // data/users/<id>/ in the store, which the platform keeps from everyone else, the page's owner
  // included. With store 'shared', they live in the copy's studio, for a copy made for one person.
  const TRIAL = window.INKWASH_TRIAL || null;
  // Where the studio lives in the store: the top, or a trial visitor's own subtree.
  let ROOT = '';
  const P = {
    world: (w) => `${ROOT}studio/${w}`,
    canon: (w, id) => `${ROOT}studio/${w}/canon/${id}`,
    chapters: (w, id) => `${ROOT}studio/${w}/chapters/${id}`,
    passages: (w, id) => `${ROOT}studio/${w}/passages/${id}`,
    seeds: (w, id) => `${ROOT}studio/${w}/seeds/${id}`,
    plates: (w, id) => `${ROOT}studio/${w}/plates/${id}`,
    atlas: (w, id) => `${ROOT}studio/${w}/atlas/${id}`,
    history: (w, id) => `${ROOT}studio/${w}/history/${id}`,
    sources: (w, id) => `${ROOT}studio/${w}/sources/${id}`,
    meta: (w, id) => `${ROOT}studio/${w}/meta/${id}`,
    pubWorld: (w) => `${ROOT}published/${w}`,
    pubChapter: (w, id) => `${ROOT}published/${w}/chapters/${id}`,
  };
  const MAP = { canon: () => S.canon, chapters: () => S.chapters, passages: () => S.passages, seeds: () => S.seeds, plates: () => S.plates, atlas: () => S.atlas, pub: () => S.pub, history: () => S.history, sources: () => S.sources, meta: () => S.meta };
  const WORLD_KINDS = ['canon', 'chapters', 'passages', 'seeds', 'plates', 'atlas', 'pub', 'history', 'sources', 'meta'];
  const W = new Map();
  const dirty = new Set();
  const DOC_MAX = 250000; // bytes; the store refuses a document over 256 KiB, and this view would then stop saving

  function queueWrite(path, data, delay) {
    if (S.readOnly) return;
    const size = C.utf8Bytes(JSON.stringify(data));
    if (size > DOC_MAX) { toast("This can't be saved: it's over the 256 KB a single document can hold. Split the scene or trim its edit history.", 'error'); return; }
    let w = W.get(path);
    if (!w) { w = { timer: null, data: null, del: false, running: false, seq: 0, inflight: null }; W.set(path, w); }
    w.data = data; w.del = false; w.seq++;
    dirty.add(path);
    clearTimeout(w.timer);
    w.timer = setTimeout(() => flushPath(path), delay == null ? 500 : delay);
    renderSaveState();
  }
  function queueDelete(path) {
    if (S.readOnly) return;
    let w = W.get(path);
    if (!w) { w = { timer: null, data: null, del: false, running: false, seq: 0, inflight: null }; W.set(path, w); }
    w.data = null; w.del = true; w.seq++;
    dirty.add(path);
    clearTimeout(w.timer);
    w.timer = setTimeout(() => flushPath(path), 0);
    renderSaveState();
  }
  function flushPath(path, retried) {
    const w = W.get(path);
    if (!w) return;
    clearTimeout(w.timer); w.timer = null;
    if (w.running) return; // the running write re-flushes when it finishes
    const isDel = w.del, data = w.data;
    w.data = null; w.del = false;
    if (!isDel && data == null) { W.delete(path); dirty.delete(path); renderSaveState(); return; }
    w.running = true;
    w.inflight = { data, del: isDel, seq: w.seq };
    let saved = false;
    const ref = S.db.doc(path);
    (isDel ? ref.delete() : ref.set(data)).then(() => {
      S.saveError = null;
      saved = true;
    }, (e) => {
      const code = e && e.code;
      if (code === 'unavailable' && !retried) {
        if (w.data == null && !w.del) { w.data = data; w.del = isDel; }
        setTimeout(() => flushPath(path, true), 400 + Math.random() * 900);
      } else if (code === 'resource_exhausted') {
        if (w.data == null && !w.del) { w.data = data; w.del = isDel; }
        setTimeout(() => flushPath(path), 3000);
      } else {
        S.saveError = code === 'quota_exceeded' ? "Inkwash's storage on this page is full. Delete an old world or some dreams to make room."
          : code === 'invalid_argument' ? "This view can't save changes to your studio." : code === 'revoked' ? 'Access to this page changed, so it can no longer save.'
          : `Couldn't save a change (${code || 'unknown error'}).`;
        if (code === 'invalid_argument' || code === 'revoked') { S.readOnly = true; render(); }
        toast(S.saveError, 'error');
      }
    }).finally(() => {
      w.running = false;
      if (saved) unpend(path, w.inflight.seq);
      w.inflight = null;
      if (w.data != null || w.del) { if (!w.timer) flushPath(path); }
      else { W.delete(path); dirty.delete(path); }
      renderSaveState();
    });
  }
  function flushAll() { for (const path of [...W.keys()]) flushPath(path); }

  // When the page is hidden or closed, writes still on their way are noted in this browser, and the
  // next visit finishes any that never arrived. A store can't promise a write fired as a page
  // closes; this makes sure the work isn't lost with it. Sketchbook mode writes this browser's
  // copy at once instead.
  const PENDING = 'inkwash.pending';
  const pendingKey = () => PENDING + (ROOT ? ':' + ROOT : '');
  let pendingNoted = null;
  function notePending() {
    if (S.persist !== 'db' || S.readOnly) return;
    const list = {};
    for (const [path, w] of W) {
      const e = (w.data != null || w.del) ? { data: w.data, del: w.del, seq: w.seq } : w.inflight;
      if (e) list[path] = { data: e.data, del: !!e.del, seq: e.seq, at: now() };
    }
    pendingNoted = Object.keys(list).length ? list : null;
    try { if (pendingNoted) localStorage.setItem(pendingKey(), JSON.stringify(pendingNoted)); else localStorage.removeItem(pendingKey()); } catch (e) { /* storage blocked: nothing to keep */ }
  }
  function unpend(path, seq) {
    if (!pendingNoted || !pendingNoted[path] || pendingNoted[path].seq > seq) return;
    delete pendingNoted[path];
    if (!Object.keys(pendingNoted).length) pendingNoted = null;
    try { if (pendingNoted) localStorage.setItem(pendingKey(), JSON.stringify(pendingNoted)); else localStorage.removeItem(pendingKey()); } catch (e) { /* ignore */ }
  }
  // Writes noted when the page last closed: any the store doesn't have yet (it holds an older copy,
  // or none, of a document written then) are written now.
  async function recoverPending() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(pendingKey()) || 'null'); } catch (e) { list = null; }
    if (!list || typeof list !== 'object' || S.persist !== 'db' || S.readOnly) return;
    try { localStorage.removeItem(pendingKey()); } catch (e) { /* ignore */ }
    let done = 0;
    for (const [path, e] of Object.entries(list)) {
      if (!path.startsWith(ROOT) || !/^(studio|published)\//.test(path.slice(ROOT.length)) || !e) continue;
      try {
        const snap = await S.db.doc(path).get();
        const have = snap.exists ? (snap.data() || {}) : null;
        if (e.del) { if (have && (have.updatedAt || 0) <= e.at) { queueDelete(path); done++; } }
        else if (e.data && (!have || (have.updatedAt || 0) < (e.data.updatedAt || 0))) { queueWrite(path, e.data, 0); done++; }
      } catch (err) { /* the store is unreachable: leave it */ }
    }
    if (done) toast(`Finished saving ${plural(done, 'change')} that hadn't arrived when the page last closed.`);
  }
  function flushLocal() { if (S.db && S.db.local && typeof S.db.flush === 'function') S.db.flush(); }
  function onHide() {
    for (const key of Object.keys(S.editBase)) commitEditLog(key);
    flushAll();
    notePending();
    flushLocal();
  }

  // Put a document into local state and queue its write. `quiet` skips the re-render (typing).
  function put(kind, id, data, opts) {
    opts = opts || {};
    if (kind !== 'world') noteBefore(kind, id);
    const doc = Object.assign({}, data, { id });
    if (!opts.keepTime) doc.updatedAt = now();
    if (kind === 'world') { S.worlds.set(id, doc); queueWrite(P.world(id), doc); }
    else { MAP[kind]().set(id, doc); queueWrite(P[kind === 'pub' ? 'pubChapter' : kind](S.wid, id), doc); }
    bump();
    if (!opts.quiet) render();
    return doc;
  }
  function removeDoc(kind, id) {
    if (kind !== 'world') noteBefore(kind, id);
    if (kind === 'world') { S.worlds.delete(id); queueDelete(P.world(id)); }
    else { MAP[kind]().delete(id); queueDelete(P[kind === 'pub' ? 'pubChapter' : kind](S.wid, id)); }
    bump();
  }

  // Sketchbook mode: the same document API, kept in this browser when the db capability is absent.
  function makeLocalDb() {
    let docs = {};
    try { docs = JSON.parse(localStorage.getItem('inkwash.sketchbook') || '{}') || {}; } catch (e) { docs = {}; }
    const listeners = new Set();
    let timer = null;
    const persist = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { localStorage.setItem('inkwash.sketchbook', JSON.stringify(docs)); }
        catch (e) { toast("This browser won't store more. Back up your world to a file.", 'error'); }
      }, 250);
    };
    const parent = (p) => p.split('/').slice(0, -1).join('/');
    const snap = (p, body) => ({ id: p.split('/').pop(), exists: body != null, data: () => (body == null ? undefined : JSON.parse(JSON.stringify(body))), metadata: { fromCache: false, hasPendingWrites: false } });
    const deliver = (l) => {
      const paths = Object.keys(docs).filter((p) => parent(p) === l.coll).sort();
      const next = new Map(paths.map((p) => [p, JSON.stringify(docs[p])]));
      const changes = [];
      for (const p of paths) {
        const old = l.prev.get(p);
        if (old === undefined) changes.push({ type: 'added', doc: snap(p, docs[p]) });
        else if (old !== next.get(p)) changes.push({ type: 'modified', doc: snap(p, docs[p]) });
      }
      for (const [p, old] of l.prev) if (!next.has(p)) changes.push({ type: 'removed', doc: snap(p, JSON.parse(old)) });
      const first = !l.started;
      l.started = true; l.prev = next;
      if (!first && !changes.length) return;
      l.fn({ docs: paths.map((p) => snap(p, docs[p])), size: paths.length, empty: !paths.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } });
    };
    // one delivery for a burst of writes: bringing in notes can write a thousand documents at once
    let notifying = false;
    const notify = () => { if (notifying) return; notifying = true; setTimeout(() => { notifying = false; for (const l of listeners) deliver(l); }, 0); };
    const api = {
      local: true,
      flush() {
        clearTimeout(timer);
        try { localStorage.setItem('inkwash.sketchbook', JSON.stringify(docs)); } catch (e) { /* full or blocked: the toast above already said */ }
      },
      doc(path) {
        return {
          id: path.split('/').pop(), path,
          get: async () => snap(path, docs[path]),
          set: async (data) => { docs[path] = JSON.parse(JSON.stringify(data)); persist(); notify(); },
          delete: async () => { delete docs[path]; persist(); notify(); },
        };
      },
      collection(path) {
        return {
          path,
          onSnapshot(fn) {
            const l = { coll: path, fn, prev: new Map(), started: false };
            listeners.add(l);
            setTimeout(() => deliver(l), 0);
            return () => listeners.delete(l);
          },
        };
      },
    };
    return api;
  }

  function onDbError(e) {
    const code = e && e.code;
    if (code === 'revoked') { S.readOnly = true; S.dbError = 'Access to this page changed, so it is read-only now.'; }
    else S.dbError = `Lost the live connection to your studio (${code || 'unknown error'}). Reload the page to reconnect.`;
    render();
  }

  // ---------------------------------------------------------------- studio data

  // Apply a snapshot to a map, skipping documents with unsaved local changes and echoes of our own
  // writes. Returns whether anything changed, so an echo never re-renders the page under a click.
  function applyChanges(snap, map, pathOf) {
    let changed = false;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (dirty.has(pathOf(id))) continue;
      if (ch.type === 'removed') { if (map.delete(id)) changed = true; continue; }
      const next = Object.assign(C.clone(ch.doc.data()), { id });
      const cur = map.get(id);
      if (cur && stable(cur) === stable(next)) continue;
      map.set(id, next);
      changed = true;
    }
    return changed;
  }
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }

  function startStudio(hot) {
    S.mode = 'loading';
    S.db.collection(ROOT + 'studio').onSnapshot((snap) => {
      const changed = applyChanges(snap, S.worlds, (id) => P.world(id));
      const first = !S.worldsReady;
      S.worldsReady = true;
      if (first) recoverPending();
      if (!changed && !first) return;
      bump();
      if (S.mode === 'loading' || (S.mode === 'studio' && !S.worlds.has(S.wid))) chooseWorld(hot);
      render();
    }, onDbError);
    if (!TRIAL) S.db.collection('published').onSnapshot((snap) => {
      if (applyChanges(snap, S.pubWorlds, (id) => P.pubWorld(id))) render();
    }, onDbError);
  }
  function chooseWorld(hot) {
    const ids = [...S.worlds.keys()];
    if (!ids.length) { closeWorld(); S.mode = S.form ? 'form' : 'welcome'; return; }
    const pick = [hot && hot.wid, local.get('lastWorld', null)].find((id) => id && S.worlds.has(id))
      || ids.find((id) => !S.worlds.get(id).example) || ids[0];
    openWorld(pick, hot);
  }
  function closeWorld() {
    for (const u of S.unsub) { try { u(); } catch (e) { /* already closed */ } }
    S.unsub = [];
    S.wid = null;
  }
  function openWorld(wid, hot) {
    closeWorld();
    S.wid = wid;
    local.set('lastWorld', wid);
    S.canon = new Map(); S.chapters = new Map(); S.passages = new Map(); S.seeds = new Map(); S.plates = new Map(); S.atlas = new Map(); S.pub = new Map();
    S.history = new Map(); S.sources = new Map(); S.meta = new Map();
    S.loaded = new Set();
    S.leftOff = { wid, shown: false, dismissed: false };
    S.atlasSel = null;
    S.codexSel = local.get('codex.' + wid, null); S.codexBack = null; S.codexFind = '';
    S.selection = null; S.confirmReink = null; S.publishTried = {}; S.preview = false;
    const pos = (hot && hot.wid === wid) ? hot : local.get('pos.' + wid, {});
    S.cid = pos.cid || null; S.k = pos.k || 0;
    const sub = (coll, kind) => S.db.collection(coll).onSnapshot((snap) => {
      if (S.wid !== wid) return;
      const changed = applyChanges(snap, MAP[kind](), (id) => coll + '/' + id);
      const first = !S.loaded.has(kind);
      S.loaded.add(kind);
      if (changed || first) { bump(); render(); }
    }, onDbError);
    S.unsub = [
      sub(`${ROOT}studio/${wid}/canon`, 'canon'),
      sub(`${ROOT}studio/${wid}/chapters`, 'chapters'),
      sub(`${ROOT}studio/${wid}/passages`, 'passages'),
      sub(`${ROOT}studio/${wid}/seeds`, 'seeds'),
      sub(`${ROOT}studio/${wid}/plates`, 'plates'),
      sub(`${ROOT}studio/${wid}/atlas`, 'atlas'),
      TRIAL ? null : sub(`published/${wid}/chapters`, 'pub'),
      sub(`${ROOT}studio/${wid}/history`, 'history'),
      sub(`${ROOT}studio/${wid}/sources`, 'sources'),
      sub(`${ROOT}studio/${wid}/meta`, 'meta'),
    ].filter(Boolean);
    if (TRIAL) S.loaded.add('pub');
    S.mode = 'studio';
    S.form = null;
    render();
  }
  function ready() { return ['canon', 'chapters', 'passages', 'seeds'].every((k) => S.loaded.has(k)); }

  const world = () => S.worlds.get(S.wid);
  const entities = () => [...S.canon.values()];
  let idxMemo = { ver: -1, idx: null };
  function idx() { if (idxMemo.ver !== S.ver) idxMemo = { ver: S.ver, idx: C.factIndex(S.canon) }; return idxMemo.idx; }
  const pinsOf = (ch, k) => (ch.pins || []).filter((p) => p.scene === k);
  const notesOf = (ch, k) => (ch.notes || []).filter((n) => n.scene === k);
  const chapterOrder = () => ((world() || {}).chapterOrder || []).filter((id) => S.chapters.has(id));

  function stateOpts(ch, k) {
    const w = world();
    return { strict: !!(w && w.strict), onPage: C.castIn(ch, k).map((c) => c.id), entities: S.canon };
  }
  function sceneInfo(cid, k) {
    const ch = S.chapters.get(cid);
    const p = S.passages.get(C.passageId(cid, k));
    if (!ch) return { state: 'empty', reasons: [], p };
    const opts = stateOpts(ch, k);
    const st = C.staleness(p, idx(), opts);
    return { state: C.passageState(p, idx(), opts), reasons: st.reasons, p };
  }
  // The text just before and after a scene, across chapter boundaries.
  function neighborText(cid, k, dir) {
    const order = chapterOrder();
    let ci = order.indexOf(cid), kk = k + dir;
    for (let guard = 0; guard < 400; guard++) {
      const ch = S.chapters.get(order[ci]);
      if (!ch) return '';
      if (kk < 0) { ci--; if (ci < 0) return ''; kk = S.chapters.get(order[ci]).scenes - 1; continue; }
      if (kk >= ch.scenes) { ci++; if (ci >= order.length) return ''; kk = 0; continue; }
      const p = S.passages.get(C.passageId(order[ci], kk));
      return p && p.text ? p.text : '';
    }
    return '';
  }
  function briefFor(cid, k) {
    return C.buildBrief({ world: world(), entities: S.canon, chapters: S.chapters, chapterId: cid, k, prevText: neighborText(cid, k, -1), nextText: neighborText(cid, k, 1) });
  }
  function worldStats() {
    if (!world()) return null;
    return C.bookModel({ world: world(), chapters: S.chapters, passages: S.passages }).stats;
  }
  function savePos() { if (S.wid) local.set('pos.' + S.wid, { cid: S.cid, k: S.k }); }

  // ---------------------------------------------------------------- rendering

  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderNow(); });
  }
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.id || a === document.body) return null;
    const keep = { id: a.id, value: null, s: null, e: null };
    if ('value' in a && a.hasAttribute('data-keep')) keep.value = a.value;
    if (typeof a.selectionStart === 'number') { try { keep.s = a.selectionStart; keep.e = a.selectionEnd; } catch (e) { /* not a text input */ } }
    return keep;
  }
  function restoreFocus(keep) {
    if (!keep) return;
    const el = document.getElementById(keep.id);
    if (!el || el === document.activeElement) return;
    if (keep.value != null && el.value !== keep.value) el.value = keep.value;
    el.focus({ preventScroll: true });
    if (keep.s != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } }
  }
  function renderNow() {
    const keep = captureFocus();
    renderTopbar();
    renderBanners();
    const main = $('#main');
    clear(main);
    if (S.mode === 'loading') main.append(openingView());
    else if (S.mode === 'blocked') main.append(blockedView());
    else if (S.mode === 'welcome') main.append(welcomeView());
    else if (S.mode === 'form') main.append(worldFormView());
    else if (S.mode === 'reader') main.append(readerView(S.pubWorlds.get(S.reader.wid), S.reader.chapters, false));
    else if (S.mode === 'studio') {
      if (!world() || !ready()) main.append(openingView(world() ? `Opening ${world().title}` : null));
      else if (S.preview) main.append(readerView(S.pubWorlds.get(S.wid), S.pub, true));
      else if (S.view === 'book') main.append(bookView());
      else if (S.view === 'canon') main.append(canonView());
      else if (S.view === 'dreams') main.append(dreamsView());
      else if (S.view === 'atlas') main.append(atlasView());
      else main.append(scoreView());
      if (world() && ready() && !S.preview && leftOffDue()) main.prepend(leftOffCard());
    }
    restoreFocus(keep);
    fitAll(document.querySelectorAll('textarea.prose, textarea.import-fact'));
    if (S.mode === 'studio' && S.view === 'score' && !S.preview) Score.draw();
    renderSaveState();
  }

  // a field that reads as prose grows with its words
  function fitProse(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  // many at once, measured together: one layout instead of one per field (a review of brought-in
  // notes can hold thousands)
  function fitAll(list) {
    const tas = [...list];
    for (const ta of tas) ta.style.height = 'auto';
    const hs = tas.map((ta) => ta.scrollHeight);
    tas.forEach((ta, i) => { ta.style.height = hs[i] + 'px'; });
  }

  function renderSaveState() {
    const el = $('#save-state');
    if (!el) return;
    const pending = W.size > 0;
    el.dataset.state = S.saveError ? 'error' : pending ? 'saving' : 'saved';
    el.textContent = S.saveError ? "Couldn't save" : pending ? 'Saving…' : S.persist === 'local' ? 'Kept in this browser' : 'Saved';
  }

  function meter(share, label) {
    return h('span', { class: 'meter', title: 'Share of words you typed or pinned yourself' },
      h('span', { class: 'meter-track', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: { width: pct(share) } })),
      `${pct(share)} ${label || 'your hand'}`);
  }
  const STATE_LABEL = { empty: 'Not written', draft: 'Draft', wet: 'Wet ink', set: 'Set', stale: 'Stale' };
  function pill(state, id) { return h('span', { class: 'pill', 'data-state': state, id }, STATE_LABEL[state] || state); }

  function renderTopbar() {
    const slot = $('#topbar-slot');
    clear(slot);
    if (S.mode === 'reader') { slot.append(h('span', { class: 'muted' }, 'Reading')); return; }
    if (S.mode === 'loading' || S.mode === 'blocked') return;
    const worlds = [...S.worlds.values()].sort((a, b) => (a.example ? 1 : 0) - (b.example ? 1 : 0) || String(a.title).localeCompare(String(b.title)));
    const pick = h('select', {
      id: 'world-select', 'aria-label': 'World',
      onchange: (e) => {
        const v = e.target.value;
        if (v === '__new') openForm('new');
        else if (v === '__import') openImport(S.wid && S.worlds.has(S.wid) ? S.wid : 'new');
        else if (v === '__dream') openForm('dream');
        else if (v === '__example') loadExample();
        else if (v && v !== S.wid) openWorld(v);
        render();
      },
    });
    if (!S.wid) pick.append(h('option', { value: '', selected: true }, 'Choose a world'));
    for (const w of worlds) pick.append(h('option', { value: w.id, selected: w.id === S.wid && S.mode === 'studio' }, w.title + (w.example ? ' (example)' : '')));
    pick.append(h('option', { value: '__dream', selected: S.mode === 'form' && S.form && S.form.mode === 'dream' }, 'Dream a world…'));
    pick.append(h('option', { value: '__new', selected: S.mode === 'form' && S.form && S.form.mode === 'new' }, 'New world…'));
    pick.append(h('option', { value: '__import', selected: S.mode === 'form' && S.form && S.form.mode === 'import' }, 'Bring in notes…'));
    if (!worlds.some((w) => w.example)) pick.append(h('option', { value: '__example' }, 'Open the example world'));
    slot.append(h('div', { class: 'world-pick' }, pick));
    if (S.mode === 'studio' && world()) {
      const tabs = h('nav', { class: 'tabs', 'aria-label': 'Views' });
      for (const [v, label] of [['atlas', 'Atlas'], ['score', 'Score'], ['book', 'Book'], ['canon', 'Canon'], ['dreams', 'Dreams']]) {
        tabs.append(h('button', { class: 'tab', type: 'button', 'aria-current': !S.preview && S.view === v ? 'page' : null, onclick: () => go(v) }, label));
      }
      slot.append(tabs);
    }
    const end = h('div', { class: 'topbar-end' });
    const stats = S.mode === 'studio' && ready() ? worldStats() : null;
    if (stats && stats.total) end.append(meter(stats.hand, 'your hand'));
    end.append(h('span', { class: 'save-state', id: 'save-state' }));
    if (S.mode === 'studio' && world() && !S.readOnly) end.append(h('button', { class: 'btn ghost small', type: 'button', id: 'open-history', onclick: openHistory }, 'History'));
    if (S.mode === 'studio' && world()) end.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => openForm('settings') }, 'World settings'));
    slot.append(end);
  }
  function go(view) {
    S.view = view; S.preview = false; S.selection = null;
    local.set('view', view);
    render();
    window.scrollTo(0, 0);
  }

  function renderBanners() {
    const root = $('#banners');
    clear(root);
    const w = S.mode === 'studio' ? world() : null;
    if (S.dbError) root.append(h('div', { class: 'banner warn' }, h('strong', null, S.dbError)));
    if (S.persist === 'local' && S.mode !== 'reader') {
      root.append(h('div', { class: 'banner' },
        h('strong', null, 'Sketchbook mode.'),
        window.claude ? "Inkwash can't save to claude.ai in this view, so your work is kept in this browser only. Back up each world to a file from the Book view."
          : 'This copy of Inkwash keeps your work in this browser only, and sends none of it anywhere. Clearing the browser’s data deletes it, so back up each world to a file from the Book view.'));
    }
    if (TRIAL && S.persist === 'db' && S.mode !== 'blocked') {
      root.append(h('div', { class: 'banner' },
        h('strong', null, 'Trial copy.'),
        TRIAL.store === 'shared'
          ? 'Your worlds are kept in this copy of Inkwash, which only you and the person who shared it with you can open. Claude’s suggestions use your own Claude usage, and claude.ai asks you before the first one.'
          : 'Your worlds here are private to your claude.ai account: under the rules this page is published with, nobody else can read them, not even the person who shared it. Claude’s suggestions use your own Claude usage, and claude.ai asks you before the first one.'));
    }
    if (S.readOnly && S.mode === 'studio') root.append(h('div', { class: 'banner warn' }, h('strong', null, 'Read-only.'), TRIAL ? 'You can look around, but this page can’t save your changes. Ask the person who shared it to invite you as an Editor.' : "This view can't save changes."));
    if (S.aiOff && S.mode === 'studio') root.append(h('div', { class: 'banner' }, h('strong', null, 'Inking is off.'), S.aiOff));
    if (w && w.example) {
      root.append(h('div', { class: 'banner' },
        h('strong', null, 'Example world.'),
        'Everything in it, including the parts marked as the author’s, was written to show how Inkwash works.',
        h('button', { class: 'btn small', type: 'button', onclick: () => openForm('new') }, 'Start your own world')));
    }
  }

  function blockedView() {
    return h('section', { class: 'opening' },
      h('p', { class: 'eyebrow' }, 'Inkwash trial'),
      h('h1', null, 'This page can’t give you a private studio yet.'),
      h('p', { class: 'muted' }, 'This trial copy keeps each person’s worlds in a private place tied to their claude.ai account, and this visit didn’t come with one. Nothing has been saved. Sign in to claude.ai and open the link from your invitation again.'),
      h('p', { class: 'muted' }, 'If you still see this, tell the person who shared the page with you: they can switch your copy to a studio of its own.'));
  }
  function openingView(title) {
    return h('section', { class: 'opening' },
      h('p', { class: 'eyebrow' }, title || 'Opening your studio'),
      h('h1', null, 'Overthink it. Inkwash keeps it straight.'),
      h('p', { class: 'muted' }, 'Your worlds, maps, chapters and scenes appear here once your studio has loaded.'));
  }

  function welcomeView() {
    return h('section', { class: 'welcome' },
      h('p', { class: 'eyebrow' }, 'Inkwash'),
      h('h1', null, 'Overthink it. Inkwash keeps it straight.'),
      aiOn()
        ? h('p', { class: 'muted' }, 'For the world you can’t stop thinking about. Bring in the notes you already have, and Inkwash keeps it all in one canon, in your own words. Add a fact, and Inkwash shows what it breaks and asks where it leads: your own idea first, or one of Claude’s to start from. Paint a scene’s tension and mood, and Claude inks the prose inside your strokes. Nothing joins your canon unless you add it, and any change can be undone. Come back any day and it shows you where you left off.')
        : h('p', { class: 'muted' }, 'For the world you can’t stop thinking about. Bring in the notes you already have, and Inkwash keeps it all in one canon, in your own words. Change a fact, and it shows which of your scenes relied on it; write where it leads, your own way. Nothing joins your canon unless you add it, and any change can be undone. Come back any day and it shows you where you left off. This copy has no Claude in it: dreaming a world, inking scenes and Claude’s suggestions are in the claude.ai version.'),
      h('div', { class: 'choices' },
        h('div', { class: 'choice lead' },
          h('h2', null, 'Bring your notes'),
          h('p', { class: 'muted' }, 'Paste notes about your world, or open a text or Markdown file. You see everything Inkwash found, word for word, before any of it is added.'),
          h('div', null, h('button', { class: 'btn primary', type: 'button', onclick: () => openImport('new') }, 'Bring in notes'))),
        h('div', { class: 'choice' },
          h('h2', null, 'Start from nothing'),
          h('p', { class: 'muted' }, 'Name your world and give it a premise, then add its people, places and rules one by one.'),
          h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => openForm('new') }, 'Start a world'))),
        aiOn() ? h('div', { class: 'choice' },
          h('h2', null, 'Dream a world'),
          h('p', { class: 'muted' }, 'Tell it a dream. Claude grows it into a whole world, its lands, peoples and places drawn on a map, and keeps it all in your canon marked as suggested.'),
          h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => openForm('dream') }, 'Dream a world'))) : null,
        h('div', { class: 'choice' },
          h('h2', null, 'Explore an example'),
          h('p', { class: 'muted' }, 'The Drained Sea, a world dreamed from three sentences. Or The Hollow Moon, a book in progress: a set scene, a wet one, a scene that went stale when a fact changed, and a scene ready to ink.'),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: loadDreamExample }, 'The Drained Sea'), h('button', { class: 'btn', type: 'button', onclick: loadExample }, 'The Hollow Moon')))),
      // a world backed up anywhere (the preview, another copy) comes in whole
      h('p', { class: 'faint welcome-restore' }, 'Have a backup of a world from Inkwash? ',
        h('label', { class: 'linklike' }, 'Restore it', h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'welcome-restore', onchange: (e) => restoreFrom(e.target) })), '.'));
  }

  // ---------------------------------------------------------------- world form

  const DEFAULT_PIGMENTS = [
    { id: 'p_dread', name: 'Dread', color: '#3d4f8f', line: '' },
    { id: 'p_wonder', name: 'Wonder', color: '#c4952b', line: '' },
    { id: 'p_grief', name: 'Grief', color: '#6b7f95', line: '' },
    { id: 'p_warmth', name: 'Warmth', color: '#c0703f', line: '' },
    { id: 'p_menace', name: 'Menace', color: '#a3333d', line: '' },
  ];
  function openForm(mode) {
    S.form = { mode };
    S.mode = 'form';
    render();
    window.scrollTo(0, 0);
  }
  function worldFormView() {
    if (S.form && S.form.mode === 'dream') return dreamFormView();
    if (S.form && S.form.mode === 'import') return importView();
    const editing = S.form && S.form.mode === 'settings' ? world() : null;
    const w = editing || { title: '', premise: '', byline: '', voice: '', sceneWords: 450, pigments: DEFAULT_PIGMENTS, strict: false };
    const field = (label, input, note) => h('label', { class: 'field' }, h('span', null, label), input, note ? h('small', null, note) : null);
    const pigRows = h('div', { class: 'pigment-rows' });
    const pigs = (w.pigments && w.pigments.length ? w.pigments : DEFAULT_PIGMENTS).slice(0, 6);
    while (pigs.length < 5) pigs.push({ id: C.uid('p'), name: '', color: '#888888', line: '' });
    pigs.forEach((p, i) => pigRows.append(h('div', { class: 'pigment-row', dataset: { id: p.id } },
      h('input', { type: 'color', name: 'color', value: p.color || '#888888', 'aria-label': `Color of mood ${i + 1}` }),
      h('input', { type: 'text', name: 'name', value: p.name, placeholder: 'Mood name', 'aria-label': `Name of mood ${i + 1}` }),
      h('input', { type: 'text', name: 'line', value: p.line || '', placeholder: 'One line of yours that has this feeling', 'aria-label': `Example line for mood ${i + 1}` }))));
    const form = h('form', { class: 'form-grid', id: 'world-form', onsubmit: (e) => { e.preventDefault(); submitWorldForm(e.target, editing); } },
      field('Title', h('input', { type: 'text', name: 'title', id: 'wf-title', required: true, value: w.title, placeholder: 'The Hollow Moon' })),
      field('Premise', h('textarea', { name: 'premise', rows: 2, value: w.premise || '', placeholder: 'One or two sentences: where it happens and what goes wrong.' })),
      field('Pen name', h('input', { type: 'text', name: 'byline', value: w.byline || '', placeholder: 'How you sign the book' }), 'Shown on the book and in exports. Optional.'),
      field('Your voice', h('textarea', { name: 'voice', rows: 6, value: w.voice || '', placeholder: 'Paste two or three paragraphs of your own writing.' }), 'Inkwash asks the ink to match the rhythm and diction of this sample. Use your own writing only.'),
      field('Words per scene', h('input', { type: 'number', name: 'sceneWords', min: 120, max: 2500, step: 10, value: w.sceneWords || 450 }), 'A target. Each scene is inked to about this length.'),
      h('div', { class: 'field' }, h('span', null, 'Moods you paint with'), pigRows, h('small', null, 'Give each feeling a name and, if you can, one line of your own that carries it. The line helps the ink understand what you mean.')),
      editing ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: 'strict', checked: !!w.strict }), 'Strict continuity: flag a scene when anything about anyone in it changes, not only the facts it used') : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save settings' : 'Create world'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.form = null; S.mode = S.wid ? 'studio' : (S.worlds.size ? 'studio' : 'welcome'); if (!S.wid && S.worlds.size) chooseWorld(); render(); } }, 'Cancel')));
    const page = h('section', { class: 'page-pad' },
      h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, editing ? 'World settings' : 'New world'), h('h1', null, editing ? editing.title : 'Start a world')),
      form);
    if (editing) {
      page.append(h('div', { class: 'section', style: { maxWidth: '46rem' } },
        h('h3', null, 'Delete'),
        h('p', { class: 'muted' }, 'Deleting a world removes its canon, chapters, scenes, dreams and anything published from it. Back it up first if you might want it again.'),
        h('div', null, h('button', { class: 'btn danger', type: 'button', onclick: () => deleteWorld(editing.id) }, 'Delete this world'))));
    }
    return page;
  }
  function submitWorldForm(form, editing) {
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    if (!title) { toast('Give your world a title.', 'warn'); return; }
    const pigments = [...form.querySelectorAll('.pigment-row')].map((row) => ({
      id: row.dataset.id, name: row.querySelector('[name=name]').value.trim(), color: row.querySelector('[name=color]').value, line: row.querySelector('[name=line]').value.trim(),
    })).filter((p) => p.name);
    const fields = {
      title, premise: String(fd.get('premise') || '').trim(), byline: String(fd.get('byline') || '').trim(),
      voice: String(fd.get('voice') || '').trim(), sceneWords: C.clamp(Number(fd.get('sceneWords')) || 450, 120, 2500), pigments,
    };
    if (editing) {
      put('world', editing.id, Object.assign({}, editing, fields, { strict: fd.get('strict') === 'on' }));
      S.form = null; S.mode = 'studio';
      toast('Settings saved.');
      render();
      return;
    }
    makeWorld(fields);
    toast('World created. Start with its canon: who lives here and what is true.');
    render();
  }
  function makeWorld(fields) {
    const wid = C.uid('w');
    const cid = C.uid('c');
    openWorld(wid);
    put('world', wid, Object.assign({ title: 'Untitled world', premise: '', byline: '', voice: '', sceneWords: 450, pigments: DEFAULT_PIGMENTS }, fields, { example: false, strict: false, chapterOrder: [cid], createdAt: now() }), { quiet: true });
    put('chapters', cid, C.newChapter('Chapter one', 3, now()), { quiet: true });
    S.loaded = new Set(WORLD_KINDS);
    S.cid = cid; S.k = 0; S.view = 'canon';
    S.leftOff.due = false;
    return wid;
  }
  async function deleteWorld(wid) {
    const w = S.worlds.get(wid);
    if (!w) return;
    const ok = await ask({ title: `Delete ${w.title}?`, body: 'Its canon, chapters, scenes, dreams and published chapters are deleted for good.', confirm: 'Delete this world', danger: true });
    if (!ok) return;
    if (S.wid !== wid) openWorld(wid);
    for (const kind of WORLD_KINDS) for (const id of [...MAP[kind]().keys()]) removeDoc(kind, id);
    if (S.pubWorlds.has(wid)) { S.pubWorlds.delete(wid); queueDelete(P.pubWorld(wid)); }
    removeDoc('world', wid);
    closeWorld();
    S.form = null;
    S.mode = 'loading';
    chooseWorld();
    toast(`Deleted ${w.title}.`);
    render();
  }

  // ---------------------------------------------------------------- importing worlds

  // The offline copy carries the examples inside it (a page opened from a file can't fetch them).
  async function exampleData(file) {
    const inside = window.INKWASH_EXAMPLES && window.INKWASH_EXAMPLES[file];
    if (inside) return C.clone(inside);
    const res = await fetch(file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function loadExample() {
    try {
      importWorld(await exampleData('example-world.json'), true);
    } catch (e) {
      toast(`Couldn't open the example world (${e.message}).`, 'error');
    }
  }
  function importWorld(data, keepTime) {
    let parsed;
    try { parsed = C.readBackup(data); } catch (e) { toast(e.message, 'error'); return; }
    const wid = C.uid('w');
    openWorld(wid);
    const o = { quiet: true, keepTime: !!keepTime };
    put('world', wid, Object.assign({}, parsed.world, { createdAt: parsed.world.createdAt || now() }), o);
    for (const e of parsed.entities) put('canon', e.id, e, o);
    for (const c of parsed.chapters) put('chapters', c.id, c, o);
    for (const p of parsed.passages) put('passages', p.id, p, o);
    for (const s of parsed.seeds) put('seeds', s.id, s, o);
    for (const pl of parsed.plates) put('plates', pl.id, pl, o);
    for (const src of parsed.sources) put('sources', src.id, src, o);
    S.leftOff.due = false;
    if (parsed.atlas && parsed.atlas.spec) put('atlas', 'main', parsed.atlas, o);
    S.loaded = new Set(WORLD_KINDS);
    S.cid = (parsed.world.chapterOrder || [])[0] || null;
    S.k = 0;
    S.view = 'score';
    toast(`Opened ${parsed.world.title}.`);
    render();
  }

  // ---------------------------------------------------------------- score view

  function scoreView() {
    const w = world();
    const order = chapterOrder();
    if (!S.cid || !S.chapters.has(S.cid)) { S.cid = order[0] || null; S.k = 0; }
    if (!S.cid) {
      return h('section', { class: 'page-pad' },
        h('div', { class: 'page-head' }, h('h1', null, w.title), h('p', { class: 'muted' }, 'This world has no chapters yet.')),
        h('div', null, h('button', { class: 'btn primary', type: 'button', onclick: addChapter }, 'Add a chapter')));
    }
    const ch = S.chapters.get(S.cid);
    S.k = C.clamp(S.k, 0, ch.scenes - 1);
    return h('div', { class: 'score-view' }, railView(order), scoreMain(ch), sheetView(ch));
  }

  function sparkPath(tension) {
    let d = '', pen = false;
    for (let i = 0; i < N; i++) {
      const v = tension ? tension[i] : null;
      if (v == null) { pen = false; continue; }
      const x = (i / (N - 1)) * 100, y = 1 + (1 - v) * 16;
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      pen = true;
    }
    return d.trim();
  }
  function railView(order) {
    const rail = h('nav', { class: 'rail', 'aria-label': 'Chapters' });
    order.forEach((cid, i) => {
      const ch = S.chapters.get(cid);
      const spark = svg('svg', { class: 'rail-spark', viewBox: '0 0 100 18', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      const d = sparkPath(ch.tension);
      if (d) spark.append(svg('path', { d, 'vector-effect': 'non-scaling-stroke' }));
      const dots = h('span', { class: 'rail-dots', 'aria-hidden': 'true' });
      for (let k = 0; k < ch.scenes; k++) dots.append(h('span', { class: 'dot', 'data-state': sceneInfo(cid, k).state }));
      rail.append(h('button', {
        class: 'rail-item', type: 'button', 'aria-current': cid === S.cid ? 'true' : null,
        onclick: () => { S.cid = cid; S.k = 0; S.selection = null; savePos(); render(); },
      }, h('span', { class: 'rail-no' }, String(i + 1)), h('span', { class: 'rail-title' }, ch.title), spark, dots));
    });
    rail.append(h('button', { class: 'btn ghost small', type: 'button', onclick: addChapter, disabled: S.readOnly }, 'Add a chapter'));
    return rail;
  }

  function scoreMain(ch) {
    const w = world();
    const idx_ = chapterOrder().indexOf(S.cid);
    const head = h('div', { class: 'score-head' },
      h('label', { class: 'sr-only', for: 'chapter-title' }, 'Chapter title'),
      h('input', {
        class: 'chapter-title', id: 'chapter-title', type: 'text', value: ch.title, 'data-keep': '', disabled: S.readOnly,
        onchange: (e) => { const t = e.target.value.trim(); if (t && t !== ch.title) put('chapters', S.cid, Object.assign({}, ch, { title: t })); },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      }),
      h('span', { class: 'scene-count' },
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove the last scene', disabled: ch.scenes <= 1 || S.readOnly, onclick: () => changeScenes(-1) }, '−'),
        h('span', { class: 'num' }, plural(ch.scenes, 'scene')),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Add a scene', disabled: ch.scenes >= 12 || S.readOnly, onclick: () => changeScenes(1) }, '+')),
      h('span', { class: 'btn-row' },
        h('button', { class: 'btn ghost small', type: 'button', disabled: idx_ <= 0 || S.readOnly, onclick: () => moveChapter(-1) }, 'Move up'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: idx_ >= chapterOrder().length - 1 || S.readOnly, onclick: () => moveChapter(1) }, 'Move down'),
        h('button', { class: 'btn ghost small danger', type: 'button', disabled: S.readOnly, onclick: deleteChapter }, 'Delete chapter')));

    const tools = h('span', { class: 'tools', role: 'group', 'aria-label': 'Brush' },
      h('button', { class: 'tool', type: 'button', 'aria-pressed': String(S.tool === 'brush'), onclick: () => { S.tool = 'brush'; render(); } }, 'Brush'),
      h('button', { class: 'tool', type: 'button', 'aria-pressed': String(S.tool === 'erase'), onclick: () => { S.tool = 'erase'; render(); } }, 'Eraser'));
    const pigs = (w.pigments || []);
    if (!S.pigment || !pigs.some((p) => p.id === S.pigment)) S.pigment = pigs[0] ? pigs[0].id : null;
    const swatches = h('span', { class: 'swatches', role: 'group', 'aria-label': 'Mood' },
      pigs.map((p, i) => h('button', {
        class: 'swatch', type: 'button', 'aria-pressed': String(S.pigment === p.id), title: p.line ? `${p.name}: “${p.line}” (key ${i + 1})` : `${p.name} (key ${i + 1})`,
        onclick: () => { S.pigment = p.id; render(); },
      }, h('i', { style: { background: p.color } }), p.name)));
    const others = entities().filter((e) => e.kind === 'character' && !(ch.cast || []).includes(e.id));
    const addCast = others.length ? h('select', {
      id: 'add-cast', 'aria-label': 'Add a character to this chapter', disabled: S.readOnly,
      onchange: (e) => { if (e.target.value) addToCast(e.target.value); },
    }, h('option', { value: '' }, 'Add a character to this chapter…'), others.map((e) => h('option', { value: e.id }, e.name))) : null;
    const wrap = h('div', { class: 'canvas-wrap' });
    Score.mount(wrap, ch);
    return h('div', { class: 'score-main' }, head,
      h('div', { class: 'toolbar' }, tools, swatches, addCast),
      wrap,
      h('p', { class: 'hint', id: 'score-hint' }, 'Drag across a lane to paint it: draw the tension curve, brush the chosen mood, or paint a character’s line where they are in the scene. Click a scene’s name to open it. With the score focused, ← → choose a scene, ↑ ↓ raise or lower its tension, and 1 to 5 add a mood (Shift removes it).'));
  }

  function addChapter() {
    const w = world();
    const cid = C.uid('c');
    const n = chapterOrder().length + 1;
    put('chapters', cid, C.newChapter(`Chapter ${n}`, 3, now()), { quiet: true });
    put('world', S.wid, Object.assign({}, w, { chapterOrder: (w.chapterOrder || []).concat([cid]) }), { quiet: true });
    S.cid = cid; S.k = 0; S.view = 'score';
    savePos();
    render();
  }
  function moveChapter(dir) {
    const w = world();
    const order = (w.chapterOrder || []).slice();
    const i = order.indexOf(S.cid), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    put('world', S.wid, Object.assign({}, w, { chapterOrder: order }));
  }
  async function deleteChapter() {
    const ch = S.chapters.get(S.cid);
    const written = [...S.passages.values()].filter((p) => p.chapter === S.cid && p.text).length;
    const ok = await ask({ title: `Delete ${ch.title}?`, body: written ? `Its ${plural(written, 'written scene')} and its painted score are deleted for good.` : 'Its painted score is deleted for good.', confirm: 'Delete chapter', danger: true });
    if (!ok) return;
    const cid = S.cid, w = world();
    for (const p of [...S.passages.values()]) if (p.chapter === cid) removeDoc('passages', p.id);
    for (const pl of [...S.plates.values()]) if (pl.chapter === cid) removeDoc('plates', pl.id);
    if (S.pub.has(cid)) { removeDoc('pub', cid); writePubWorld(); }
    for (const e of entities()) {
      if ((e.facts || []).some((f) => f.reveal === cid)) put('canon', e.id, Object.assign({}, e, { facts: e.facts.map((f) => (f.reveal === cid ? Object.assign({}, f, { reveal: null }) : f)) }), { quiet: true });
    }
    removeDoc('chapters', cid);
    put('world', S.wid, Object.assign({}, w, { chapterOrder: (w.chapterOrder || []).filter((x) => x !== cid) }), { quiet: true });
    S.cid = null; S.k = 0;
    render();
  }
  async function changeScenes(delta) {
    const ch = S.chapters.get(S.cid);
    const to = ch.scenes + delta;
    if (to < 1 || to > 12) return;
    if (delta < 0) {
      const last = S.passages.get(C.passageId(S.cid, ch.scenes - 1));
      if (last && last.text && last.text.trim()) {
        const ok = await ask({ title: `Remove scene ${ch.scenes}?`, body: 'It has text. Removing the scene deletes that text too.', confirm: 'Remove scene', danger: true });
        if (!ok) return;
      }
      if (last) removeDoc('passages', last.id);
    }
    put('chapters', S.cid, C.resampleScenes(ch, to));
    S.k = Math.min(S.k, to - 1);
  }
  function addToCast(eid) {
    const ch = C.clone(S.chapters.get(S.cid));
    if (!ch.cast.includes(eid)) ch.cast.push(eid);
    ch.threads[eid] = ch.threads[eid] || new Array(N).fill(0);
    C.setPresence(ch.threads[eid], ch.scenes, S.k, true);
    put('chapters', S.cid, ch);
  }
  function removeFromCast(eid) {
    const ch = C.clone(S.chapters.get(S.cid));
    ch.cast = ch.cast.filter((x) => x !== eid);
    delete ch.threads[eid];
    put('chapters', S.cid, ch);
  }
  function selectScene(k, focusSheet) {
    const ch = S.chapters.get(S.cid);
    if (!ch) return;
    S.k = C.clamp(k, 0, ch.scenes - 1);
    S.selection = null; S.confirmReink = null;
    savePos();
    render();
    if (focusSheet) requestAnimationFrame(() => { const el = $('.sheet h2'); if (el) { el.setAttribute('tabindex', '-1'); el.focus(); } });
  }

  // ---------------------------------------------------------------- the canvas score

  const L = { label: 96, pad: 14, head: 34, tension: 118, gap: 12, mood: 58, row: 26, pins: 104 };
  const Score = {
    canvas: null, ctx: null, ro: null, lay: null, stroke: null, frame: 0, grain: null, grainKey: '', moodCanvas: null,
    mount(wrap, ch) {
      if (!this.canvas) {
        this.canvas = h('canvas', { id: 'score-canvas', tabindex: '0', 'aria-describedby': 'score-hint' });
        this.ctx = this.canvas.getContext('2d');
        this.canvas.addEventListener('pointerdown', (e) => this.down(e));
        this.canvas.addEventListener('pointermove', (e) => this.move(e));
        this.canvas.addEventListener('pointerup', (e) => this.up(e));
        this.canvas.addEventListener('pointercancel', (e) => this.up(e));
        this.canvas.addEventListener('keydown', (e) => this.key(e));
        this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.queue()) : null;
      }
      this.canvas.setAttribute('aria-label', `Score of ${ch.title}: tension, mood, who is in each scene, pins and notes. Scene ${S.k + 1} of ${ch.scenes} is selected.`);
      wrap.append(this.canvas);
      if (this.ro) { this.ro.disconnect(); this.ro.observe(wrap); }
    },
    queue() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    },
    layout(ch, w) {
      const rows = Math.max(1, (ch.cast || []).length);
      let y = 0;
      const head = { y, h: L.head }; y += L.head;
      const tension = { y: y + 6, h: L.tension }; y += L.tension + 6 + L.gap;
      const mood = { y, h: L.mood }; y += L.mood + L.gap;
      const threads = { y, h: rows * L.row }; y += threads.h + L.gap;
      const pins = { y, h: L.pins }; y += L.pins + L.pad;
      return { x0: Math.min(L.label, w * 0.22), x1: w - L.pad, w, h: y, head, tension, mood, threads, pins, rows };
    },
    colors() {
      const cs = getComputedStyle(document.documentElement);
      const v = (n) => cs.getPropertyValue(n).trim();
      const c = { paper: v('--paper'), deep: v('--paper-deep'), sheet: v('--sheet'), ink: v('--ink'), soft: v('--ink-soft'), faint: v('--ink-faint'), rule: v('--rule'), indigo: v('--indigo'), wet: v('--wet'), seal: v('--seal'), stale: v('--stale') };
      const rgb = hexRgb(c.paper);
      c.dark = rgb ? (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) < 110 : false;
      return c;
    },
    grainFor(col) {
      const key = col.ink + col.dark;
      if (this.grain && this.grainKey === key) return this.grain;
      const g = document.createElement('canvas');
      g.width = 96; g.height = 96;
      const x = g.getContext('2d');
      const rgb = hexRgb(col.ink) || [0, 0, 0];
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 900; i++) {
        x.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(col.dark ? 0.05 : 0.035) * rnd()})`;
        x.fillRect(Math.floor(rnd() * 96), Math.floor(rnd() * 96), 1, 1 + Math.floor(rnd() * 2));
      }
      this.grain = this.ctx.createPattern(g, 'repeat');
      this.grainKey = key;
      return this.grain;
    },
    draw() {
      const cv = this.canvas;
      if (!cv || !cv.isConnected) return;
      const ch = S.chapters.get(S.cid);
      const w = world();
      if (!ch || !w) return;
      const cssW = Math.max(300, cv.parentElement.clientWidth);
      const lay = this.layout(ch, cssW);
      this.lay = lay;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(lay.h * dpr)) {
        cv.width = Math.round(cssW * dpr); cv.height = Math.round(lay.h * dpr); cv.style.height = lay.h + 'px';
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = this.colors();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.paper; ctx.fillRect(0, 0, cssW, lay.h);
      ctx.fillStyle = this.grainFor(col); ctx.fillRect(0, 0, cssW, lay.h);
      const { x0, x1 } = lay;
      const sx = (i) => x0 + (i / (N - 1)) * (x1 - x0);
      const scenes = ch.scenes;
      const infos = Array.from({ length: scenes }, (_, k) => sceneInfo(S.cid, k));
      // scene columns
      for (let k = 0; k < scenes; k++) {
        const a = x0 + ((x1 - x0) * k) / scenes, b = x0 + ((x1 - x0) * (k + 1)) / scenes;
        if (k === S.k) { ctx.fillStyle = withAlpha(col.indigo, col.dark ? 0.1 : 0.07); ctx.fillRect(a, 0, b - a, lay.h); }
        if (infos[k].state === 'stale') {
          const g = ctx.createLinearGradient(0, 0, 0, 60);
          g.addColorStop(0, withAlpha(col.stale, 0.32)); g.addColorStop(1, withAlpha(col.stale, 0));
          ctx.fillStyle = g; ctx.fillRect(a, 0, b - a, 60);
          ctx.strokeStyle = withAlpha(col.stale, 0.75); ctx.lineWidth = 1.5; ctx.strokeRect(a + 1, 1, b - a - 2, lay.h - 2);
        }
        if (k > 0) { ctx.strokeStyle = col.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(a) + 0.5, 4); ctx.lineTo(Math.round(a) + 0.5, lay.h - 4); ctx.stroke(); }
        // scene label and state mark
        ctx.font = `${k === S.k ? 700 : 500} 12px ${uiFont()}`;
        ctx.fillStyle = k === S.k ? col.ink : col.soft;
        ctx.textBaseline = 'middle';
        ctx.fillText(`SCENE ${k + 1}`, a + 22, lay.head.h / 2 + 1);
        stateMark(ctx, col, infos[k].state, a + 11, lay.head.h / 2 + 1);
      }
      // lane labels
      ctx.font = `500 11px ${uiFont()}`;
      ctx.fillStyle = col.faint;
      ctx.textBaseline = 'top';
      ctx.fillText('TENSION', 10, lay.tension.y + 2);
      ctx.fillText('MOOD', 10, lay.mood.y + 2);
      ctx.fillText('PINS & NOTES', 10, lay.pins.y + 2);
      // tension guides
      ctx.strokeStyle = withAlpha(col.faint, 0.35); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      for (const g of [0.25, 0.5, 0.75]) { const y = Math.round(lay.tension.y + (1 - g) * lay.tension.h) + 0.5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.strokeStyle = col.rule; ctx.beginPath(); ctx.moveTo(x0, lay.tension.y + lay.tension.h + 0.5); ctx.lineTo(x1, lay.tension.y + lay.tension.h + 0.5); ctx.stroke();
      this.drawTension(ctx, col, ch, lay, sx);
      this.drawMood(ctx, col, ch, w, lay);
      this.drawThreads(ctx, col, ch, lay, sx);
      this.drawPins(ctx, col, ch, lay);
    },
    drawTension(ctx, col, ch, lay, sx) {
      const t = ch.tension || [];
      const ty = (v) => lay.tension.y + (1 - v) * lay.tension.h;
      const runs = [];
      let run = null;
      for (let i = 0; i < N; i++) {
        if (t[i] == null) { run = null; continue; }
        if (!run) { run = []; runs.push(run); }
        run.push([sx(i), ty(t[i])]);
      }
      if (!runs.length) {
        ctx.font = `italic 15px ${bookFont()}`; ctx.fillStyle = col.faint; ctx.textBaseline = 'middle';
        ctx.fillText('Drag across this lane to draw how tense each moment is.', lay.x0 + 14, lay.tension.y + lay.tension.h / 2);
        return;
      }
      const path = (pts) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      };
      for (const pts of runs) {
        // the wash beneath the line
        const base = lay.tension.y + lay.tension.h;
        const g = ctx.createLinearGradient(0, lay.tension.y, 0, base);
        g.addColorStop(0, withAlpha(col.ink, col.dark ? 0.16 : 0.12)); g.addColorStop(1, withAlpha(col.ink, 0));
        path(pts);
        ctx.lineTo(pts[pts.length - 1][0], base); ctx.lineTo(pts[0][0], base); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
        // bleed, then the line itself
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const [lw, a] of [[11, 0.05], [6, 0.1], [2.6, 0.92]]) {
          path(pts);
          ctx.strokeStyle = withAlpha(col.ink, a); ctx.lineWidth = lw; ctx.stroke();
        }
        if (pts.length === 1) { ctx.fillStyle = col.ink; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 2.5, 0, Math.PI * 2); ctx.fill(); }
      }
    },
    drawMood(ctx, col, ch, w, lay) {
      const pigs = (w.pigments || []).filter((p) => ch.mood && ch.mood[p.id]);
      if (!pigs.length) {
        ctx.font = `italic 15px ${bookFont()}`; ctx.fillStyle = col.faint; ctx.textBaseline = 'middle';
        ctx.fillText('Choose a mood above, then brush it across the scenes it colors.', lay.x0 + 14, lay.mood.y + lay.mood.h / 2);
        return;
      }
      if (!this.moodCanvas) { this.moodCanvas = document.createElement('canvas'); this.moodCanvas.width = N; this.moodCanvas.height = 8; }
      const m = this.moodCanvas.getContext('2d');
      const edge = [0.25, 0.7, 1, 1, 1, 1, 0.7, 0.25];
      for (const p of pigs) {
        const rgb = hexRgb(p.color) || [128, 128, 128];
        const arr = ch.mood[p.id];
        m.clearRect(0, 0, N, 8);
        for (let i = 0; i < N; i++) {
          const v = arr[i] || 0;
          if (!v) continue;
          for (let r = 0; r < 8; r++) { m.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(1, v * 0.95) * edge[r]})`; m.fillRect(i, r, 1, 1); }
        }
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.globalCompositeOperation = col.dark ? 'screen' : 'multiply';
        ctx.drawImage(this.moodCanvas, 0, 0, N, 8, lay.x0, lay.mood.y, lay.x1 - lay.x0, lay.mood.h);
        ctx.restore();
      }
    },
    drawThreads(ctx, col, ch, lay, sx) {
      const cast = (ch.cast || []).filter((id) => S.canon.has(id));
      ctx.textBaseline = 'middle';
      if (!cast.length) {
        ctx.font = `500 11px ${uiFont()}`; ctx.fillStyle = col.faint; ctx.fillText('WHO IS IN IT', 10, lay.threads.y + L.row / 2);
        ctx.font = `italic 15px ${bookFont()}`;
        ctx.fillText('Add a character to this chapter, then paint their line where they appear.', lay.x0 + 14, lay.threads.y + L.row / 2);
        return;
      }
      cast.forEach((id, r) => {
        const e = S.canon.get(id);
        const y = lay.threads.y + r * L.row + L.row / 2;
        ctx.font = `500 12px ${uiFont()}`; ctx.fillStyle = col.soft;
        ctx.fillText(fit(ctx, e.name, lay.x0 - 16), 10, y);
        ctx.strokeStyle = withAlpha(col.faint, 0.6); ctx.lineWidth = 1; ctx.setLineDash([1.5, 5]);
        ctx.beginPath(); ctx.moveTo(lay.x0, y); ctx.lineTo(lay.x1, y); ctx.stroke(); ctx.setLineDash([]);
        const arr = (ch.threads || {})[id] || [];
        ctx.strokeStyle = col.ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
        let open = false;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const wob = Math.sin(i * 0.55 + r * 1.7) * 0.7;
          if (arr[i]) { if (!open) { ctx.moveTo(sx(i), y + wob); open = true; } else ctx.lineTo(sx(i), y + wob); }
          else open = false;
        }
        ctx.stroke();
      });
      // First meetings: a brush tick joining each pair's lines, and one label per scene.
      const rowOf = new Map(cast.map((id, r) => [id, r]));
      const rowY = (id) => lay.threads.y + rowOf.get(id) * L.row + L.row / 2;
      for (let k = 0; k < ch.scenes; k++) {
        const pairs = C.firstMeetings(world(), S.chapters, S.cid, k).filter(([a, b]) => rowOf.has(a) && rowOf.has(b));
        if (!pairs.length) continue;
        const [i0, i1] = C.sceneRange(ch.scenes, k);
        let lastX = 0, top = Infinity, bottom = -Infinity;
        pairs.forEach(([a, b], j) => {
          let at = i0;
          for (let i = i0; i < i1; i++) if (ch.threads[a][i] && ch.threads[b][i]) { at = i; break; }
          const x = sx(at) + 6 + j * 9;
          const ya = rowY(a), yb = rowY(b);
          ctx.strokeStyle = col.seal; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(x - 3, ya); ctx.quadraticCurveTo(x + 6, (ya + yb) / 2, x - 3, yb); ctx.stroke();
          lastX = Math.max(lastX, x);
          top = Math.min(top, ya, yb); bottom = Math.max(bottom, ya, yb);
        });
        ctx.font = `italic 11px ${bookFont()}`; ctx.fillStyle = col.seal; ctx.textBaseline = 'middle';
        ctx.fillText('they meet', lastX + 8, top + L.row / 2); // in the gap below the top line, never on a line
      }
    },
    // Pins as paper slips, notes in a hand, both wrapped to the scene's column.
    drawPins(ctx, col, ch, lay) {
      const LINE = 16;
      for (let k = 0; k < ch.scenes; k++) {
        const a = lay.x0 + ((lay.x1 - lay.x0) * k) / ch.scenes, b = lay.x0 + ((lay.x1 - lay.x0) * (k + 1)) / ch.scenes;
        const items = pinsOf(ch, k).map((p) => ['pin', p.text]).concat(notesOf(ch, k).map((n) => ['note', n.text]));
        const maxW = b - a - 20;
        const bottom = lay.pins.y + lay.pins.h - 6;
        let y = lay.pins.y + 4, shown = 0;
        for (const [kind, text] of items) {
          const room = Math.floor((bottom - y - (shown < items.length - 1 ? LINE : 0)) / LINE);
          if (room < 1) break;
          ctx.textBaseline = 'middle';
          if (kind === 'pin') {
            ctx.font = `13px ${bookFont()}`;
            const lines = wrapLines(ctx, text, maxW - 22, Math.min(2, room));
            const w = Math.max(...lines.map((ln) => ctx.measureText(ln).width)) + 22, hgt = lines.length * LINE + 5;
            ctx.save();
            ctx.translate(a + 10, y);
            ctx.rotate(((shown % 2 ? 1 : -1) * 0.6 * Math.PI) / 180);
            ctx.fillStyle = col.sheet; ctx.strokeStyle = col.rule; ctx.lineWidth = 1;
            ctx.fillRect(0, 0, w, hgt); ctx.strokeRect(0.5, 0.5, w - 1, hgt - 1);
            ctx.fillStyle = col.seal; ctx.beginPath(); ctx.arc(9, 10.5, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = col.ink;
            lines.forEach((ln, i) => ctx.fillText(ln, 17, 11 + i * LINE));
            ctx.restore();
            y += hgt + 5;
          } else {
            ctx.font = `13px ${handFont()}`;
            ctx.fillStyle = col.soft;
            const lines = wrapLines(ctx, text, maxW, Math.min(4, room));
            lines.forEach((ln, i) => ctx.fillText(ln, a + 12, y + 9 + i * LINE));
            y += lines.length * LINE + 5;
          }
          shown++;
        }
        if (shown < items.length) {
          ctx.font = `12px ${uiFont()}`; ctx.fillStyle = col.faint; ctx.textBaseline = 'middle';
          ctx.fillText(`+${items.length - shown} more`, a + 12, Math.min(y + 8, bottom));
        }
      }
    },
    point(e) {
      const r = this.canvas.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    },
    laneAt(py) {
      const l = this.lay;
      if (!l) return null;
      if (py < l.head.y + l.head.h) return { name: 'head' };
      if (py >= l.tension.y - 6 && py <= l.tension.y + l.tension.h + 4) return { name: 'tension' };
      if (py >= l.mood.y && py <= l.mood.y + l.mood.h) return { name: 'mood' };
      if (py >= l.threads.y && py <= l.threads.y + l.threads.h) return { name: 'threads', row: Math.floor((py - l.threads.y) / L.row) };
      if (py >= l.pins.y) return { name: 'pins' };
      return null;
    },
    norm(px, py) {
      const l = this.lay;
      return { x: C.clamp((px - l.x0) / (l.x1 - l.x0), 0, 1), y: C.clamp(1 - (py - l.tension.y) / l.tension.h, 0, 1) };
    },
    down(e) {
      if (!this.lay || e.button > 0) return;
      const { px, py } = this.point(e);
      const lane = this.laneAt(py);
      const ch = S.chapters.get(S.cid);
      if (!lane || !ch) return;
      const pt = this.norm(px, py);
      if (lane.name === 'head' || lane.name === 'pins' || px < this.lay.x0 - 4) {
        if (px >= this.lay.x0 - 4) selectScene(C.sceneAt(ch.scenes, pt.x));
        return;
      }
      if (S.readOnly) return;
      const cast = (ch.cast || []).filter((id) => S.canon.has(id));
      if (lane.name === 'threads' && !cast[lane.row]) return;
      if (lane.name === 'mood' && !S.pigment) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.stroke = { lane: lane.name, id: lane.name === 'threads' ? cast[lane.row] : null, last: pt, moved: false };
      this.paint(ch, pt, pt);
      this.queue();
    },
    move(e) {
      if (!this.stroke) return;
      const ch = S.chapters.get(S.cid);
      if (!ch) return;
      const { px, py } = this.point(e);
      const pt = this.norm(px, py);
      this.paint(ch, this.stroke.last, pt);
      this.stroke.last = pt;
      this.stroke.moved = true;
      this.queue();
    },
    up() {
      if (!this.stroke) return;
      this.stroke = null;
      const ch = S.chapters.get(S.cid);
      if (!ch) return;
      put('chapters', S.cid, Object.assign({}, ch, { strokes: (ch.strokes || 0) + 1 }));
    },
    paint(ch, a, b) {
      const s = this.stroke;
      const erase = S.tool === 'erase';
      if (s.lane === 'tension') {
        if (!ch.tension) ch.tension = new Array(N).fill(null);
        if (erase) C.eraseLine(ch.tension, a, b, null); else C.paintTension(ch.tension, a, b);
      } else if (s.lane === 'mood') {
        ch.mood = ch.mood || {};
        const ids = erase ? Object.keys(ch.mood).filter((id) => !S.pigment || id === S.pigment) : [S.pigment];
        for (const id of ids) {
          if (!ch.mood[id]) ch.mood[id] = new Array(N).fill(0);
          C.paintWash(ch.mood[id], a, b, erase ? -0.18 : 0.07, 4);
        }
      } else if (s.lane === 'threads') {
        ch.threads = ch.threads || {};
        if (!ch.threads[s.id]) ch.threads[s.id] = new Array(N).fill(0);
        C.paintLine(ch.threads[s.id], a, b, () => (erase ? 0 : 1));
      }
    },
    key(e) {
      const ch = S.chapters.get(S.cid);
      if (!ch) return;
      const w = world();
      let changed = false, msg = '';
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        selectScene(S.k + (e.key === 'ArrowLeft' ? -1 : 1));
        requestAnimationFrame(() => this.canvas.focus());
        announce(`Scene ${S.k + 1}`);
        return;
      }
      if (S.readOnly) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!ch.tension) ch.tension = new Array(N).fill(null);
        C.nudgeTension(ch.tension, ch.scenes, S.k, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.15 : 0.05));
        const [i0, i1] = C.sceneRange(ch.scenes, S.k);
        const t = C.tensionSummary(ch.tension, i0, i1);
        msg = t ? `Scene ${S.k + 1} tension ${t.mean.toFixed(2)}, ${t.level}` : '';
        changed = true;
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const p = (w.pigments || [])[Number(e.code.slice(5)) - 1];
        if (!p) return;
        e.preventDefault();
        ch.mood = ch.mood || {};
        if (!ch.mood[p.id]) ch.mood[p.id] = new Array(N).fill(0);
        C.washScene(ch.mood[p.id], ch.scenes, S.k, e.shiftKey ? -0.2 : 0.2);
        msg = `${e.shiftKey ? 'Less' : 'More'} ${p.name.toLowerCase()} in scene ${S.k + 1}`;
        changed = true;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const el = $('.sheet h2');
        if (el) { el.setAttribute('tabindex', '-1'); el.focus(); }
      }
      if (changed) {
        put('chapters', S.cid, Object.assign({}, ch, { strokes: (ch.strokes || 0) + 1 }));
        requestAnimationFrame(() => this.canvas.focus());
        if (msg) announce(msg);
      }
    },
  };
  function stateMark(ctx, col, state, x, y) {
    ctx.save();
    if (state === 'set') { ctx.strokeStyle = col.seal; ctx.lineWidth = 1.6; ctx.translate(x, y); ctx.rotate(-0.12); ctx.strokeRect(-4.5, -4.5, 9, 9); }
    else if (state === 'wet') { ctx.fillStyle = col.wet; ctx.translate(x, y + 1); ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(4, 0, 0, 4); ctx.quadraticCurveTo(-4, 0, 0, -5); ctx.fill(); }
    else if (state === 'stale') { ctx.fillStyle = col.stale; ctx.shadowColor = col.stale; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); }
    else if (state === 'draft') { ctx.fillStyle = col.faint; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.strokeStyle = col.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  function fit(ctx, text, maxW) {
    text = String(text || '');
    if (maxW <= 10) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).trimEnd() + '…';
  }
  // Greedy word wrap; the last allowed line ends in an ellipsis if the text runs on.
  function wrapLines(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (!cur || ctx.measureText(next).width <= maxW) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const rest = lines.slice(maxLines - 1).join(' ');
      lines.length = maxLines - 1;
      lines.push(fit(ctx, rest, maxW));
    }
    return lines.map((ln) => (ctx.measureText(ln).width > maxW ? fit(ctx, ln, maxW) : ln));
  }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let s = m[1];
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  function withAlpha(hex, a) {
    const rgb = hexRgb(hex);
    return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : hex;
  }
  const uiFont = () => '"Alegreya Sans", "Gill Sans", "Segoe UI", system-ui, sans-serif';
  const bookFont = () => 'Alegreya, "Iowan Old Style", Georgia, serif';
  const handFont = () => 'Kalam, "Bradley Hand", "Segoe Print", cursive';

  // ---------------------------------------------------------------- the scene sheet

  function sheetView(ch) {
    const k = S.k, key = C.passageId(S.cid, k);
    const info = sceneInfo(S.cid, k);
    const p = info.p;
    const sheet = h('aside', { class: 'sheet', 'aria-label': `Scene ${k + 1}` });
    const hs = p && p.text ? C.handStats(p.text, p.spans) : null;
    sheet.append(h('div', { class: 'sheet-head' },
      h('h2', null, `Scene ${k + 1}`),
      pill(info.state, 'scene-pill'),
      h('span', { id: 'scene-meter' }, hs && hs.total ? meter(hs.hand) : null),
      h('span', { class: 'sheet-nav' },
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Previous scene', disabled: k === 0, onclick: () => selectScene(k - 1) }, '←'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Next scene', disabled: k >= ch.scenes - 1, onclick: () => selectScene(k + 1) }, '→'))));
    const plateId = PL.plateId.scene(S.cid, k);
    if (S.plates.has(plateId) || S.busy['plate:' + plateId]) sheet.append(plateSection({ kind: 'scene', id: plateId, cid: S.cid, k }));
    if (info.state === 'stale' && !S.busy['ink:' + key]) sheet.append(staleBox(key, info.reasons));
    sheet.append(passageSection(ch, k, key, p, info));
    if (p && !S.busy['ink:' + key]) {
      const sugg = suggestionsSection(key, p);
      if (sugg) sheet.append(sugg);
    }
    if (!S.plates.has(plateId) && !S.busy['plate:' + plateId] && aiOn()) sheet.append(plateSection({ kind: 'scene', id: plateId, cid: S.cid, k }));
    sheet.append(designSection(ch, k));
    const brief = briefFor(S.cid, k);
    sheet.append(h('details', { class: 'brief' },
      h('summary', null, 'What the AI will get for this scene'),
      h('pre', null, brief.display)));
    return sheet;
  }

  function staleBox(key, reasons) {
    const box = h('section', { class: 'stale-box', 'aria-label': 'This scene is stale' },
      h('h3', null, 'This scene relies on facts that changed'));
    for (const r of reasons) {
      let body;
      if (r.kind === 'changed') body = [h('del', null, r.before || '(earlier wording)'), h('ins', null, r.after)];
      else if (r.kind === 'retired') body = [h('del', null, r.before || '(a fact)'), h('span', { class: 'muted' }, 'This fact was retired.')];
      else if (r.kind === 'removed') body = [h('span', { class: 'muted' }, 'A fact this scene used was deleted along with its entity.')];
      else body = [h('ins', null, r.after || '(retired)'), h('span', { class: 'muted' }, 'New since you set this scene (strict continuity).')];
      box.append(h('div', { class: 'change' }, r.entity ? h('strong', null, r.entity) : null, body, r.phase === 'wet' ? h('span', { class: 'faint' }, 'Changed after the scene was inked.') : null));
    }
    box.append(h('p', { class: 'muted' }, 'Read the scene against the new wording. If it still holds, mark it still true. If not, edit it, repaint the part that’s wrong, or ink it again.'));
    box.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn seal', type: 'button', disabled: S.readOnly, onclick: () => markStillTrue(key) }, 'Still true'),
      h('button', { class: 'btn', type: 'button', disabled: S.readOnly || !S.sample || !!S.aiOff, onclick: () => inkScene(S.cid, S.k) }, 'Ink it again')));
    return box;
  }

  function passageSection(ch, k, key, p, info) {
    const sec = h('section', { class: 'section', 'aria-label': 'Scene text' });
    const inkBusy = S.busy['ink:' + key];
    if (inkBusy) {
      const stream = h('div', { class: 'ink-stream wet', id: 'stream-' + key, 'aria-live': 'off' });
      fillStream(stream, inkBusy.text);
      sec.append(h('h3', null, 'Inking'), stream,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => inkBusy.ctl.abort() }, 'Stop')));
      return sec;
    }
    const aiReady = !!S.sample && !S.aiOff && !S.readOnly;
    if (!p) {
      sec.append(h('div', { class: 'empty-scene' },
        h('p', null, 'This scene isn’t written yet.'),
        h('p', { class: 'muted' }, aiReady
          ? 'Inking sends the brief below to Claude on your own Claude account. It writes inside your design: your tension, moods, cast, pinned lines and notes, and the canon.'
          : 'Write it yourself. Your painting, pins and notes stay with the scene either way.'),
        h('div', { class: 'btn-row' },
          aiReady ? h('button', { class: 'btn primary', type: 'button', onclick: () => inkScene(S.cid, k) }, 'Ink this scene') : null,
          h('button', { class: 'btn', type: 'button', disabled: S.readOnly, onclick: () => writeByHand(key, k) }, 'Write it yourself'))));
      return sec;
    }
    const wet = C.isWet(p);
    const hs = C.handStats(p.text, p.spans);
    sec.append(h('h3', null, wet ? 'Wet ink' : p.setAt ? 'Set' : 'Your draft'));
    sec.append(editorView(key, p, ch));
    sec.append(legendView(hs));
    sec.append(h('div', { id: 'selection-slot' }, selectionBar(key, p)));
    sec.append(h('div', { id: 'set-row' }, setRow(key, p, ch)));
    const repaintBusy = S.busy['repaint:' + key];
    const actions = h('div', { class: 'btn-row' });
    if (S.confirmReink === key) {
      const hsx = C.handStats(p.text, p.spans);
      actions.append(h('p', { class: 'muted' }, `Inking again replaces this scene, including ${plural(hsx.words.typed + hsx.words.pinned, 'word')} in your own hand.`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { S.confirmReink = null; inkScene(S.cid, k, true); } }, 'Ink it again anyway'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.confirmReink = null; render(); } }, 'Keep this version'));
    } else {
      if (aiReady) {
        actions.append(h('button', { class: 'btn', type: 'button', disabled: !!repaintBusy, onclick: () => inkScene(S.cid, k) }, 'Ink the whole scene again'));
        actions.append(h('button', { class: 'btn', type: 'button', disabled: !!S.busy['check:' + key] || !p.text.trim(), onclick: () => runContinuity(key) }, S.busy['check:' + key] ? 'Checking against canon…' : 'Check against canon'));
      }
      actions.append(h('button', { class: 'btn ghost small danger', type: 'button', disabled: S.readOnly, onclick: () => clearScene(key) }, 'Clear scene'));
    }
    sec.append(actions);
    return sec;
  }
  // Who wrote what, as the editor colors it. Pasted text gets a key only when there is some.
  function legendView(hs) {
    const swatch = (style, cls) => h('i', { style, class: cls, 'aria-hidden': 'true' });
    return h('div', { class: 'legend', id: 'legend' },
      h('span', { class: 'key' }, swatch({ borderColor: 'var(--seal)' }), 'your hand'),
      h('span', { class: 'key' }, swatch({ borderColor: 'var(--ink-faint)' }), 'inked'),
      h('span', { class: 'key' }, swatch({ borderColor: 'var(--wet)' }), 'wet ink'),
      hs && hs.words.pasted ? h('span', { class: 'key', title: 'Pasted in from outside the studio. Inkwash can’t tell who wrote it, so it doesn’t count as your hand.' }, swatch(null, 'dotted'), 'pasted in') : null,
      h('label', { class: 'key' }, h('input', { type: 'checkbox', id: 'show-hand', checked: S.showHand, onchange: (e) => { S.showHand = e.target.checked; local.set('showHand', S.showHand); render(); } }), 'underline your hand'));
  }
  function fillStream(el, text) {
    clear(el);
    if (!text) { el.append(h('span', { class: 'thinking' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), 'Thinking. Claude reads the brief before it writes, which can take up to a minute.')); return; }
    el.append(text, h('span', { class: 'brush-cursor', 'aria-hidden': 'true' }));
  }

  // The editor: a transparent textarea over a backdrop that colors who wrote what.
  function editorView(key, p, ch) {
    const sealed = !!(p.setAt && !C.isWet(p));
    const wrap = h('div', { class: 'ink-editor' + (S.showHand ? ' show-hand' : '') + (sealed ? ' sealed' : '') });
    const back = h('div', { class: 'ink-backdrop', 'aria-hidden': 'true' });
    fillBackdrop(back, p);
    const ta = h('textarea', { id: 'passage-text', 'aria-label': `Text of scene ${p.scene + 1}`, spellcheck: 'true', readonly: S.readOnly || !!S.busy['repaint:' + key] });
    ta.value = p.text;
    ta.addEventListener('input', (ev) => onPassageInput(key, ta, back, ev.inputType));
    const sel = () => onSelect(key, ta);
    ta.addEventListener('select', sel);
    ta.addEventListener('keyup', sel);
    ta.addEventListener('mouseup', sel);
    ta.addEventListener('blur', () => commitEditLog(key));
    wrap.append(back, ta);
    if (p.setAt && !C.isWet(p)) {
      const w = world();
      const initial = ((w.byline || w.title || 'I').trim()[0] || 'I').toUpperCase();
      wrap.append(h('span', { class: 'seal-mark' + (S.flash === key ? ' stamp' : ''), 'aria-hidden': 'true', title: `Set ${when(p.setAt)}` }, initial));
    }
    requestAnimationFrame(() => grow(ta));
    return wrap;
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  function fillBackdrop(back, p) {
    clear(back);
    const text = p.text || '';
    const spans = C.normSpans(p.spans, text.length);
    const cuts = new Set([0, text.length]);
    for (const s of spans) { cuts.add(s.s); cuts.add(s.e); }
    const conflicts = (p.conflicts || []).filter((c) => c.start >= 0 && c.end <= text.length && c.end > c.start);
    for (const c of conflicts) { cuts.add(c.start); cuts.add(c.end); }
    const pts = [...cuts].sort((a, b) => a - b);
    let j = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b <= a) continue;
      while (j < spans.length && spans[j].e <= a) j++;
      const sp = spans[j] || { o: 'inked', wet: false };
      const cls = ['h-' + sp.o];
      if (sp.wet) cls.push('wet');
      if (conflicts.some((c) => c.start < b && c.end > a)) cls.push('h-conflict');
      back.append(h('span', { class: cls.join(' ') }, text.slice(a, b)));
    }
    back.append('\n​');
  }
  // How an edit came in, from the browser's input type: typed keys are the author's; a paste, a
  // drop or an undo brings text whose origin is traced (see C.traceInsert).
  const HOW = {
    insertFromPaste: 'paste', insertFromPasteAsQuotation: 'paste', insertFromDrop: 'paste', insertFromYank: 'paste',
    historyUndo: 'restore', historyRedo: 'restore',
  };
  function onPassageInput(key, ta, back, inputType) {
    const p = S.passages.get(key);
    if (!p) return;
    const ch = S.chapters.get(p.chapter);
    if (S.editBase[key] == null) { S.editBase[key] = p.text; S.editBefore[key] = C.clone(p); }
    const d = C.diffRange(p.text, ta.value);
    const how = HOW[inputType] || 'type';
    let next = C.editPassage(p, ta.value, pinsOf(ch, p.scene), now(), { how, sources: how === 'type' ? null : traceSources(key) });
    if (d.del) S.removed = C.rememberRemoved(S.removed, { text: d.del, at: d.at, spans: C.sliceSpans(p.spans, p.text.length, d.at, d.at + d.del.length), kind: inputType || 'delete', key });
    next = Object.assign({}, next, { conflicts: shiftConflicts(p.conflicts || [], d) });
    put('passages', key, next, { quiet: true });
    fillBackdrop(back, next);
    grow(ta);
    refreshSheetBits(key);
    clearTimeout(S.editTimers[key]);
    S.editTimers[key] = setTimeout(() => commitEditLog(key), 2500);
  }
  // Where pasted or restored words may have come from: text removed lately from any scene (newest
  // first), and every other scene of this world with the model's earlier words for it. The scene
  // being edited adds its own text and ink history itself.
  function traceSources(key) {
    const out = S.removed.slice().reverse();
    let total = out.reduce((n, x) => n + x.text.length, 0);
    for (const q of S.passages.values()) {
      if (q.id === key || !q.text) continue;
      if (total > 400000) break;
      out.push({ text: q.text, spans: q.spans });
      total += q.text.length;
      for (const t of q.inkSource || []) { out.push({ text: t, spans: [{ s: 0, e: t.length, o: 'inked', wet: true }] }); total += t.length; }
    }
    return out;
  }
  function shiftConflicts(list, d) {
    const delEnd = d.at + d.del.length, shift = d.ins.length - d.del.length;
    return list.flatMap((c) => {
      if (c.start < 0) return [c];
      if (c.end <= d.at) return [c];
      if (c.start >= delEnd) return [Object.assign({}, c, { start: c.start + shift, end: c.end + shift })];
      return [];
    });
  }
  // an editing session ends after a pause or on leaving the scene: one step to undo
  function commitEditLog(key) {
    clearTimeout(S.editTimers[key]);
    const base = S.editBase[key], before = S.editBefore[key];
    delete S.editBase[key]; delete S.editBefore[key];
    const p = S.passages.get(key);
    if (base == null || !p || base === p.text) return;
    put('passages', key, C.recordEdit(p, base, p.text, now()), { quiet: true });
    if (before) commitStep(`Edited ${sceneName(p.chapter, p.scene)}`, 'scene', [{ coll: 'passages', id: key, before, after: S.passages.get(key) }], { sceneEdits: 1 });
  }
  function sceneName(cid, k) { const i = chapterOrder().indexOf(cid); return i >= 0 ? `chapter ${i + 1}, scene ${k + 1}` : `scene ${k + 1}`; }
  function refreshSheetBits(key) {
    const p = S.passages.get(key);
    const ch = S.chapters.get(S.cid);
    if (!p || !ch || key !== C.passageId(S.cid, S.k)) return;
    const info = sceneInfo(S.cid, S.k);
    const pillEl = $('#scene-pill');
    if (pillEl) pillEl.replaceWith(pill(info.state, 'scene-pill'));
    const m = $('#scene-meter');
    const hs = C.handStats(p.text, p.spans);
    if (m) { clear(m); if (hs.total) m.append(meter(hs.hand)); }
    const lg = $('#legend');
    if (lg) lg.replaceWith(legendView(hs));
    const row = $('#set-row');
    if (row) { clear(row); row.append(setRow(key, p, ch)); }
  }
  function onSelect(key, ta) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const had = !!S.selection;
    S.selection = e - s >= 3 ? { key, s, e } : null;
    const slot = $('#selection-slot');
    if (slot && (had || S.selection)) { clear(slot); const p = S.passages.get(key); if (p) add(slot, selectionBar(key, p)); }
  }
  function selectionBar(key, p) {
    const busy = S.busy['repaint:' + key];
    if (busy) {
      const out = h('div', { class: 'ink-stream wet', id: 'stream-repaint-' + key });
      fillStream(out, busy.text);
      return h('div', { class: 'selection-bar' }, h('strong', null, 'Repainting the selected words'), out,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => busy.ctl.abort() }, 'Stop')));
    }
    const sel = S.selection;
    if (!sel || sel.key !== key || S.readOnly) return null;
    let { s, e } = sel;
    const raw = p.text.slice(s, e);
    const preview = raw.trim().length > 90 ? raw.trim().slice(0, 90) + '…' : raw.trim();
    const aiReady = !!S.sample && !S.aiOff;
    return h('div', { class: 'selection-bar' },
      h('strong', null, 'Repaint the selected words'),
      h('p', { class: 'muted' }, `“${preview}”`),
      aiReady ? h('form', {
        class: 'inline-form', onsubmit: (ev) => { ev.preventDefault(); repaintSelection(key, ev.target.querySelector('input').value); },
      }, h('input', { type: 'text', id: 'repaint-direction', 'data-keep': '', placeholder: 'How should it change? colder, shorter, she doesn’t trust him yet', 'aria-label': 'Direction for the repaint' }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Repaint'))
        : h('p', { class: 'faint' }, 'Repainting needs Claude, which is off in this view.'));
  }
  function setRow(key, p, ch) {
    const wet = C.isWet(p);
    const results = C.findPins(p.text, pinsOf(ch, p.scene));
    const missing = results.filter((r) => !r.found);
    const box = h('div', { class: 'section' });
    for (const m of missing) {
      box.append(h('div', { class: 'check-row' },
        h('span', { class: 'pill', 'data-state': 'stale' }, 'Pinned line missing'),
        h('span', { class: 'pin-text' }, m.text),
        S.readOnly ? null : h('button', { class: 'btn small', type: 'button', onclick: () => insertPin(key, m.text) }, 'Insert it')));
    }
    const open = C.openConflicts(p).length;
    if (!wet && p.setAt) {
      box.append(ledgerList(p, `Set ${when(p.setAt)}. The ledger recorded ${plural((p.premises || []).length, 'fact')} this scene relies on.`));
      if (open) box.append(h('p', { class: 'muted' }, 'A check found a contradiction since this scene was set. Resolve it above before you publish the chapter.'));
      return box;
    }
    const empty = !p.text.trim();
    const checking = !!S.busy['check:' + key];
    box.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn seal', type: 'button', id: 'set-button', disabled: S.readOnly || empty || missing.length > 0 || open > 0 || checking, onclick: () => setScene(key) }, 'Set with your seal'),
      h('span', { class: 'faint' }, empty ? 'Write something first.'
        : missing.length ? 'Every pinned line has to be in the scene, word for word.'
        : checking ? 'Wait for the check against the canon to finish.'
        : open ? 'Resolve the contradiction above first: change the words, or keep them if you meant them.'
        : wet ? 'Setting dries the ink. Only set scenes can be published.' : 'Setting marks this draft as done.')));
    return box;
  }
  // The facts a set scene relies on, so the author can see what a change to the canon will flag.
  function ledgerList(p, summary) {
    const facts = (p.premises || []).map((x) => idx().get(x.f)).filter(Boolean);
    return h('details', { class: 'ledger' }, h('summary', { class: 'muted' }, summary),
      facts.length
        ? h('ul', { class: 'list' }, facts.map(({ entity, fact }) => h('li', null, h('span', null, h('strong', null, (entity.kind === 'rule' ? 'Rule' : entity.name) + ': '), fact.text))))
        : h('p', { class: 'faint' }, 'None recorded. Check the scene against the canon to find the facts it relies on.'));
  }

  function suggestionsSection(key, p) {
    const busy = S.busy['check:' + key];
    const props = (p.proposals || []).filter((x) => x.status === 'new');
    const conflicts = p.conflicts || [];
    if (!busy && !props.length && !conflicts.length && !p.checkedAt) return null;
    const sec = h('section', { class: 'section', 'aria-label': 'Continuity and suggestions' }, h('h3', null, 'Continuity'));
    const open = C.openConflicts(p);
    if (busy) sec.append(h('p', { class: 'muted' }, 'Checking this scene against the canon…'));
    else if (p.checkedAt && !conflicts.length) sec.append(h('p', { class: 'muted' }, `Checked against the canon ${when(p.checkedAt)}: no contradictions found.`));
    else if (open.length) sec.append(h('p', { class: 'muted' }, `${open.length === 1 ? 'A contradiction' : `${open.length} contradictions`} with the canon. Change the words, or keep them if you meant them (a lie, a mistake the character makes, canon you’re about to change). The scene can’t be set until each one is resolved.`));
    conflicts.forEach((c, i) => {
      const hit = c.f ? idx().get(c.f) : null;
      const ref = c.id != null ? c.id : i;
      sec.append(h('div', { class: 'conflict' + (c.kept ? ' kept' : '') },
        h('span', null, c.start >= 0 ? `“${c.quote}”` : `“${c.quote}” (couldn’t find these exact words in the scene)`),
        hit ? h('span', { class: 'muted' }, `Canon: ${hit.fact.text}`) : null,
        c.why ? h('span', { class: 'faint' }, c.why) : null,
        S.readOnly ? null : h('div', { class: 'btn-row' }, c.kept
          ? [h('span', { class: 'faint' }, `Kept as written ${when(c.kept)}.`), h('button', { class: 'btn ghost small', type: 'button', onclick: () => keepConflict(key, ref, false) }, 'Undo')]
          : [h('button', { class: 'btn small', type: 'button', onclick: () => keepConflict(key, ref, true) }, 'Keep it as written')])));
    });
    if (props.length) {
      sec.append(h('h3', null, 'Suggested canon'));
      sec.append(h('p', { class: 'faint' }, 'Facts the ink introduced. Keep the ones that are true in your world; nothing becomes canon until you do.'));
      for (const pr of props) {
        const kindSel = h('select', { 'aria-label': 'Kind', id: 'kind-' + pr.id }, C.KINDS.map((kd) => h('option', { value: kd, selected: kd === guessKind(pr.about) }, kd)));
        sec.append(h('div', { class: 'proposal' },
          h('span', null, h('span', { class: 'about' }, (pr.about || 'The world') + ': '), pr.text),
          h('div', { class: 'btn-row' }, kindSel,
            h('button', { class: 'btn small', type: 'button', disabled: S.readOnly, onclick: () => keepProposal(key, pr.id, kindSel.value) }, 'Keep'),
            h('button', { class: 'btn ghost small', type: 'button', disabled: S.readOnly, onclick: () => dismissProposal(key, pr.id) }, 'Dismiss'))));
      }
    }
    return sec;
  }

  function designSection(ch, k) {
    const sec = h('details', { class: 'section', open: !S.passages.has(C.passageId(S.cid, k)) });
    sec.append(h('summary', null, h('strong', null, 'Scene design: who is in it, pinned lines, notes')));
    const castIds = (ch.cast || []).filter((id) => S.canon.has(id));
    const present = new Set(C.castIn(ch, k).map((c) => c.id));
    const castBox = h('div', { class: 'section' }, h('h3', null, 'Who is in this scene'));
    if (castIds.length) {
      castBox.append(h('div', { class: 'cast-list' }, castIds.map((id) => h('label', null,
        h('input', {
          type: 'checkbox', checked: present.has(id), disabled: S.readOnly,
          onchange: (e) => { const c = C.clone(S.chapters.get(S.cid)); C.setPresence(c.threads[id] = c.threads[id] || new Array(N).fill(0), c.scenes, S.k, e.target.checked); put('chapters', S.cid, c); },
        }), S.canon.get(id).name,
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${S.canon.get(id).name} from this chapter`, disabled: S.readOnly, onclick: (e) => { e.preventDefault(); removeFromCast(id); } }, '×')))));
    } else castBox.append(h('p', { class: 'faint' }, entities().some((e) => e.kind === 'character') ? 'Add characters to this chapter with the menu above the score.' : 'Add characters in the Canon view first.'));
    sec.append(castBox);

    const pins = pinsOf(ch, k);
    const pinBox = h('div', { class: 'section' }, h('h3', null, 'Pinned lines'),
      h('p', { class: 'faint' }, 'Your own sentences. They appear in the scene word for word, and the ink writes around them.'));
    if (pins.length) pinBox.append(h('ul', { class: 'list' }, pins.map((p) => h('li', null, h('span', { class: 'pin-text' }, p.text),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Remove pinned line', disabled: S.readOnly, onclick: () => editChapterList('pins', (l) => l.filter((x) => x.id !== p.id)) }, '×')))));
    pinBox.append(h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) editChapterList('pins', (l) => l.concat([{ id: C.uid('pin'), scene: S.k, text: v }])); } },
      h('input', { type: 'text', id: 'pin-new', placeholder: 'A line of yours this scene must contain', 'aria-label': 'New pinned line', disabled: S.readOnly }),
      h('button', { class: 'btn', type: 'submit', disabled: S.readOnly }, 'Pin it')));
    sec.append(pinBox);

    const notes = notesOf(ch, k);
    const noteBox = h('div', { class: 'section' }, h('h3', null, 'Notes'),
      h('p', { class: 'faint' }, 'Directions for this scene. The ink follows them; they never appear in the text.'));
    if (notes.length) noteBox.append(h('ul', { class: 'list' }, notes.map((n) => h('li', null, h('span', { class: 'note-text' }, n.text),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Remove note', disabled: S.readOnly, onclick: () => editChapterList('notes', (l) => l.filter((x) => x.id !== n.id)) }, '×')))));
    noteBox.append(h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) editChapterList('notes', (l) => l.concat([{ id: C.uid('n'), scene: S.k, text: v }])); } },
      h('input', { type: 'text', id: 'note-new', placeholder: 'she doesn’t trust him yet', 'aria-label': 'New note', disabled: S.readOnly }),
      h('button', { class: 'btn', type: 'submit', disabled: S.readOnly }, 'Add note')));
    sec.append(noteBox);
    return sec;
  }
  function editChapterList(field, fn) {
    const ch = S.chapters.get(S.cid);
    put('chapters', S.cid, Object.assign({}, ch, { [field]: fn((ch[field] || []).slice()) }));
    requestAnimationFrame(() => { const el = document.getElementById(field === 'pins' ? 'pin-new' : 'note-new'); if (el) { el.value = ''; el.focus(); } });
  }
  function guessKind(name) {
    const n = String(name || '');
    if (/\b(city|town|sea|river|forest|wood|mountain|garden|gardens|tower|street|harbou?r|isle|island|valley|village|castle|palace|road|gate|hall|market|stairs|cliff)\b/i.test(n)) return 'place';
    if (/\b(guild|order|house|clan|court|council|church|army|crew|company|circle)\b/i.test(n)) return 'faction';
    if (/^[A-Z][\p{L}'-]+$/u.test(n.trim())) return 'character';
    return 'thing';
  }

  // ---------------------------------------------------------------- plates
  // An ink painting for a scene, a place or a character. Claude composes it (what is in the
  // picture and roughly where) and InkPlates paints it, so the same composition always paints the
  // same picture and nothing from the model reaches the page as markup.

  const aiOn = () => !!S.sample && !S.aiOff && !S.readOnly;
  const plateCache = new Map();
  function plateFigure(spec, id, opts) {
    const key = id + '|' + JSON.stringify(spec);
    if (!plateCache.has(key)) { if (plateCache.size > 60) plateCache.clear(); plateCache.set(key, PL.paint(spec, { id })); }
    const art = h('div', { class: 'plate-art' });
    art.innerHTML = plateCache.get(key);
    return h('figure', { class: 'plate' + (opts && opts.small ? ' small' : '') }, art,
      opts && opts.caption === false ? null : h('figcaption', null, spec.title || ''));
  }
  // `figure: false` when the page already shows the plate at its head
  function plateSection(target, opts) {
    const pl = S.plates.get(target.id), busy = S.busy['plate:' + target.id];
    const what = target.kind === 'scene' ? 'this scene' : target.kind === 'character' ? 'this character' : 'this place';
    const sec = h('section', { class: 'section plate-section', 'aria-label': 'Plate' });
    if (busy) sec.append(h('div', { class: 'plate-wait' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), `Composing a plate for ${what}…`));
    else if (pl) { if (!opts || opts.figure !== false) sec.append(plateFigure(pl.spec, target.id, { small: target.kind !== 'scene' })); }
    else sec.append(h('p', { class: 'faint' }, target.kind === 'scene'
      ? 'An ink painting of this scene. Claude composes it from the scene and your canon, and Inkwash paints it.'
      : `An ink painting of ${what}, composed by Claude from its facts.`));
    const row = h('div', { class: 'btn-row' });
    if (aiOn() && !busy) row.append(h('button', { class: 'btn small', type: 'button', onclick: () => paintPlate(target) }, pl ? 'Paint it again' : target.kind === 'scene' ? 'Paint a plate for this scene' : 'Paint a plate'));
    if (busy) row.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => busy.ctl.abort() }, 'Stop'));
    if (pl && !busy && !S.readOnly) row.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => { removeDoc('plates', target.id); render(); } }, 'Remove plate'));
    if (row.childNodes.length) sec.append(row);
    return sec;
  }
  function plateInput(target) {
    const w = world();
    if (target.kind === 'scene') {
      const ch = S.chapters.get(target.cid);
      if (!ch) return null;
      const p = S.passages.get(C.passageId(target.cid, target.k));
      const facts = C.sceneFacts({ world: w, entities: S.canon, chapter: ch, chapterId: target.cid, k: target.k, extraText: p ? p.text : '' });
      const [i0, i1] = C.sceneRange(ch.scenes, target.k);
      const mix = C.moodMix(ch.mood, w.pigments, i0, i1);
      return {
        world: w, subject: 'scene', name: `${ch.title}, scene ${target.k + 1}`,
        facts: facts.canon.concat(facts.reveals).slice(0, 40).map(({ e, f }) => `${e.kind === 'rule' ? 'World rule' : e.name}: ${f.text}`),
        text: p ? p.text : '', notes: notesOf(ch, target.k).map((n) => n.text).concat(pinsOf(ch, target.k).map((x) => x.text)),
        pigments: mix.length ? mix : (w.pigments || []).slice(0, 5),
      };
    }
    const e = S.canon.get(target.eid);
    if (!e) return null;
    return {
      world: w, subject: e.kind === 'character' ? 'character' : 'place', name: e.name,
      facts: (e.facts || []).filter((f) => !f.retired && !f.secret).map((f) => f.text), pigments: (w.pigments || []).slice(0, 5),
    };
  }
  async function paintPlate(target) {
    if (!aiOn() || S.busy['plate:' + target.id]) return;
    const input = plateInput(target);
    if (!input) return;
    const busy = { ctl: new AbortController() };
    S.busy['plate:' + target.id] = busy;
    render();
    try {
      const json = await S.sample.json(PL.buildPlatePrompt(input), { modelTier: 'default', signal: busy.ctl.signal });
      const spec = PL.parsePlate(json, 1 + Math.floor(Math.random() * 2147483646));
      if (!spec) throw { code: 'invalid_json' };
      put('plates', target.id, { for: target.kind, chapter: target.cid || null, scene: target.k == null ? null : target.k, entity: target.eid || null, spec, paintedAt: now() }, { quiet: true });
    } catch (e) { aiError(e, 'painting the plate'); }
    finally { delete S.busy['plate:' + target.id]; render(); }
  }

  // ---------------------------------------------------------------- scene actions

  function aiError(e, what) {
    const code = e && e.code;
    if (code === 'cancelled') return;
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
      S.aiOff = code === 'not_granted'
        ? 'You chose not to let this page use Claude, so inking is off for this visit. You can still paint, write scenes yourself and set them.'
        : 'Claude isn’t available in this view, so inking is off. You can still paint, write scenes yourself and set them.';
      render();
      return;
    }
    const msg = {
      rate_limited: 'Claude is busy, or your usage limit has been reached. Try again in a little while.',
      session_expired: 'Your claude.ai session expired. Sign in again, then try again.',
      refused: 'Claude declined to write this. Try changing the notes or the pinned lines.',
      prompt_too_large: 'The brief is too long. Shorten the voice sample or the notes.',
      empty_completion: 'Claude returned nothing. Try again, or ask for a shorter scene.',
      invalid_json: 'Claude’s answer couldn’t be read. Try again.',
      upstream_error: 'The connection dropped. Anything already written was kept. Try again.',
    }[code] || `Something went wrong while ${what} (${(e && (e.message || code)) || 'unknown error'}).`;
    toast(msg, 'error');
  }

  async function inkScene(cid, k, confirmed) {
    if (!S.sample || S.aiOff || S.readOnly) return;
    const key = C.passageId(cid, k);
    if (S.busy['ink:' + key]) return;
    const prev = S.passages.get(key);
    if (prev && !confirmed) {
      const hs = C.handStats(prev.text, prev.spans);
      if (hs.words.typed + hs.words.pinned > 0 && (hs.words.typed > 0)) { S.confirmReink = key; render(); return; }
    }
    commitEditLog(key);
    const brief = briefFor(cid, k);
    const busy = { ctl: new AbortController(), text: '' };
    S.busy['ink:' + key] = busy;
    S.selection = null;
    render();
    let raw = '';
    try {
      const res = await S.sample(brief.prompt, {
        modelTier: 'complex', signal: busy.ctl.signal, cache: false,
        onText: ({ text }) => { raw = text; busy.text = C.streamingProse(text); const el = document.getElementById('stream-' + key); if (el) fillStream(el, busy.text); },
      });
      raw = res.text;
      delete S.busy['ink:' + key];
      if (finishInk(cid, k, raw, brief, prev) && res.truncated) toast('The scene was cut off at the length limit. Finish it by hand, or lower the words per scene and ink it again.', 'warn');
    } catch (e) {
      delete S.busy['ink:' + key];
      if (e && e.code === 'cancelled' && e.text && C.streamingProse(e.text).trim()) {
        finishInk(cid, k, e.text, brief, prev, true);
        toast('Stopped. What was written so far is kept as wet ink.');
      } else if (e && e.code === 'upstream_error' && e.text && C.streamingProse(e.text).trim()) {
        finishInk(cid, k, e.text, brief, prev, true);
        aiError(e, 'inking');
      } else aiError(e, 'inking');
      render();
    }
  }
  function finishInk(cid, k, raw, brief, prev, partial) {
    const out = C.parseInkOutput(raw, brief.factMap);
    if (!out.prose.trim()) { toast('Claude didn’t return any prose. Try again.', 'error'); render(); return false; }
    const listed = out.ledger ? out.used : C.guessUsed(out.prose, brief.factMap, S.canon);
    const used = C.mergePremises(C.relies(out.prose, C.briefItems(brief.factMap, idx())), listed);
    const passage = C.inkedPassage({ chapterId: cid, k, prose: out.prose, used, fresh: partial ? [] : out.fresh, pins: brief.pins, now: now(), prev });
    const rec = record(`Inked ${sceneName(cid, k)}`, 'scene', { inked: 1 });
    put('passages', passage.id, passage);
    rec.done();
    if (!partial) runContinuity(passage.id);
    return true;
  }

  async function runContinuity(key) {
    if (!S.sample || S.aiOff) return;
    const p = S.passages.get(key);
    if (!p || !p.text.trim() || S.busy['check:' + key]) return;
    const ch = S.chapters.get(p.chapter);
    if (!ch) return;
    const facts = C.sceneFacts({ world: world(), entities: S.canon, chapter: ch, chapterId: p.chapter, k: p.scene, extraText: p.text });
    const items = facts.canon.concat(facts.secrets, facts.reveals);
    if (!items.length) { put('passages', key, Object.assign({}, p, { conflicts: [], checkedAt: now() })); return; }
    const { prompt, factMap } = C.buildContinuityPrompt({ world: world(), text: p.text, items });
    const busy = { ctl: new AbortController() };
    S.busy['check:' + key] = busy;
    render();
    try {
      const json = await S.sample.json(prompt, { modelTier: 'default', signal: busy.ctl.signal });
      const cur = S.passages.get(key);
      if (cur) {
        const found = C.parseRelies(json, factMap);
        const ledger = cur.setAt && !C.isWet(cur) ? { premises: C.mergePremises(found, cur.premises) } : { pending: C.mergePremises(found, cur.pending) };
        put('passages', key, Object.assign({}, cur, ledger, { conflicts: C.mergeConflicts(cur.conflicts, C.parseContinuity(json, cur.text, factMap)), checkedAt: now() }));
      }
    } catch (e) { aiError(e, 'checking continuity'); }
    finally { delete S.busy['check:' + key]; render(); }
  }

  async function repaintSelection(key, direction) {
    const sel = S.selection;
    const p = S.passages.get(key);
    if (!sel || !p || !S.sample || S.aiOff || S.busy['repaint:' + key]) return;
    let s = sel.s, e = sel.e;
    while (s < e && /\s/.test(p.text[s])) s++;
    while (e > s && /\s/.test(p.text[e - 1])) e--;
    if (e - s < 2) return;
    if (C.normSpans(p.spans, p.text.length).some((x) => x.o === 'pinned' && x.s < e && x.e > s)) {
      toast('The selection includes one of your pinned lines. Pinned lines are never repainted; select around it.', 'warn');
      return;
    }
    commitEditLog(key);
    const brief = briefFor(p.chapter, p.scene);
    const { prompt, factMap } = C.buildRepaintPrompt({ brief, text: p.text, s, e, direction });
    const startText = p.text;
    const busy = { ctl: new AbortController(), text: '' };
    S.busy['repaint:' + key] = busy;
    render();
    try {
      const res = await S.sample(prompt, {
        modelTier: 'default', signal: busy.ctl.signal, cache: false,
        onText: ({ text }) => { busy.text = C.streamingProse(text); const el = document.getElementById('stream-repaint-' + key); if (el) fillStream(el, busy.text); },
      });
      const out = C.parseRepaint(res.text, factMap);
      const cur = S.passages.get(key);
      if (!cur || cur.text !== startText) toast('The scene changed while it was being repainted, so the repaint was not applied. Try again.', 'warn');
      else if (!out.prose) toast('Claude returned nothing for the repaint. Try again.', 'error');
      else {
        const ch = S.chapters.get(cur.chapter);
        const listed = out.ledger ? out.used : C.guessUsed(out.prose, factMap, S.canon);
        const used = C.mergePremises(C.relies(out.prose, C.briefItems(factMap, idx())), listed);
        const next = C.repaintPassage(cur, s, e, out.prose, used, out.fresh, pinsOf(ch, cur.scene), now());
        S.selection = null;
        const rec = record(`Repainted part of ${sceneName(cur.chapter, cur.scene)}`, 'scene');
        put('passages', key, next);
        toast('Repainted. The new words are wet until you set the scene.', null, undoAction(rec.done()));
      }
    } catch (err) { aiError(err, 'repainting'); }
    finally { delete S.busy['repaint:' + key]; render(); }
  }

  function writeByHand(key, k) {
    put('passages', key, C.handPassage({ chapterId: S.cid, k, now: now() }));
    requestAnimationFrame(() => { const ta = $('#passage-text'); if (ta) ta.focus(); });
  }
  function insertPin(key, text) {
    const p = S.passages.get(key);
    if (!p) return;
    const ta = $('#passage-text');
    let at = ta && document.activeElement === ta ? ta.selectionEnd : p.text.length;
    let ins = text;
    if (at === p.text.length && p.text && !/\s$/.test(p.text)) ins = (p.text.endsWith('\n') ? '' : '\n\n') + text;
    if (at === p.text.length && p.text.endsWith('\n') && !p.text.endsWith('\n\n')) ins = '\n' + text;
    const r = C.splice(p.text, p.spans, at, at, ins, { o: 'pinned', wet: false });
    put('passages', key, Object.assign({}, p, { text: r.text, spans: r.spans }));
  }
  function setScene(key) {
    commitEditLog(key);
    const p = S.passages.get(key);
    const ch = p && S.chapters.get(p.chapter);
    if (!p || !ch) return;
    if (S.busy['check:' + key]) { toast('Wait for the check against the canon to finish.', 'warn'); return; }
    const facts = C.sceneFacts({ world: world(), entities: S.canon, chapter: ch, chapterId: p.chapter, k: p.scene, extraText: p.text });
    const r = C.setPassage(p, pinsOf(ch, p.scene), now(), C.relies(p.text, facts.canon.concat(facts.secrets, facts.reveals)));
    if (!r.ok) {
      toast(r.reason === 'pins' ? 'A pinned line is missing from the scene. Insert it before setting.'
        : r.reason === 'conflicts' ? 'The scene contradicts the canon. Change the words, or keep them if you meant them, before setting.'
        : 'There is nothing to set yet.', 'warn');
      return;
    }
    S.flash = key;
    const rec = record(`Set ${sceneName(p.chapter, p.scene)}`, 'scene', { scenesSet: 1 });
    put('passages', key, r.passage);
    const step = rec.done();
    setTimeout(() => { S.flash = null; }, 700);
    toast(`Set. The ledger recorded ${plural(r.passage.premises.length, 'fact')} this scene relies on.`, null, undoAction(step));
  }
  function keepConflict(key, ref, keep) {
    const p = S.passages.get(key);
    if (!p) return;
    const rec = record(keep ? `Kept a contradiction in ${sceneName(p.chapter, p.scene)}` : `Took back a kept contradiction in ${sceneName(p.chapter, p.scene)}`, 'scene');
    put('passages', key, C.keepConflict(p, ref, now(), keep));
    rec.done();
  }
  function markStillTrue(key) {
    const p = S.passages.get(key);
    if (!p) return;
    const rec = record(`Marked ${sceneName(p.chapter, p.scene)} still true`, 'scene');
    put('passages', key, C.stillTrue(p, idx(), now()));
    toast('Marked still true. The ledger now records the current wording.', null, undoAction(rec.done()));
  }
  async function clearScene(key) {
    const ok = await ask({ title: 'Clear this scene?', body: 'Its text is deleted. The painting, pinned lines and notes stay. You can undo it from History.', confirm: 'Clear scene', danger: true });
    if (!ok) return;
    const p = S.passages.get(key);
    const rec = record(p ? `Cleared ${sceneName(p.chapter, p.scene)}` : 'Cleared a scene', 'scene');
    removeDoc('passages', key);
    toast('Scene cleared.', null, undoAction(rec.done()));
    render();
  }
  function keepProposal(key, propId, kind) {
    const p = S.passages.get(key);
    const pr = p && (p.proposals || []).find((x) => x.id === propId);
    if (!pr) return;
    const rec = record(`Kept a suggested fact about ${pr.about || 'the world'}`, 'keep', { kept: 1 });
    const r = addFactTo(pr.about || 'The world', pr.text, kind);
    put('passages', key, Object.assign({}, p, { proposals: p.proposals.map((x) => (x.id === propId ? Object.assign({}, x, { status: 'kept' }) : x)) }));
    keptToast(r, rec.done());
  }
  function dismissProposal(key, propId) {
    const p = S.passages.get(key);
    if (!p) return;
    put('passages', key, Object.assign({}, p, { proposals: p.proposals.map((x) => (x.id === propId ? Object.assign({}, x, { status: 'dismissed' }) : x)) }));
  }
  function addFactTo(name, text, kind) {
    const found = entities().find((e) => e.name.toLowerCase() === String(name).trim().toLowerCase());
    const e = found ? C.clone(found) : C.newEntity(kind, name, now());
    e.facts.push(C.newFact(text, 'accepted', now()));
    put('canon', e.id, e);
    return { name: e.name, found: !!found };
  }
  function keptToast(r, step) { toast(r.found ? `Kept: added to ${r.name}.` : `Kept: ${r.name} is new in your canon.`, null, undoAction(step)); }

  // ---------------------------------------------------------------- book view

  function proseView(text, spans, opts) {
    const frag = document.createDocumentFragment();
    const ns = C.normSpans(spans || [], text.length);
    const paras = [[]];
    for (const sp of ns) {
      const chunk = text.slice(sp.s, sp.e);
      const cls = ['h-' + sp.o];
      if (opts && opts.wet && sp.wet) cls.push('wet');
      for (const part of chunk.split(/(\n+)/)) {
        if (/^\n+$/.test(part)) { paras.push([]); continue; }
        if (part) paras[paras.length - 1].push([part, cls.join(' ')]);
      }
    }
    for (const para of paras) {
      if (!para.some(([t]) => t.trim())) continue;
      frag.append(h('p', null, para.map(([t, c]) => h('span', { class: c }, t))));
    }
    return frag;
  }

  function bookView() {
    const w = world();
    const order = chapterOrder();
    const toc = h('nav', { class: 'toc', 'aria-label': 'Book' },
      h('p', { class: 'eyebrow' }, 'Contents'),
      h('ol', { class: 'toc-list' }, order.map((cid, i) => h('li', null, h('a', { href: '#ch-' + cid, onclick: (e) => { e.preventDefault(); const el = document.getElementById('ch-' + cid); if (el) el.scrollIntoView({ behavior: 'smooth' }); } }, `${i + 1}. ${S.chapters.get(cid).title}`)))),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', id: 'book-hand', checked: S.showHand, onchange: (e) => { S.showHand = e.target.checked; local.set('showHand', S.showHand); render(); } }), 'Underline my hand'),
      TRIAL ? null : h('div', null, h('button', { class: 'btn small', type: 'button', onclick: () => { S.preview = true; render(); window.scrollTo(0, 0); } }, 'Read it as a reader')),
      exportsPanel());
    const page = h('article', { class: 'book-page' + (S.showHand ? ' show-hand' : '') },
      h('h1', { class: 'title' }, w.title),
      w.byline ? h('p', { class: 'byline' }, `by ${w.byline}`) : null,
      w.premise ? h('p', { class: 'premise' }, w.premise) : null);
    order.forEach((cid, i) => page.append(bookChapter(cid, i)));
    const stats = worldStats();
    page.append(h('p', { class: 'made' }, stats && stats.total ? `${stats.total} words in set scenes, ${pct(stats.hand)} in your own hand.` : 'Set scenes appear here as a book.'));
    return h('div', { class: 'book-view' }, toc, page);
  }
  function bookChapter(cid, i) {
    const ch = S.chapters.get(cid);
    const pubc = S.pub.get(cid);
    const changed = pubc && [...S.passages.values()].some((p) => p.chapter === cid && (p.updatedAt || 0) > (pubc.publishedAt || 0));
    const sec = h('section', { class: 'chapter', id: 'ch-' + cid });
    sec.append(h('div', { class: 'chapter-head' },
      h('h2', null, `Chapter ${i + 1}: ${ch.title}`),
      pubc ? h('span', { class: 'pill', 'data-state': changed ? 'stale' : 'set' }, changed ? 'Changed since published' : `Published ${when(pubc.publishedAt)}`) : null,
      S.readOnly || TRIAL ? null : h('button', { class: 'btn small', type: 'button', onclick: () => publishChapter(cid) }, pubc ? 'Publish again' : 'Publish chapter'),
      pubc && !S.readOnly && !TRIAL ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => unpublishChapter(cid) }, 'Unpublish') : null));
    if (S.publishTried[cid]) {
      const r = C.chapterProblems({ chapter: ch, chapterId: cid, passages: S.passages, idx: idx(), strict: !!world().strict, entities: S.canon });
      const blocking = r.problems.filter((x) => x.block);
      if (blocking.length) {
        const say = { wet: 'is still wet: set it first', stale: 'is stale: review it', conflict: 'contradicts the canon: resolve it', pins: 'is missing a pinned line', unset: 'is a draft: set it first', nothing: '' };
        sec.append(h('ul', { class: 'problems' }, blocking.map((x) => h('li', null, x.kind === 'nothing' ? 'No scene in this chapter has text yet.' : `Scene ${x.k + 1} ${say[x.kind]}.`))));
      }
    }
    for (let k = 0; k < ch.scenes; k++) {
      const info = sceneInfo(cid, k);
      const p = info.p;
      const open = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.cid = cid; S.k = k; savePos(); go('score'); } }, 'Open in the score');
      const block = h('div', { class: 'scene-block', 'data-state': info.state });
      if (k > 0) sec.append(h('p', { class: 'scene-break', 'aria-hidden': 'true' }, '* * *'));
      if (info.state === 'empty') { block.append(h('div', { class: 'scene-label' }, `Scene ${k + 1} isn’t written yet.`, open)); sec.append(block); continue; }
      if (info.state !== 'set') {
        const label = info.state === 'wet' ? 'Wet ink, not set yet.' : info.state === 'draft' ? 'A draft, not set yet.' : `Stale: ${info.reasons.map((r) => r.after ? `${r.entity}: ${r.after}` : `${r.entity || 'a fact'} changed`).join('; ')}`;
        block.append(h('div', { class: 'scene-label' }, pill(info.state), label, open));
      }
      const pl = S.plates.get(PL.plateId.scene(cid, k));
      if (pl) block.append(plateFigure(pl.spec, PL.plateId.scene(cid, k)));
      block.append(h('div', { class: 'prose' }, proseView(p.text, p.spans, { wet: true })));
      sec.append(block);
    }
    return sec;
  }

  function publishChapter(cid) {
    if (TRIAL) return;
    const ch = S.chapters.get(cid);
    const r = C.chapterProblems({ chapter: ch, chapterId: cid, passages: S.passages, idx: idx(), strict: !!world().strict, entities: S.canon });
    if (!r.ok) {
      S.publishTried[cid] = true;
      render();
      toast('This chapter can’t be published yet. The scenes that need attention are listed under its title.', 'warn');
      return;
    }
    S.publishTried[cid] = false;
    const pc = C.publishedChapter({ world: world(), chapter: ch, chapterId: cid, passages: S.passages, plates: S.plates, now: now() });
    put('pub', cid, pc, { quiet: true, keepTime: true });
    writePubWorld();
    toast(`Published ${ch.title}. Anyone you share this page with can read it while signed in to claude.ai.`);
    render();
  }
  function unpublishChapter(cid) {
    removeDoc('pub', cid);
    writePubWorld();
    toast('Unpublished. Readers no longer see this chapter.');
    render();
  }
  function writePubWorld() {
    const path = P.pubWorld(S.wid);
    if (!S.pub.size) { S.pubWorlds.delete(S.wid); queueDelete(path); return; }
    const pw = Object.assign(C.publishedWorld({ world: world(), entities: S.canon, publishedChapters: S.pub, plates: S.plates, now: now() }), { id: S.wid });
    S.pubWorlds.set(S.wid, pw);
    queueWrite(path, pw);
  }

  function exportsPanel() {
    const can = !!S.downloads || !window.claude;
    const panel = h('div', { class: 'exports' }, h('p', { class: 'eyebrow' }, 'Download'));
    if (!can) { panel.append(h('p', { class: 'faint' }, 'Downloads aren’t available in this view.')); return panel; }
    const w = world();
    const base = slug(w.title);
    const all = () => ({ world: w, entities: S.canon, chapters: S.chapters, passages: S.passages, seeds: S.seeds, plates: S.plates, atlas: atlasDoc(), sources: S.sources });
    const book = (filename, make) => async () => {
      const model = C.bookModel({ world: w, chapters: S.chapters, passages: S.passages, entities: S.canon, plates: S.plates });
      if (model.problems.length) {
        const say = { stale: 'is stale: a fact it relies on changed', conflict: 'contradicts the canon' };
        const ok = await ask({
          title: 'Some set scenes need attention',
          body: h('div', null,
            h('ul', { class: 'problems' }, model.problems.map((x) => h('li', null, `Chapter ${x.order + 1}, scene ${x.k + 1} ${say[x.kind]}.`))),
            h('p', { class: 'muted' }, 'You can review them first, or export the book as it stands.')),
          confirm: 'Export anyway',
        });
        if (!ok) return;
      }
      saveFile(filename, make(model));
    };
    panel.append(
      h('p', { class: 'faint' }, 'The book includes set scenes only.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: book(`${base}.epub`, (m) => C.exportEpub(m, now(), { paint: PL.paint })) }, 'EPUB'),
        h('button', { class: 'btn small', type: 'button', onclick: book(`${base}.html`, (m) => C.exportHtml(m, { paint: PL.paint })) }, 'HTML'),
        h('button', { class: 'btn small', type: 'button', onclick: book(`${base}.md`, (m) => C.exportMarkdown(m)) }, 'Markdown')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(`${base}-bible.json`, JSON.stringify(C.exportBible(all(), now()), null, 2)) }, 'The bible (JSON)')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(`${base}-provenance.md`, C.exportProvenance(all(), now()).md) }, 'Who wrote what (Markdown)'),
        h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(`${base}-provenance.json`, JSON.stringify(C.exportProvenance(all(), now()).json, null, 2)) }, 'JSON')),
      h('p', { class: 'eyebrow' }, 'Back up'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(`${base}-backup.json`, JSON.stringify(C.exportBackup(all(), now()))) }, 'Back up this world'),
        h('label', { class: 'btn small' }, 'Restore a backup', h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', onchange: (e) => restoreFrom(e.target) }))));
    return panel;
  }
  async function saveFile(filename, data) {
    if (S.downloads) {
      try {
        const r = await S.downloads.save({ filename, data });
        if (r && r.status === 'saved') toast(`Saved ${filename}.`);
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return;
        if (code === 'rate_limited') toast('A save is already waiting for your answer.', 'warn');
        else if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed', 'extension_not_enabled'].includes(code)) { toast('That download isn’t available in this view.', 'warn'); }
        else toast(`Couldn’t save ${filename} (${(e && (e.message || code)) || 'unknown error'}).`, 'error');
      }
      return;
    }
    if (!window.claude) {
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const a = h('a', { href: URL.createObjectURL(blob), download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return;
    }
    toast('Downloads aren’t available in this view.', 'warn');
  }
  function restoreFrom(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(String(reader.result)); } catch (e) { toast('That file isn’t valid JSON.', 'error'); return; }
      importWorld(data, true);
    };
    reader.onerror = () => toast('Couldn’t read that file.', 'error');
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- reader view

  function readerView(pubWorld, chaptersMap, preview) {
    const wrap = h('div', null);
    if (preview) wrap.append(h('div', { class: 'banner' }, h('strong', null, 'Reader preview.'), 'This is what people you share the page with see.', h('button', { class: 'btn small', type: 'button', onclick: () => { S.preview = false; render(); } }, 'Back to the studio')));
    if (!pubWorld) {
      wrap.append(h('section', { class: 'welcome' },
        h('p', { class: 'eyebrow' }, 'Inkwash'),
        h('h1', null, S.mode === 'reader' && !S.db ? 'Sign in to claude.ai to read this book.' : 'Nothing has been published here yet.'),
        h('p', { class: 'muted' }, S.mode === 'reader' && !S.db ? 'Published chapters load for signed-in readers. You can also ask the author for the EPUB or HTML edition.' : 'When the author publishes a chapter, it appears here.')));
      return wrap;
    }
    const chapters = [...chaptersMap.values()].sort((a, b) => a.order - b.order);
    const pos = C.clamp(S.reader.pos, 0, Math.max(0, chapters.length - 1));
    const cur = chapters[pos];
    const toc = h('nav', { class: 'toc', 'aria-label': 'Chapters' },
      h('p', { class: 'eyebrow' }, 'Chapters'),
      h('ol', { class: 'toc-list' }, chapters.map((c, i) => h('li', null, h('a', { href: '#read', 'aria-current': i === pos ? 'true' : null, onclick: (e) => { e.preventDefault(); S.reader.pos = i; render(); window.scrollTo(0, 0); } }, `${c.order + 1}. ${c.title}`)))));
    const article = h('article', { class: 'book-page', id: 'read' },
      h('h1', { class: 'title' }, pubWorld.title),
      pubWorld.byline ? h('p', { class: 'byline' }, `by ${pubWorld.byline}`) : null,
      pubWorld.premise && pos === 0 ? h('p', { class: 'premise' }, pubWorld.premise) : null);
    if (cur) {
      const sec = h('section', { class: 'chapter' }, h('div', { class: 'chapter-head' }, h('h2', null, `Chapter ${cur.order + 1}: ${cur.title}`)));
      cur.scenes.forEach((text, i) => {
        if (i) sec.append(h('p', { class: 'scene-break', 'aria-hidden': 'true' }, '* * *'));
        const spec = cur.plates && cur.plates[i];
        if (spec) sec.append(plateFigure(PL.normalizePlate(spec, 1), `r_${cur.id}_${i}`));
        sec.append(h('div', { class: 'prose' }, C.paragraphs(text).map((t) => h('p', null, t))));
      });
      const nav = h('div', { class: 'btn-row', style: { marginTop: '2rem' } },
        pos > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { S.reader.pos = pos - 1; render(); window.scrollTo(0, 0); } }, 'Previous chapter') : null,
        pos < chapters.length - 1 ? h('button', { class: 'btn primary', type: 'button', onclick: () => { S.reader.pos = pos + 1; render(); window.scrollTo(0, 0); } }, 'Next chapter') : null);
      sec.append(nav);
      article.append(sec);
    } else article.append(h('p', { class: 'muted', style: { marginTop: '2rem' } }, 'No chapters are published yet.'));
    article.append(h('p', { class: 'made' }, pubWorld.words
      ? `How this book was made: in Inkwash, the author wrote ${pct(pubWorld.hand)} of the words by hand. The rest was inked by Claude from the author’s design, or pasted in from elsewhere, and the author kept or edited every line before setting it.`
      : 'Made with Inkwash.'));
    const lore = C.visibleLore(pubWorld, cur ? cur.order : 0);
    const aside = h('aside', { class: 'lore', 'aria-label': 'What you know so far' },
      h('h3', null, 'What you know so far'),
      h('p', { class: 'faint' }, 'Only what this chapter and earlier ones have shown.'),
      lore.length ? lore.map((e, i) => h('div', { class: 'lore-entry' }, h('h4', null, e.name),
        e.plate ? plateFigure(PL.normalizePlate(e.plate, 1), `l_${i}`, { small: true, caption: false }) : null,
        h('ul', null, e.facts.map((f) => h('li', null, f.text))))) : h('p', { class: 'faint' }, 'Nothing yet.'));
    wrap.append(h('div', { class: 'reader' }, toc, article, aside));
    return wrap;
  }

  function startReader() {
    S.mode = 'reader';
    if (!S.db) { render(); return; }
    const hash = (location.hash || '').replace(/^#/, '');
    S.db.collection('published').onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') S.pubWorlds.delete(ch.doc.id);
        else S.pubWorlds.set(ch.doc.id, Object.assign(C.clone(ch.doc.data()), { id: ch.doc.id }));
      }
      const ids = [...S.pubWorlds.keys()];
      const want = S.pubWorlds.has(hash) ? hash : ids.sort((a, b) => (S.pubWorlds.get(b).publishedAt || 0) - (S.pubWorlds.get(a).publishedAt || 0))[0] || null;
      if (want !== S.reader.wid) {
        if (S.reader.unsub) S.reader.unsub();
        S.reader.wid = want;
        S.reader.chapters = new Map();
        S.reader.pos = 0;
        if (want) {
          S.reader.unsub = S.db.collection(`published/${want}/chapters`).onSnapshot((cs) => {
            for (const c of cs.docChanges()) {
              if (c.type === 'removed') S.reader.chapters.delete(c.doc.id);
              else S.reader.chapters.set(c.doc.id, Object.assign(C.clone(c.doc.data()), { id: c.doc.id }));
            }
            render();
          }, onDbError);
        }
      }
      render();
    }, onDbError);
    render();
  }

  // ---------------------------------------------------------------- canon view

  // ---------------------------------------------------------------- bringing notes in

  // Paste notes or open a text file; Inkwash reads it (C.planImport) and shows everything it found
  // before anything is added. Nothing is sent to Claude and nothing is reworded. What the creator
  // keeps is added as one step, which can be undone; the notes themselves are kept as written.
  function openImport(target) {
    S.importDraft = { text: '', name: '', target: target && S.worlds.has(target) ? target : 'new', whole: false, plan: null, title: '', declared: false };
    openForm('import');
  }
  function closeImport() {
    S.importDraft = null; S.form = null;
    S.mode = S.wid ? 'studio' : (S.worlds.size ? 'studio' : 'welcome');
    if (!S.wid && S.worlds.size) chooseWorld();
    render();
  }
  function readNotes() {
    const d = S.importDraft;
    const into = d.target !== 'new' && d.target === S.wid;
    const plan = C.planImport(d.text, { entities: into ? S.canon : null, sources: into ? S.sources : null, split: !d.whole });
    if (plan.empty) { toast('Paste some notes or open a file first.', 'warn'); return; }
    if (plan.tooBig) { toast(`That's more than ${Math.round(plan.max / 1000)} KB of notes. Bring them in a part at a time.`, 'warn'); return; }
    d.plan = plan;
    d.title = d.title || plan.title || (d.name ? d.name.replace(/\.(md|markdown|txt|text)$/i, '') : '');
    render();
    window.scrollTo(0, 0);
  }
  async function openNotesFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > C.IMPORT_MAX * 2) { toast(`That file is more than ${Math.round(C.IMPORT_MAX / 1000)} KB. Bring your notes in a part at a time.`, 'warn'); return; }
    const text = await file.text();
    if (/\u0000/.test(text)) { toast('That file isn’t plain text. Save your notes as .txt or .md and open that.', 'warn'); return; }
    Object.assign(S.importDraft, { text, name: file.name, plan: null });
    render();
  }
  function importView() {
    const d = S.importDraft || (S.importDraft = { text: '', name: '', target: S.wid || 'new', whole: false, plan: null, title: '', declared: false });
    if (d.plan) return importReview(d);
    const into = d.target !== 'new' && S.worlds.get(d.target);
    const srcs = into && d.target === S.wid ? [...S.sources.values()].sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    return h('section', { class: 'page-pad import-page' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Bring in notes'),
        h('h1', null, into ? `Notes for ${into.title}` : 'Bring in your notes'),
        h('p', { class: 'muted' }, 'Paste notes about your world, or open a text or Markdown file. Inkwash reads their headings and lines and shows you what it found before anything is added. Nothing is sent to Claude, and nothing is reworded.')),
      h('details', { class: 'import-how' },
        h('summary', null, 'How notes are read'),
        h('ul', null,
          h('li', null, 'A heading (', h('code', null, '## Harrowgate'), ') starts an entry. The lines under it become its facts, a sentence or a bullet at a time.'),
          h('li', null, 'A heading such as Characters, Places, Factions, Creatures or Magic says what the entries under it are. Anything else gets its kind guessed, and the guess is marked.'),
          h('li', null, h('code', null, 'Name: what it is'), ' on a line of its own, or as a bullet, works too.'),
          h('li', null, 'Text under no heading is kept as Unsorted notes, for you to rename or leave out.'))),
      h('form', { class: 'form-grid import-form', onsubmit: (ev) => { ev.preventDefault(); readNotes(); } },
        h('label', { class: 'field' }, h('span', null, d.name ? `Your notes, from ${d.name}` : 'Your notes'),
          h('textarea', { id: 'import-text', rows: 14, 'data-keep': '', value: d.text, placeholder: '## Harrowgate\nA cliff city of lamplit terraces.\n- Seat of the Harbour Lords.\n\n## Characters\n### Ilse Varr\nShe keeps the lamp at Tidewatch lit.', oninput: (ev) => { d.text = ev.target.value; d.plan = null; } })),
        h('div', { class: 'import-row' },
          h('label', { class: 'btn small' }, 'Open a .txt or .md file', h('input', { type: 'file', accept: '.txt,.md,.markdown,.text,text/plain,text/markdown', class: 'sr-only', onchange: (ev) => openNotesFile(ev.target) })),
          h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: d.whole, onchange: (ev) => { d.whole = ev.target.checked; } }), 'Keep each paragraph as one fact')),
        h('label', { class: 'field' }, h('span', null, 'Bring them into'),
          h('select', { id: 'import-target', onchange: (ev) => { d.target = ev.target.value; d.plan = null; render(); } },
            S.wid && S.worlds.has(S.wid) ? h('option', { value: S.wid, selected: d.target === S.wid }, world().title) : null,
            h('option', { value: 'new', selected: d.target === 'new' }, 'A new world'))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'submit' }, 'Read my notes'),
          h('button', { class: 'btn ghost', type: 'button', onclick: closeImport }, 'Cancel'))),
      srcs.length ? h('section', { class: 'section import-past' },
        h('h3', null, 'Notes you brought in before'),
        srcs.map((x) => h('details', null,
          h('summary', null, `${x.name}, ${when(x.at)}: ${plural(x.facts || 0, 'fact')} in ${plural(x.entries || 0, 'entry', 'entries')}` + (x.declared ? ', declared your own writing' : '')),
          h('pre', { class: 'import-source' }, x.text)))) : null);
  }
  function importReview(d) {
    const plan = d.plan, into = d.target !== 'new' && S.worlds.get(d.target);
    const kept = plan.entries.filter((e) => e.keep);
    const facts = kept.reduce((n, e) => n + e.facts.filter((f) => f.keep).length, 0);
    const kindSel = (e) => h('select', { 'aria-label': `What ${e.name} is`, disabled: !!e.match, onchange: (ev) => { e.kind = ev.target.value; e.certain = true; e.from = 'you'; render(); } },
      C.KINDS.map((k) => h('option', { value: k, selected: k === e.kind }, k === 'rule' ? 'world rule' : k)));
    const kindNote = (e) => (e.match ? h('span', { class: 'import-tag' }, `already in your canon as a ${e.match.kind === 'rule' ? 'world rule' : e.match.kind}: these facts are added to it`)
      : e.unsorted ? h('span', { class: 'import-tag guess' }, 'not under any heading: rename it, or leave it out')
        : !e.certain ? h('span', { class: 'import-tag guess' }, e.why ? `a guess from ${e.why}: check it` : 'nothing said what this is: choose') : null);
    return h('section', { class: 'page-pad import-page' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Bring in notes'),
        h('h1', null, 'Here’s what Inkwash found'),
        h('p', { class: 'muted' }, `${plural(plan.counts.entries, 'entry', 'entries')} and ${plural(plan.counts.facts, 'fact')} in ${d.name || 'your notes'}. Untick anything you don’t want, fix a name or a kind, and rewrite any line. Only what is ticked is added.`
          + (plan.counts.dupFacts ? ` ${plural(plan.counts.dupFacts, 'line is', 'lines are')} already in your canon and left out.` : '')
          + (plan.counts.guessed ? ` ${plural(plan.counts.guessed, 'kind is a guess', 'kinds are guesses')}: check ${plan.counts.guessed === 1 ? 'it' : 'them'}.` : ''))),
      plan.seenBefore ? h('div', { class: 'banner warn' }, h('strong', null, 'You brought these notes in before.'), `On ${when(plan.seenBefore.at)}, as ${plan.seenBefore.name}. Anything still in your canon is left out below.`) : null,
      into ? null : h('label', { class: 'field import-title' }, h('span', null, 'Name of the new world'),
        h('input', { type: 'text', id: 'import-title', 'data-keep': '', value: d.title, placeholder: 'The world’s name', oninput: (ev) => { d.title = ev.target.value; } })),
      h('div', { class: 'import-entries' }, plan.entries.map((e, i) => h('section', { class: 'import-entry' + (e.keep ? '' : ' off'), 'aria-label': e.name },
        h('div', { class: 'import-entry-head' },
          h('input', { type: 'checkbox', checked: e.keep, 'aria-label': `Bring in ${e.name}`, onchange: (ev) => { e.keep = ev.target.checked; render(); } }),
          h('input', { type: 'text', class: 'import-name', id: 'import-name-' + i, 'data-keep': '', value: e.name, disabled: !!e.match, 'aria-label': 'Name', oninput: (ev) => { e.name = ev.target.value; } }),
          kindSel(e)),
        kindNote(e),
        e.facts.length ? h('ol', { class: 'import-facts' }, e.facts.map((f, j) => h('li', { class: f.dup ? 'dup' : f.keep ? '' : 'off' },
          h('input', { type: 'checkbox', checked: f.keep, disabled: f.dup || !e.keep, 'aria-label': `Bring in this line about ${e.name}`, onchange: (ev) => { f.keep = ev.target.checked; render(); } }),
          f.dup ? h('span', { class: 'import-fact' }, f.text) : h('textarea', { class: 'import-fact', id: `import-fact-${i}-${j}`, rows: 1, 'data-keep': '', value: f.text, disabled: !e.keep, 'aria-label': `Line ${f.line} about ${e.name}`, oninput: (ev) => { if (f.original == null) f.original = f.text; f.text = ev.target.value; f.edited = f.text !== f.original; fitProse(ev.target); } }),
          h('span', { class: 'import-line' }, f.dup ? 'already there' : `line ${f.line}`)))) : h('p', { class: 'faint' }, 'Just the name, for now.')))),
      h('label', { class: 'check-row import-declare' },
        h('input', { type: 'checkbox', id: 'import-declared', checked: d.declared, onchange: (ev) => { d.declared = ev.target.checked; } }),
        h('span', null, 'These notes are my own writing.', h('small', null, 'Inkwash keeps this as your statement. It can’t check it, and the record isn’t proof of copyright. Left unticked, the facts are marked as brought in from outside the studio.'))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', disabled: !kept.length, onclick: acceptImport }, kept.length ? `Add ${plural(facts, 'fact')} to ${into ? into.title : 'a new world'}` : 'Nothing is ticked'),
        h('button', { class: 'btn', type: 'button', onclick: () => { d.plan = null; render(); } }, 'Back to my notes'),
        h('button', { class: 'btn ghost', type: 'button', onclick: closeImport }, 'Cancel')));
  }
  function acceptImport() {
    const d = S.importDraft, plan = d && d.plan;
    if (!plan) return;
    const kept = plan.entries.filter((e) => e.keep && (e.facts.some((f) => f.keep) || !e.match));
    if (!kept.length) { toast('Nothing is ticked.', 'warn'); return; }
    if (d.target !== 'new' && d.target !== S.wid) { toast('Open that world first, then bring the notes in again.', 'warn'); return; }
    const sourceId = C.uid('src'), name = d.name || 'Pasted notes', at = now();
    // everything it would save is checked before anything changes: a document over the store's
    // limit would be refused, and a refused write stops this view saving
    const out = C.applyImport(plan, { entities: d.target === 'new' ? new Map() : S.canon, now: at, sourceId, sourceName: name, text: d.text, declared: d.declared });
    const big = out.entities.find((e) => C.utf8Bytes(JSON.stringify(e)) > DOC_MAX - 2000) || (C.utf8Bytes(JSON.stringify(out.source)) > DOC_MAX - 2000 ? out.source : null);
    if (big) { toast(big === out.source ? 'These notes are too big to keep in one piece. Bring them in a part at a time.' : `${big.name} would be too big to save in one piece. Leave some of its lines out, or bring them in a part at a time.`, 'warn'); return; }
    const newN = out.entities.filter((e) => d.target === 'new' || !S.canon.has(e.id)).length;
    if (d.target === 'new') makeWorld({ title: (d.title || '').trim() || 'Untitled world' });
    const rec = record(`Brought in ${name}`, 'import', { imported: out.source.facts, entries: newN });
    for (const e of out.entities) put('canon', e.id, e, { quiet: true });
    put('sources', sourceId, out.source, { quiet: true });
    const step = rec.done();
    const first = out.entities.find((e) => !e.name.startsWith('Unsorted')) || out.entities[0];
    S.importDraft = null; S.form = null; S.mode = 'studio';
    S.view = 'canon'; local.set('view', 'canon');
    if (first) { S.codexSel = first.id; S.codexBack = null; local.set('codex.' + S.wid, first.id); }
    toast(`Brought in ${plural(out.source.facts, 'fact')} in ${plural(out.entities.length, 'entry', 'entries')}, in your own words.`, null, undoAction(step));
    render();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- history: what can be undone

  // The changes a creator is likely to regret are kept as steps: how each document they touched
  // looked before. A step is undone fact by fact and document by document (C.undoStep), leaving
  // alone whatever changed since. Facts come back as new versions, so the ledger never mistakes a
  // scene set against undone words for a current one. Up to 40 steps per world.
  const JOURNALED = new Set(['canon', 'passages', 'seeds', 'sources', 'atlas', 'chapters', 'plates']);
  const HISTORY_KEEP = 40;
  function record(label, kind, counts) {
    if (S.readOnly || !S.wid) return { done: () => null };
    const rec = { label, kind, counts: counts || {}, before: new Map(), wid: S.wid, prev: S.recording };
    S.recording = rec;
    return {
      done(more) {
        if (S.recording === rec) S.recording = rec.prev;
        if (S.wid !== rec.wid) return null;
        const docs = [...rec.before].map(([key, before]) => { const [coll, id] = key.split('\u0000'); return { coll, id, before, after: MAP[coll]().get(id) || null }; });
        return commitStep((more && more.label) || rec.label, rec.kind, docs, Object.assign({}, rec.counts, more && more.counts));
      },
    };
  }
  // called by put() and removeDoc() before they change a document
  function noteBefore(kind, id) {
    const rec = S.recording;
    if (!rec || rec.wid !== S.wid || !JOURNALED.has(kind)) return;
    const key = kind + '\u0000' + id;
    if (!rec.before.has(key)) rec.before.set(key, C.clone(MAP[kind]().get(id) || null));
  }
  function commitStep(label, kind, docs, counts) {
    if (counts) bumpDay(counts);
    docs = docs.filter((d) => C.stableJson(d.before) !== C.stableJson(d.after));
    if (!docs.length || S.readOnly) return null;
    let step = C.historyStep({ id: C.uid('h'), label, kind, at: now(), docs });
    if (C.utf8Bytes(JSON.stringify(step)) > 200000) step = Object.assign(C.historyStep({ id: step.id, label, kind, at: step.at, docs: [] }), { tooBig: true });
    put('history', step.id, step, { quiet: true });
    try { local.set('lastActive.' + S.wid, now()); } catch (e) { /* fine */ }
    const old = [...S.history.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(HISTORY_KEEP);
    for (const x of old) removeDoc('history', x.id);
    return step;
  }
  const undoAction = (step) => (step ? { label: 'Undo', run: () => undoStepUI(step.id) } : null);
  function undoStepUI(id) {
    const step = S.history.get(id);
    if (!step || step.undone) return;
    if (step.tooBig) { toast('That change was too big to keep a way back from. Restore a backup to go back.', 'warn'); return; }
    for (const key of Object.keys(S.editBase)) commitEditLog(key);
    const staleBefore = staleScenes();
    const r = C.undoStep(step, { canon: S.canon, passages: S.passages, seeds: S.seeds, sources: S.sources, atlas: S.atlas, chapters: S.chapters, plates: S.plates }, now());
    if (!r.writes.length) {
      toast(`Nothing left to undo from “${step.label}”: what it changed has changed again since.` + (r.kept[0] ? ` (${r.kept[0]}.)` : ''), 'warn');
      return;
    }
    for (const w of r.writes) { if (w.doc) put(w.coll, w.id, w.doc, { quiet: true }); else removeDoc(w.coll, w.id); }
    put('history', id, Object.assign({}, step, { undone: true, undoneAt: now() }), { quiet: true });
    bumpDay({ undos: 1 });
    const kept = r.kept.length ? ` ${r.kept.length === 1 ? 'One thing' : r.kept.length + ' things'} changed since, so ${r.kept.length === 1 ? 'it stays' : 'they stay'} as ${r.kept.length === 1 ? 'it is' : 'they are'}: ${r.kept[0]}.` : '';
    // a fact put back is a new version: scenes set against the words just undone are flagged, and said so
    const flagged = [...staleScenes()].filter((pid) => !staleBefore.has(pid)).map((pid) => S.passages.get(pid));
    if (flagged.length) {
      const order = chapterOrder(), first = flagged[0];
      toast(`Undone: ${step.label}.${kept} ${plural(flagged.length, 'scene')} written against the undone words ${flagged.length === 1 ? 'is' : 'are'} now flagged: ${flagged.map((p) => `chapter ${order.indexOf(p.chapter) + 1}, scene ${p.scene + 1}`).join('; ')}.`, 'warn',
        { label: 'Show me', run: () => { S.cid = first.chapter; S.k = first.scene; savePos(); go('score'); } });
    } else toast(`Undone: ${step.label}.` + kept, r.kept.length ? 'warn' : null);
    render();
  }
  function staleScenes() {
    return new Set([...S.passages.values()].filter((p) => S.chapters.has(p.chapter) && sceneInfo(p.chapter, p.scene).state === 'stale').map((p) => p.id));
  }

  // What a creator did, day by day, in numbers only (C.ACTIVITY). They can read it in the studio
  // and choose to share it; nothing is sent anywhere.
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function bumpDay(counts) {
    if (S.readOnly || !S.wid || !S.worlds.has(S.wid)) return;
    const next = C.bumpActivity(S.meta.get('activity'), today(), counts);
    if (next) put('meta', 'activity', next, { quiet: true });
  }

  // ---------------------------------------------------------------- the History panel, and activity

  function modal(build) {
    const root = $('#modal-root');
    const prev = document.activeElement;
    const close = () => { clear(root); document.removeEventListener('keydown', onKey); if (prev && prev.focus && document.contains(prev)) prev.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const draw = () => {
      clear(root);
      root.append(h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, build(close, draw)));
    };
    document.addEventListener('keydown', onKey);
    draw();
    const first = root.querySelector('button, [href], input, textarea');
    if (first) first.focus();
  }
  function openHistory() {
    modal((close, draw) => {
      const steps = [...S.history.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
      return h('div', { class: 'modal wide history', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'history-title' },
        h('h2', { id: 'history-title' }, 'History'),
        h('p', { class: 'muted' }, `The last ${HISTORY_KEEP} changes to ${world().title}. Undo puts back what a change did, and leaves alone anything that has changed since. A fact put back is a new version, so any scene written against the undone words is flagged.`),
        steps.length ? h('ol', { class: 'history-list' }, steps.map((st) => h('li', { class: st.undone ? 'undone' : '' },
          h('span', { class: 'history-when' }, when(st.at)),
          h('span', { class: 'history-label' }, st.label),
          st.undone ? h('span', { class: 'faint' }, 'undone') : st.tooBig ? h('span', { class: 'faint' }, 'too big to undo') : h('button', { class: 'btn small', type: 'button', onclick: () => { undoStepUI(st.id); draw(); } }, 'Undo'))))
          : h('p', { class: 'faint' }, 'Nothing yet. The changes you make from now on show up here.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); openActivity(); } }, 'My activity, in numbers'),
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Close')));
    });
  }
  // Counts only, across every world: what a creator can read and choose to share in a trial.
  async function openActivity() {
    const rows = [];
    for (const w of S.worlds.values()) {
      let days = null;
      if (w.id === S.wid) days = (S.meta.get('activity') || {}).days;
      else { try { const snap = await S.db.doc(P.meta(w.id, 'activity')).get(); days = snap.exists ? (snap.data() || {}).days : null; } catch (e) { days = null; } }
      rows.push({ example: !!w.example, days: days || {} });
    }
    const sum = C.activitySummary(rows, today());
    modal((close) => h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'activity-title' },
      h('h2', { id: 'activity-title' }, 'My activity'),
      h('p', { class: 'muted' }, 'Counts only: none of your world’s words, and no names. It stays in this studio unless you copy it or save it.'),
      h('textarea', { class: 'activity-text', rows: 10, readonly: true, value: sum.md, 'aria-label': 'Your activity, as text' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(sum.md); toast('Copied.'); } catch (e) { toast('Your browser wouldn’t copy it. Select the text and copy it yourself.', 'warn'); } } }, 'Copy'),
        h('button', { class: 'btn', type: 'button', onclick: () => saveFile(`inkwash-activity-${today()}.md`, sum.md) }, 'Save as a file'),
        h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Close'))));
  }

  // ---------------------------------------------------------------- where you left off

  // Back after a while, a creator sees where this world was left: the last change, ripples with
  // ways not decided, questions saved for later, a scene gone stale or with ink not set. All from
  // what is stored; nothing is asked of Claude. It shows once per opening, until dismissed.
  const RETURN_AFTER = 20 * 60 * 1000;
  function lastTouched() {
    let t = Number(local.get('lastActive.' + S.wid, 0)) || 0;
    for (const x of S.history.values()) t = Math.max(t, x.at || 0);
    for (const e of S.canon.values()) t = Math.max(t, e.updatedAt || 0);
    for (const p of S.passages.values()) t = Math.max(t, p.updatedAt || 0);
    return t;
  }
  function leftOffDue() {
    const lo = S.leftOff, w = world();
    if (!lo || lo.wid !== S.wid || lo.dismissed || S.readOnly || !w || w.example) return false;
    if (lo.due == null) {
      if (!S.loaded.has('history')) return false;
      const t = lastTouched();
      lo.since = t;
      lo.due = !!t && now() - t > RETURN_AFTER;
    }
    return !!lo.due;
  }
  function leftOffItems() {
    const items = [], order = chapterOrder();
    const open = [];
    for (const e of S.canon.values()) for (const f of e.facts || []) {
      if (f.retired || !f.ripples) continue;
      const n = C.rippleWays(f.ripples).filter((w) => w.status === 'new').length;
      if (n) open.push({ e, f, n, at: f.ripples.at || 0 });
    }
    open.sort((a, b) => b.at - a.at);
    if (open[0]) items.push({ text: `Ripples on ${open[0].e.name}: ${plural(open[0].n, 'way')} you haven’t decided yet, from “${C.head(open[0].f.text, 70)}”`, label: 'Open', run: () => openEntry(open[0].e.id) });
    const later = [...S.seeds.values()].filter((d) => d.from || /\(from [^:]+: /.test(d.text || ''));
    if (later.length) items.push({ text: `${plural(later.length, 'question')} you saved for later, in the dream inbox`, label: 'Dream inbox', run: () => go('dreams') });
    const scenes = (state) => order.flatMap((cid) => { const ch = S.chapters.get(cid); return Array.from({ length: ch.scenes }, (_, k) => ({ cid, k })).filter((x) => sceneInfo(x.cid, x.k).state === state); });
    const show = (x) => () => { S.cid = x.cid; S.k = x.k; savePos(); go('score'); };
    const stale = scenes('stale');
    if (stale.length) items.push({ text: `${sceneName(stale[0].cid, stale[0].k)} needs a look: a fact it relied on changed` + (stale.length > 1 ? `, and ${plural(stale.length - 1, 'other scene')} too` : ''), label: 'Show me', run: show(stale[0]) });
    const wet = scenes('wet');
    if (wet.length) items.push({ text: `${sceneName(wet[0].cid, wet[0].k)} has ink you haven’t set` + (wet.length > 1 ? `, and ${plural(wet.length - 1, 'other scene')} too` : ''), label: 'Open it', run: show(wet[0]) });
    return items.slice(0, 3);
  }
  function leftOffCard() {
    const w = world(), lo = S.leftOff;
    const last = [...S.history.values()].filter((x) => !x.undone).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    const items = leftOffItems();
    const entry = S.codexSel && S.canon.get(S.codexSel);
    const go_ = (fn) => () => { lo.dismissed = true; fn(); };
    return h('section', { class: 'left-off', 'aria-label': 'Where you left off' },
      h('button', { class: 'btn ghost small left-off-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => { lo.dismissed = true; render(); } }, '×'),
      h('p', { class: 'eyebrow' }, 'Where you left off'),
      h('h2', null, `Welcome back to ${w.title}`),
      h('p', { class: 'muted' }, last ? `Your last change, ${when(last.at)}: ${last.label}.` : `You last worked here ${when(lo.since)}.`),
      items.length ? h('ul', { class: 'left-off-list' }, items.map((it) => h('li', null, h('span', null, it.text), h('button', { class: 'btn small', type: 'button', onclick: go_(it.run) }, it.label)))) : null,
      entry ? h('div', { class: 'btn-row' }, h('button', { class: 'btn primary small', type: 'button', onclick: go_(() => openEntry(entry.id)) }, `Continue with ${entry.name}`)) : null);
  }

  // ---------------------------------------------------------------- the canon, as the world's codex

  // The canon reads like the world's own book: an index of everything in it, and one entry at a
  // time as an illustrated page. A place or region shows where it lies on the map; anyone else
  // shows their plate, or an ink seal until they have one. Facts read as prose and are edited where
  // they stand; the tools for each stay quiet until you reach for them.
  function canonView() {
    const list = entities().slice().sort((a, b) => C.KINDS.indexOf(a.kind) - C.KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
    const sel = (S.codexSel && S.canon.get(S.codexSel)) || list.find((e) => e.kind === 'rule') || list[0] || null;
    return h('div', { class: 'codex' }, codexIndex(list, sel), h('div', { class: 'codex-page' }, sel ? entryPage(sel) : codexEmpty()));
  }
  function codexEmpty() {
    return h('section', { class: 'codex-empty' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Canon'),
        h('h1', null, 'What is true in ' + world().title),
        h('p', { class: 'muted' }, 'Nothing in the canon yet. Bring in the notes you already have, or name the first character, place or rule of this world.'),
        S.readOnly ? null : h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openImport(S.wid) }, 'Bring in notes'))));
  }
  function codexIndex(list, sel) {
    const q = (S.codexFind || '').trim().toLowerCase();
    const hit = (e) => !q || e.name.toLowerCase().includes(q) || (e.facts || []).some((f) => !f.retired && f.text.toLowerCase().includes(q));
    const nav = h('nav', { class: 'codex-index', 'aria-label': `Everything in ${world().title}` },
      h('p', { class: 'eyebrow' }, 'Canon'),
      h('p', { class: 'codex-world' }, world().title),
      list.length > 6 ? h('input', { type: 'search', id: 'codex-find', 'data-keep': '', value: S.codexFind || '', placeholder: 'Find a name or a fact', 'aria-label': 'Find in the canon', oninput: (ev) => { S.codexFind = ev.target.value; render(); } }) : null,
      // on a phone, a menu instead of the list
      list.length ? h('select', { class: 'codex-jump', 'aria-label': 'Open an entry', onchange: (ev) => openEntry(ev.target.value) },
        C.KINDS.map((k) => { const of = list.filter((e) => e.kind === k); return of.length ? h('optgroup', { label: C.KIND_LABEL[k] }, of.map((e) => h('option', { value: e.id, selected: !!sel && e.id === sel.id }, e.name))) : null; })) : null);
    for (const kind of C.KINDS) {
      const group = list.filter((e) => e.kind === kind && hit(e));
      if (!group.length) continue;
      nav.append(h('div', { class: 'codex-group' }, h('h2', null, C.KIND_LABEL[kind]),
        h('ul', null, group.map((e) => h('li', null, h('button', { class: 'codex-link', type: 'button', 'aria-current': sel && e.id === sel.id ? 'page' : null, onclick: () => openEntry(e.id) }, e.name))))));
    }
    if (q && !list.some(hit)) nav.append(h('p', { class: 'faint' }, 'Nothing matches.'));
    if (!S.readOnly) {
      const kindSel = h('select', { id: 'new-kind', 'aria-label': 'Kind' }, C.KINDS.map((k) => h('option', { value: k }, k === 'rule' ? 'world rule' : k)));
      nav.append(h('details', { class: 'codex-add', open: !list.length },
        h('summary', null, 'Something new in this world'),
        h('button', { class: 'linklike codex-import', type: 'button', onclick: () => openImport(S.wid) }, 'Bring in notes'),
        h('form', { class: 'add-entity', onsubmit: (ev) => { ev.preventDefault(); const name = ev.target.querySelector('#new-entity-name').value.trim(); if (!name) return; const ent = C.newEntity(kindSel.value, name, now()); const rec = record(`Added ${name} to the canon`, 'add', { entries: 1 }); put('canon', ent.id, ent); rec.done(); openEntry(ent.id, { focus: 'new-fact-' + ent.id }); } },
          h('div', { class: 'inline-form' }, kindSel, h('input', { type: 'text', id: 'new-entity-name', placeholder: 'Its name', 'aria-label': 'Name' })),
          h('button', { class: 'btn primary small', type: 'submit' }, 'Add to canon'))));
    }
    return nav;
  }
  // open an entry's page; `focus` is the id of what to put the cursor in once it's there
  function openEntry(id, opts) {
    if (!id || !S.canon.has(id)) return;
    if (S.codexSel && S.codexSel !== id) S.codexBack = S.codexSel;
    S.codexSel = id;
    if (S.wid) local.set('codex.' + S.wid, id);
    if (S.view !== 'canon') { S.view = 'canon'; local.set('view', 'canon'); }
    S.preview = false;
    render();
    requestAnimationFrame(() => {
      const el = opts && opts.focus && document.getElementById(opts.focus);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
      else window.scrollTo(0, 0);
    });
  }
  // One entry as a page. `art: false` leaves out its picture (beside the map, the map is the
  // picture), `head: false` its title, `tools: false` its kind and Delete; `onLink` opens a
  // connected entry somewhere other than the codex.
  function entryPage(e, opts) {
    opts = opts || {};
    const live = (e.facts || []).filter((f) => !f.retired), retired = (e.facts || []).filter((f) => f.retired);
    const back = opts.art !== false && S.codexBack && S.codexBack !== e.id ? S.canon.get(S.codexBack) : null;
    const where = mapEntry(e), plated = !where && S.plates.has(PL.plateId.entity(e.id));
    const page = h('article', { class: 'entry card' + (opts.compact ? ' compact' : ''), 'aria-label': e.name });
    if (back) page.append(h('button', { class: 'linklike entry-back', type: 'button', onclick: () => openEntry(back.id) }, '← ' + back.name));
    if (opts.head !== false) {
      const art = opts.art === false ? null : where ? mapInset(e, where) : plated ? h('div', { class: 'entry-plate' }, plateFigure(S.plates.get(PL.plateId.entity(e.id)).spec, PL.plateId.entity(e.id), { small: true })) : entrySeal(e);
      page.append(h('header', { class: 'entry-head' + (where && art ? ' wide' : art ? '' : ' bare') },
        art,
        h('div', { class: 'entry-title' },
          h('p', { class: 'eyebrow' }, entryKicker(e)),
          h('input', { class: 'entry-name', type: 'text', id: 'ent-name-' + e.id, value: e.name, 'data-keep': '', 'aria-label': 'Name', disabled: S.readOnly, onchange: (ev) => { const v = ev.target.value.trim(); if (v && v !== e.name) { const rec = record(`Renamed ${e.name} to ${v}`, 'edit'); put('canon', e.id, Object.assign({}, e, { name: v })); rec.done(); } } }))));
    }
    const body = h('div', { class: 'entry-facts' });
    for (const f of live) body.append(factRow(e, f));
    if (!live.length) body.append(h('p', { class: 'faint' }, 'Nothing is known about it yet.'));
    page.append(body);
    if (!S.readOnly) page.append(h('form', { class: 'inline-form entry-add', onsubmit: (ev) => { ev.preventDefault(); const inp = ev.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; const ent = C.clone(e); const nf = C.newFact(v, 'human', now()); ent.facts.push(nf); const rec = record(`Added a fact to ${e.name}`, 'add', { own: 1 }); put('canon', e.id, ent); const step = rec.done(); toast(`Added to ${e.name}. Where does it lead?`, null, [{ label: 'Ripples', run: () => rippleFact(e.id, nf.id) }, undoAction(step)]); requestAnimationFrame(() => { const el = document.getElementById('new-fact-' + e.id); if (el) { el.value = ''; el.focus(); } }); } },
      h('input', { type: 'text', id: 'new-fact-' + e.id, placeholder: `Something new about ${e.name}…`, 'aria-label': `New fact about ${e.name}` }),
      h('button', { class: 'btn small', type: 'submit' }, 'Add')));
    if (e.kind === 'place' || e.kind === 'character') {
      const target = { kind: e.kind, id: PL.plateId.entity(e.id), eid: e.id };
      if (S.plates.has(target.id) || S.busy['plate:' + target.id] || aiOn()) page.append(plateSection(target, { figure: !plated || opts.art === false || opts.head === false }));
    }
    if (retired.length) page.append(h('details', { class: 'entry-retired' }, h('summary', { class: 'faint' }, `Retired facts (${retired.length})`), retired.map((f) => h('p', { class: 'retired' }, f.history && f.history.length ? f.history[f.history.length - 1].text : f.text))));
    const links = entryLinks(e, opts);
    if (links) page.append(links);
    if (!S.readOnly && opts.tools !== false) page.append(h('div', { class: 'entry-tools' },
      h('label', null, 'Kind ', h('select', { 'aria-label': 'Kind', onchange: (ev) => { const rec = record(`Changed what ${e.name} is`, 'edit'); put('canon', e.id, Object.assign({}, e, { kind: ev.target.value })); rec.done(); } }, C.KINDS.map((k) => h('option', { value: k, selected: k === e.kind }, k === 'rule' ? 'world rule' : k)))),
      h('button', { class: 'btn ghost small danger', type: 'button', 'aria-label': `Delete ${e.name}`, onclick: () => deleteEntity(e.id) }, 'Delete')));
    return page;
  }
  const KIND_ONE = { character: 'Character', place: 'Place', faction: 'Faction', thing: 'Thing or creature', rule: 'Rule of the world' };
  // what it is, and where: "Capital in The Old Coast", "Region", "Character"
  function entryKicker(e) {
    const doc = atlasDoc(), s = doc && doc.spec;
    if (s) {
      if (s.regions.some((g) => g.entity === e.id)) return 'Region';
      const p = s.places.concat(s.features || []).find((x) => x.entity === e.id);
      const g = p && s.regions.find((x) => x.id === p.region), ge = g && g.entity && S.canon.get(g.entity);
      if (p) return (KIND_NAME[p.kind] || 'Place') + (g ? ' in ' + ((ge && ge.name) || g.name) : '');
    }
    return KIND_ONE[e.kind] || 'Entry';
  }
  // an ink seal with the entry's first letter, for whatever has no picture yet
  function entrySeal(e) {
    const letter = (e.name.replace(/^(the|a|an)\s+/i, '').trim()[0] || '·').toUpperCase();
    return h('div', { class: 'entry-seal k-' + e.kind, 'aria-hidden': 'true' }, letter);
  }
  // what this entry names, and what names it: the web of the world
  function entryLinks(e, opts) {
    const mine = (e.facts || []).filter((f) => !f.retired).map((f) => f.text);
    const out = entities().filter((x) => x.id !== e.id && (mine.some((t) => C.mentions(t, x.name)) || (x.facts || []).some((f) => !f.retired && C.mentions(f.text, e.name))));
    if (!out.length) return null;
    out.sort((a, b) => a.name.localeCompare(b.name));
    return h('section', { class: 'entry-links', 'aria-label': `Connected to ${e.name}` },
      h('h2', null, 'Connected'),
      h('div', { class: 'link-row' }, out.slice(0, 30).map((x) => h('button', { class: 'chip', type: 'button', onclick: () => (opts && opts.onLink ? opts.onLink(x) : openEntry(x.id)) }, x.name))));
  }

  // ---------------------------------------------------------------- where an entry lies on the map

  // where an entry is drawn: a place, or a region (a feature, named on the land, shows its region)
  function mapEntry(e) {
    const doc = atlasDoc(), s = doc && doc.spec;
    if (!s || !e) return null;
    const p = s.places.find((x) => x.entity === e.id);
    if (p) return { type: 'place', id: p.id };
    const g = s.regions.find((x) => x.entity === e.id);
    if (g) return { type: 'region', id: g.id };
    const f = (s.features || []).find((x) => x.entity === e.id);
    return f && f.region && s.regions.some((x) => x.id === f.region) ? { type: 'region', id: f.region } : null;
  }
  // The painted map is kept as markup, shared with the atlas, so a page shows where its entry lies
  // without painting the world again. Painting takes a moment, so it happens after a render.
  const mapArt = { key: null, html: null, at: null, painting: null, insets: new Map() };
  function mapKey() { const doc = atlasDoc(); return doc && doc.spec ? S.wid + '|' + JSON.stringify(liveSpec(doc.spec)) : null; }
  function paintedMap() {
    const key = mapKey();
    if (!key) return null;
    if (mapArt.key === key) return mapArt;
    if (mapArt.painting !== key) {
      mapArt.painting = key;
      setTimeout(() => { if (mapArt.painting !== key || mapKey() !== key) return; keepMap(key, AT.paint(liveSpec(atlasDoc().spec), { id: S.wid, zoom: 1 })); render(); }, 30);
    }
    return null;
  }
  // the markup, and where each place and region lies in it
  function keepMap(key, html) {
    const at = { places: new Map(), regions: new Map() };
    for (const m of html.matchAll(/<g class="atlas-place" data-id="([^"]*)"(?: data-entity="[^"]*")? transform="translate\(([-\d.]+) ([-\d.]+)\)/g)) at.places.set(m[1], { x: +m[2], y: +m[3] });
    for (const m of html.matchAll(/<path class="atlas-region" data-id="([^"]*)"(?: data-entity="[^"]*")? d="([^"]*)"/g)) {
      const n = (m[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
      if (x1 > x0 && y1 > y0) at.regions.set(m[1], { x0, y0, x1, y1, d: m[2] });
    }
    Object.assign(mapArt, { key, html, at, painting: null });
    mapArt.insets.clear();
  }
  const BANNER = 2.4; // the strip of map at the head of a page: its width over its height
  function mapInset(e, where) {
    const art = paintedMap();
    if (!art) return h('div', { class: 'entry-map wait' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), 'Finding it on the map…');
    const key = where.type + ':' + where.id;
    if (!art.insets.has(key)) {
      const el = buildInset(art, where);
      if (!el) return entrySeal(e);
      if (art.insets.size >= 6) art.insets.delete(art.insets.keys().next().value);
      art.insets.set(key, el);
    }
    const el = art.insets.get(key);
    el.setAttribute('aria-label', `${e.name} on the map. Open the atlas there.`);
    return el;
  }
  function buildInset(art, where) {
    let box;
    if (where.type === 'place') {
      const p = art.at.places.get(where.id);
      if (!p) return null;
      const w = AT.W / 3.4;
      box = frame(p.x - w / 2, p.y - w / BANNER / 2, w, w / BANNER);
    } else {
      const g = art.at.regions.get(where.id);
      if (!g) return null;
      let w = (g.x1 - g.x0) * 1.3, hh = (g.y1 - g.y0) * 1.3;
      if (w / hh < BANNER) w = hh * BANNER; else hh = w / BANNER;
      box = frame((g.x0 + g.x1) / 2 - w / 2, (g.y0 + g.y1) / 2 - hh / 2, w, hh);
    }
    const el = h('button', { class: 'entry-map', type: 'button', onclick: () => showOnMap(where, box) });
    el.innerHTML = art.html;
    const svg = el.querySelector('svg');
    svg.setAttribute('viewBox', `${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.dataset.z = box.w < AT.W / 2.8 ? '3' : box.w < AT.W / 1.6 ? '2' : '1';
    // where it is: ink rings spreading from a place, or its region washed in
    const NS = 'http://www.w3.org/2000/svg', mark = document.createElementNS(NS, 'g');
    mark.setAttribute('class', 'entry-mark');
    if (where.type === 'place') {
      const p = art.at.places.get(where.id);
      [0.02, 0.045, 0.072].forEach((k, i) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', (box.w * k).toFixed(1));
        c.setAttribute('class', 'ring r' + i);
        mark.append(c);
      });
    } else {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', art.at.regions.get(where.id).d);
      path.setAttribute('class', 'wash');
      mark.append(path);
    }
    svg.append(mark);
    return el;
  }
  // a window on the map, kept inside it
  function frame(x, y, w, hh) {
    if (w > AT.W) { hh *= AT.W / w; w = AT.W; }
    if (hh > AT.H) { w *= AT.H / hh; hh = AT.H; }
    return { x: Math.min(AT.W - w, Math.max(0, x)), y: Math.min(AT.H - hh, Math.max(0, y)), w, h: hh };
  }
  // the atlas, centred on what the page showed, with it chosen
  function showOnMap(where, box) {
    const hh = (box.w * AT.H) / AT.W, view = { x: box.x, y: box.y + box.h / 2 - hh / 2, w: box.w };
    if (S.wid) local.set('atlasView.' + S.wid, view);
    stage.view = view;
    S.atlasSel = { type: where.type, id: where.id };
    go('atlas');
    if (stage.el && stage.el.dataset.wid === S.wid) setView(view);
  }
  function factRow(e, f) {
    const uses = C.dependents(S.passages, f.id).sort((a, b) => chapterOrder().indexOf(a.chapter) - chapterOrder().indexOf(b.chapter) || a.scene - b.scene);
    const order = chapterOrder();
    const ta = h('textarea', {
      id: 'fact-' + f.id, class: 'prose', rows: 1, 'data-keep': '', 'aria-label': `Fact about ${e.name}`, disabled: S.readOnly,
      onchange: (ev) => reviseFactUI(e.id, f.id, ev.target.value), oninput: (ev) => fitProse(ev.target),
    });
    ta.defaultValue = f.text;
    // Ripples first; then whose it is, whether it's secret, and where it's used. The version and the
    // tools that change it wait until you reach for the fact.
    const secret = h('label', null, h('input', { type: 'checkbox', checked: !!f.secret, disabled: S.readOnly, onchange: (ev) => updateFact(e.id, f.id, { secret: ev.target.checked }) }), 'secret');
    const meta = h('div', { class: 'fact-meta' },
      aiOn() ? h('button', { class: 'btn ghost small ripple-btn', type: 'button', disabled: !!S.busy['ripple:' + f.id], title: 'What this fact breaks, and where it leads: your own idea first, or one of Claude’s to start from', onclick: () => rippleFact(e.id, f.id) },
        S.busy['ripple:' + f.id] ? 'Following the ripples…' : f.ripples ? 'Ripple again' : 'Ripples')
        : S.readOnly ? null : h('button', { class: 'btn ghost small ripple-btn', type: 'button', title: 'Where does this lead? Write your own idea. Claude’s ways need the claude.ai version.', onclick: () => rippleFact(e.id, f.id) }, 'Ripples'),
      f.origin === 'accepted' ? h('span', { class: 'badge kept', title: 'Suggested by Claude, kept by you' }, 'kept from a suggestion') : null,
      f.origin === 'imported' ? h('span', { class: 'badge imported', title: f.declared ? 'From notes you brought in and declared your own writing (your statement; not checked)' : 'From notes you brought in; where they came from isn’t checked' }, 'from your notes') : null,
      f.secret ? secret : null,
      f.secret ? h('select', { 'aria-label': 'Revealed in', disabled: S.readOnly, onchange: (ev) => updateFact(e.id, f.id, { reveal: ev.target.value || null }) },
        h('option', { value: '' }, 'not revealed yet'),
        order.map((cid, i) => h('option', { value: cid, selected: f.reveal === cid }, `revealed in chapter ${i + 1}`))) : null,
      uses.length ? h('span', { class: 'uses' }, 'Used in ', uses.map((p, i) => [i ? ', ' : '', h('button', { type: 'button', onclick: () => { S.cid = p.chapter; S.k = p.scene; savePos(); go('score'); } }, `ch. ${order.indexOf(p.chapter) + 1}, scene ${p.scene + 1}`)])) : null,
      h('span', { class: 'meta-more' },
        h('span', { class: 'badge', title: (f.history || []).map((x) => `v${x.v}: ${x.text}`).join('\n') || 'No earlier wording' }, `v${f.v}`),
        f.secret ? null : secret,
        uses.length ? null : h('span', null, 'Not used by any scene yet'),
        S.readOnly ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: () => retireFactUI(e.id, f.id) }, 'Retire')));
    return h('div', { class: 'fact' }, ta, meta, f.ripples ? ripplesPanel(e, f) : null);
  }
  function reviseFactUI(eid, fid, text) {
    const e = C.clone(S.canon.get(eid));
    const f = e && e.facts.find((x) => x.id === fid);
    if (!f) return;
    const before = new Set([...S.passages.values()].filter((p) => sceneInfo(p.chapter, p.scene).state === 'stale').map((p) => p.id));
    if (!C.reviseFact(f, text, now())) return;
    const rec = record(`Reworded a fact about ${e.name}`, 'edit', { edits: 1 });
    put('canon', eid, e, { quiet: true });
    const step = rec.done();
    reportNewlyStale(before, `${e.name} changed.`, { label: 'Ripples', run: () => rippleFact(eid, fid) }, step);
    render();
  }
  function retireFactUI(eid, fid) {
    const e = C.clone(S.canon.get(eid));
    const f = e && e.facts.find((x) => x.id === fid);
    if (!f) return;
    const before = new Set([...S.passages.values()].filter((p) => sceneInfo(p.chapter, p.scene).state === 'stale').map((p) => p.id));
    C.retireFact(f, now());
    const rec = record(`Retired a fact about ${e.name}`, 'edit', { edits: 1 });
    put('canon', eid, e, { quiet: true });
    const step = rec.done();
    reportNewlyStale(before, 'Fact retired.', null, step);
    render();
  }
  function reportNewlyStale(before, lead, ripple, step) {
    const now_ = [...S.passages.values()].filter((p) => !before.has(p.id) && S.chapters.has(p.chapter) && sceneInfo(p.chapter, p.scene).state === 'stale');
    if (!now_.length) { toast(`${lead} No written scene relied on the old wording.` + (ripple ? ' See what else it moves?' : ''), null, [ripple, undoAction(step)]); return; }
    const order = chapterOrder();
    const first = now_[0];
    toast(`${lead} ${plural(now_.length, 'scene')} relied on the old wording and ${now_.length === 1 ? 'is' : 'are'} now flagged: ${now_.map((p) => `chapter ${order.indexOf(p.chapter) + 1}, scene ${p.scene + 1}`).join('; ')}.`, 'warn',
      [{ label: 'Show me', run: () => { S.cid = first.chapter; S.k = first.scene; savePos(); go('score'); } }, undoAction(step)]);
  }
  // ---------------------------------------------------------------- ripples

  // Think one fact through, led by the author. Claude reads it against the rest of the canon and
  // the scenes that touch it, says what it breaks, and offers four ways it could lead, each a
  // question with four possible answers. The author picks a way or names their own, then picks an
  // answer, rewrites it or writes their own. Only what they add joins the canon.
  async function rippleFact(eid, fid) {
    const key = 'ripple:' + fid, e = S.canon.get(eid), f = e && (e.facts || []).find((x) => x.id === fid);
    if (f && !aiOn() && !S.readOnly) {
      // without Claude, a ripple is the author's own idea: no call, nothing suggested
      if (!f.ripples) put('canon', eid, C.withRipples(e, fid, { breaks: [], ways: [], offline: true }, now()), { quiet: true });
      if (S.view !== 'canon' && S.view !== 'atlas') openEntry(eid); else if (S.view === 'canon' && S.codexSel !== eid) openEntry(eid);
      S.ripple.open[fid] = 'mine';
      render();
      requestAnimationFrame(() => { const el = document.getElementById('ripple-idea-' + fid); if (el) el.focus(); });
      return;
    }
    if (!f || !aiOn() || S.busy[key]) return;
    const busy = { ctl: new AbortController() };
    S.busy[key] = busy;
    render();
    try {
      const order = chapterOrder();
      const scenes = C.rippleScenes([...S.passages.values()].filter((p) => S.chapters.has(p.chapter)), e, fid, (p) => `Chapter ${order.indexOf(p.chapter) + 1}, scene ${p.scene + 1}`, 6);
      const { prompt, refMap } = C.buildRipplePrompt({ world: world(), entity: e, fact: f, items: C.rippleCanon(S.canon, eid, fid, 120), scenes });
      const ripples = C.parseRipples(await S.sample.json(prompt, { modelTier: 'default', signal: busy.ctl.signal, cache: false }), refMap);
      const cur = S.canon.get(eid);
      if (cur) put('canon', eid, C.withRipples(cur, fid, ripples, now()), { quiet: true });
      delete S.ripple.open[fid];
      if (!ripples.breaks.length && !ripples.ways.length) toast('Nothing came back for that fact. Try again in a moment.');
      else announce(`Ripples: ${plural(ripples.breaks.length, 'break')}, and ${plural(ripples.ways.length, 'way')} it could lead.`);
    } catch (err) { aiError(err, 'following the ripples'); }
    finally { delete S.busy[key]; render(); }
  }
  // a bit of help with the author's own idea: Claude asks one question that takes it further, with
  // answers to start from. The idea stays in its box until the author adds it.
  async function rippleToward(eid, fid, toward) {
    const key = 'ripple-way:' + fid, e = S.canon.get(eid), f = e && (e.facts || []).find((x) => x.id === fid);
    if (!f || !f.ripples || !aiOn() || S.busy[key] || !toward) return;
    const busy = { ctl: new AbortController() };
    S.busy[key] = busy;
    render();
    try {
      const { prompt, refMap } = C.buildRipplePrompt({ world: world(), entity: e, fact: f, items: C.rippleCanon(S.canon, eid, fid, 120), toward });
      const [way] = C.parseRipples(await S.sample.json(prompt, { modelTier: 'default', signal: busy.ctl.signal, cache: false }), refMap, 1).ways;
      const cur = S.canon.get(eid);
      if (!way) toast('Nothing came back for that way. Try again in a moment.');
      else if (cur) {
        put('canon', eid, C.addRippleWay(cur, fid, Object.assign(way, { own: true, toward })), { quiet: true });
        S.ripple.open[fid] = way.id;
        announce(`${way.label}: ${way.question}`);
      }
    } catch (err) { aiError(err, 'following that way'); }
    finally { delete S.busy[key]; render(); }
  }
  function ripplesPanel(e, f) {
    const r = f.ripples, ro = S.readOnly, breaks = r.breaks || [], ways = C.rippleWays(r);
    const fresh = ways.filter((w) => w.status === 'new'), decided = ways.filter((w) => w.status === 'answered' && w.answer);
    const openId = S.ripple.open[f.id], open = fresh.find((w) => w.id === openId);
    const group = (title, items) => (items.length ? h('div', { class: 'ripple-group' }, h('p', { class: 'ripple-head' }, title), items) : null);
    const wayBtn = (id, label, cls) => h('button', { class: 'btn small way' + (cls || ''), type: 'button', 'aria-pressed': String(openId === id), onclick: () => openWay(f.id, id) }, label);
    return h('div', { class: 'ripples', role: 'group', 'aria-label': `Ripples of a fact about ${e.name}` },
      h('p', { class: 'eyebrow' }, 'Ripples', r.v !== f.v ? h('span', { class: 'faint' }, ' · of an earlier wording') : null),
      group('What it breaks', breaks.map((b) => h('div', { class: 'ripple break' }, h('p', null, b.why || 'A contradiction.'), rippleTarget(b)))),
      ro ? null : h('div', { class: 'ripple-group' },
        h('p', { class: 'ripple-head', id: 'ripple-ways-' + f.id }, 'Where does it lead?'),
        h('div', { class: 'ripple-ways', role: 'group', 'aria-labelledby': 'ripple-ways-' + f.id },
          wayBtn('mine', 'My own idea', ' mine'),
          fresh.length ? h('span', { class: 'ripple-or' }, 'or one of Claude’s:') : null,
          fresh.map((w) => wayBtn(w.id, w.label))),
        openId === 'mine' ? ideaView(e, f) : open ? wayView(e, f, open) : null,
        aiOn() ? null : h('p', { class: 'faint' }, 'Claude’s ways, and what this fact breaks, need the claude.ai version of Inkwash.')),
      group('Decided', decided.map((w) => h('p', { class: 'ripple decided' }, h('strong', null, w.label + ': '), w.answer.text))),
      ro && !breaks.length && !decided.length ? h('p', { class: 'faint' }, 'Nothing decided here yet.') : null);
  }
  function openWay(fid, id) {
    if (S.ripple.open[fid] === id) delete S.ripple.open[fid];
    else S.ripple.open[fid] = id;
    render();
    if (S.ripple.open[fid]) requestAnimationFrame(() => { const el = document.getElementById(id === 'mine' ? 'ripple-idea-' + fid : 'ripple-answer-' + id); if (el) el.focus({ preventScroll: true }); });
  }
  const KIND_GROUPS = { character: 'Characters', place: 'Places', faction: 'Factions', thing: 'Things', rule: 'World rules' };
  // The author's own idea of where it leads, first: written by them, filed where they say. Claude
  // helps only when asked, with a question that takes it further.
  function ideaView(e, f) {
    const idea = S.ripple.idea[f.id] || (S.ripple.idea[f.id] = { text: '', into: e.id, name: '', kind: 'character' });
    const fresh = idea.into === '__new', target = fresh ? null : S.canon.get(idea.into) || e;
    const list = entities().slice().sort((a, b) => a.name.localeCompare(b.name));
    const busy = !!S.busy['ripple-way:' + f.id], box = 'ripple-idea-' + f.id;
    return h('div', { class: 'ripple way-open mine' },
      h('form', { class: 'ripple-answer', onsubmit: (ev) => { ev.preventDefault(); addIdea(e.id, f.id); } },
        h('label', { class: 'ripple-mine', for: box }, 'My own idea'),
        h('textarea', { id: box, rows: 3, 'data-keep': '', value: idea.text, placeholder: 'Where does it lead? A consequence, a twist, someone it changes. Write it your way.', oninput: (ev) => { idea.text = ev.target.value; } }),
        h('div', { class: 'ripple-into' },
          h('label', { for: 'ripple-into-' + f.id }, 'Goes into'),
          h('select', { id: 'ripple-into-' + f.id, onchange: (ev) => { idea.into = ev.target.value; render(); } },
            C.KINDS.map((k) => { const of = list.filter((x) => x.kind === k); return of.length ? h('optgroup', { label: KIND_GROUPS[k] }, of.map((x) => h('option', { value: x.id, selected: x.id === idea.into }, x.name))) : null; }),
            h('option', { value: '__new', selected: fresh }, 'A new entry…')),
          fresh ? [
            h('input', { type: 'text', id: 'ripple-new-' + f.id, 'data-keep': '', value: idea.name, placeholder: 'Its name', 'aria-label': 'Name of the new entry', oninput: (ev) => { idea.name = ev.target.value; } }),
            h('select', { 'aria-label': 'What the new entry is', onchange: (ev) => { idea.kind = ev.target.value; } }, C.KINDS.map((k) => h('option', { value: k, selected: k === idea.kind }, k === 'rule' ? 'world rule' : k))),
          ] : null),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small primary', type: 'submit' }, target ? `Add to ${target.name}` : 'Add it'),
          aiOn() ? h('button', { class: 'btn ghost small', type: 'button', disabled: busy, onclick: () => helpWithIdea(e.id, f.id) }, busy ? 'Thinking…' : 'Help me think it through') : null)));
  }
  function addIdea(eid, fid) {
    const idea = S.ripple.idea[fid], src = S.canon.get(eid), text = idea ? idea.text.trim() : '';
    const focus = (id) => { const el = document.getElementById(id); if (el) el.focus(); };
    if (!src || !text) return focus('ripple-idea-' + fid);
    let target;
    if (idea.into === '__new') {
      const name = idea.name.replace(/\s+/g, ' ').trim();
      if (!name) { toast('Give the new entry a name first.'); return focus('ripple-new-' + fid); }
      const found = entities().find((x) => x.name.toLowerCase() === name.toLowerCase());
      target = found ? C.clone(found) : C.newEntity(idea.kind, name, now());
    } else target = C.clone(S.canon.get(idea.into) || src);
    const isNew = !S.canon.has(target.id), nf = C.newFact(text, 'human', now());
    target.facts.push(nf);
    const rec = record(`Added your idea to ${target.name}`, 'ripple', Object.assign({ own: 1, rippleOwn: 1 }, isNew ? { entries: 1 } : {}));
    put('canon', target.id, target);
    put('canon', eid, C.addRippleWay(S.canon.get(eid), fid, { id: C.uid('rp'), label: 'My own idea', about: target.name, kind: target.kind, question: '', options: [], status: 'answered', own: true, mine: true, answer: { eid: target.id, fid: nf.id, text: nf.text } }));
    const step = rec.done();
    delete S.ripple.idea[fid]; delete S.ripple.open[fid];
    toast(isNew ? `${target.name} is new in your canon. Where does that lead?` : `Added to ${target.name}. Where does that lead?`, null, [{ label: 'Ripples', run: () => rippleFact(target.id, nf.id) }, undoAction(step)]);
  }
  function helpWithIdea(eid, fid) {
    const idea = S.ripple.idea[fid], text = idea ? idea.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!text) { toast('Write a few words of your idea first, and Claude will ask you about it.'); const el = document.getElementById('ripple-idea-' + fid); if (el) el.focus(); return; }
    rippleToward(eid, fid, text);
  }
  // one of Claude's ways: its question, the author's own answer first, then Claude's to start from
  function wayView(e, f, w) {
    const pick = S.ripple.pick[w.id], box = 'ripple-answer-' + w.id;
    const name = (w.about || '').trim() || e.name;
    const known = entities().some((x) => x.name.toLowerCase() === name.toLowerCase());
    return h('div', { class: 'ripple way-open' },
      h('p', { class: 'ripple-q' }, h('strong', null, w.label + ': '), w.question),
      h('form', { class: 'ripple-answer', onsubmit: (ev) => { ev.preventDefault(); const v = (S.ripple.draft[w.id] || '').trim(); if (v) answerWay(e.id, f.id, w, v); else document.getElementById(box).focus(); } },
        h('label', { class: 'ripple-mine', for: box }, 'My own answer'),
        h('textarea', { id: box, rows: 2, 'data-keep': '', value: S.ripple.draft[w.id] || '', placeholder: 'Write it your way.', oninput: (ev) => { S.ripple.draft[w.id] = ev.target.value; } }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small primary', type: 'submit' }, `Add to ${name}`),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => laterWay(e.id, f.id, w) }, 'Later')),
        known ? null : h('p', { class: 'faint' }, `${name} is new: adding it starts a ${w.kind === 'rule' ? 'world rule' : w.kind} in your canon.`)),
      w.options.length ? h('div', { class: 'ripple-options', role: 'group', 'aria-labelledby': 'ripple-opts-' + w.id },
        h('p', { class: 'ripple-or', id: 'ripple-opts-' + w.id }, 'Or start from one of Claude’s:'),
        w.options.map((o, i) => h('button', { class: 'btn small option', type: 'button', 'aria-pressed': String(pick === i), onclick: () => pickOption(w, i) }, o))) : null);
  }
  // one of Claude's answers goes into the box, to rewrite; whatever the author already wrote there stays
  function pickOption(w, i) {
    const draft = (S.ripple.draft[w.id] || '').trim();
    S.ripple.pick[w.id] = i;
    S.ripple.draft[w.id] = !draft || w.options.includes(draft) ? w.options[i] : draft + ' ' + w.options[i];
    render();
    requestAnimationFrame(() => { const el = document.getElementById('ripple-answer-' + w.id); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }
  // the answer joins the canon under the entry it's about, as the author's own unless most of its
  // words are one of Claude's answers; and it can ripple in turn
  function answerWay(eid, fid, w, text) {
    const src = S.canon.get(eid);
    if (!src) return;
    const name = (w.about || '').trim() || src.name;
    const found = entities().find((x) => x.name.toLowerCase() === name.toLowerCase());
    const target = found ? C.clone(found) : C.newEntity(w.kind, name, now());
    const nf = C.newFact(text, C.factOrigin(text, w.options), now());
    target.facts.push(nf);
    const rec = record(`Answered “${w.label}” on ${src.name}`, 'ripple', Object.assign(nf.origin === 'accepted' ? { kept: 1, rippleClaude: 1 } : { own: 1, rippleOwn: 1 }, found ? {} : { entries: 1 }));
    put('canon', target.id, target);
    put('canon', eid, C.setRippleStatus(S.canon.get(eid), fid, w.id, 'answered', { answer: { eid: target.id, fid: nf.id, text: nf.text } }));
    const step = rec.done();
    delete S.ripple.open[fid]; delete S.ripple.pick[w.id]; delete S.ripple.draft[w.id];
    toast(found ? `Added to ${target.name}. Where does that lead?` : `${target.name} is new in your canon. Where does that lead?`, null, [{ label: 'Ripples', run: () => rippleFact(target.id, nf.id) }, undoAction(step)]);
  }
  // where a contradiction is: the fact it breaks, or the scene
  function rippleTarget(b) {
    if (b.type === 'scene') {
      const order = chapterOrder();
      if (!S.chapters.has(b.chapter)) return h('span', { class: 'faint' }, 'That scene is gone.');
      return h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.cid = b.chapter; S.k = b.scene; savePos(); go('score'); } }, `Go to ch. ${order.indexOf(b.chapter) + 1}, scene ${b.scene + 1}`);
    }
    const t = S.canon.get(b.eid), tf = t && (t.facts || []).find((x) => x.id === b.target && !x.retired);
    if (!tf) return h('span', { class: 'faint' }, 'That fact has since been retired.');
    return h('button', { class: 'btn ghost small', type: 'button', title: tf.text, onclick: () => { const el = document.getElementById('fact-' + tf.id); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } else openEntry(t.id, { focus: 'fact-' + tf.id }); } },
      `${t.kind === 'rule' ? 'World rule' : t.name}: ${tf.text.length > 70 ? tf.text.slice(0, 67) + '…' : tf.text}` + (tf.v !== b.v ? ' (since reworded)' : ''));
  }
  // not ready to decide: the question waits in the dream inbox
  function laterWay(eid, fid, w) {
    const e = S.canon.get(eid), f = e && (e.facts || []).find((x) => x.id === fid);
    if (!e) return;
    const rec = record('Saved a question for later', 'ripple', { later: 1 });
    put('seeds', C.uid('d'), { text: `${w.question} (from ${e.name}: ${f ? f.text : ''})`, at: now(), proposals: [], askedAt: null, from: { eid, fid, way: w.id } });
    put('canon', eid, C.setRippleStatus(e, fid, w.id, 'later'));
    const step = rec.done();
    if (S.ripple.open[fid] === w.id) delete S.ripple.open[fid];
    toast('Saved in the dream inbox for later.', null, undoAction(step));
  }
  function updateFact(eid, fid, patch) {
    const e = C.clone(S.canon.get(eid));
    if (!e) return;
    e.facts = e.facts.map((f) => (f.id === fid ? Object.assign(f, patch) : f));
    const rec = record('secret' in patch ? `Changed whether a fact about ${e.name} is secret` : `Changed when a secret about ${e.name} comes out`, 'edit');
    put('canon', eid, e);
    rec.done();
  }
  async function deleteEntity(eid) {
    const e = S.canon.get(eid);
    if (!e) return;
    const uses = new Set();
    for (const f of e.facts || []) for (const p of C.dependents(S.passages, f.id)) uses.add(p.id);
    const ok = await ask({ title: `Delete ${e.name}?`, body: `${plural((e.facts || []).length, 'fact')} go with it.` + (uses.size ? ` ${plural(uses.size, 'scene')} that relied on them will be flagged.` : '') + ' You can undo it from History.', confirm: 'Delete', danger: true });
    if (!ok) return;
    const rec = record(`Deleted ${e.name}`, 'delete');
    removeDoc('canon', eid);
    if (S.plates.has(PL.plateId.entity(eid))) removeDoc('plates', PL.plateId.entity(eid));
    const map = atlasDoc();
    if (map && map.spec) {
      const sp = map.spec, gone = (x) => x.entity === eid;
      if (sp.places.some(gone) || (sp.features || []).some(gone) || sp.regions.some(gone)) {
        put('atlas', 'main', Object.assign({}, map, { spec: Object.assign({}, sp, { places: sp.places.filter((x) => !gone(x)), features: (sp.features || []).filter((x) => !gone(x)), regions: sp.regions.map((g) => (gone(g) ? Object.assign({}, g, { entity: null }) : g)) }) }), { quiet: true });
      }
    }
    for (const ch of S.chapters.values()) {
      if ((ch.cast || []).includes(eid)) {
        const c = C.clone(ch);
        c.cast = c.cast.filter((x) => x !== eid);
        delete c.threads[eid];
        put('chapters', ch.id, c, { quiet: true });
      }
    }
    const step = rec.done();
    toast(`Deleted ${e.name}.`, null, undoAction(step));
    render();
  }

  // ---------------------------------------------------------------- atlas
  // The world as a map. Claude dreams a world, or draws one around an existing canon, as a small
  // spec; InkAtlas grows the land from it. The drawn map is kept between renders, so moving,
  // zooming and choosing on it never redraws it.

  const atlasDoc = () => S.atlas.get('main') || null;
  // The spec with every name as the canon has it now: rename a place in the canon and the map follows.
  function liveSpec(spec) {
    const named = (x) => { const e = x.entity && S.canon.get(x.entity); return e ? Object.assign({}, x, { name: e.name }) : x; };
    return Object.assign({}, spec, { title: (world() || {}).title || spec.title, regions: spec.regions.map(named), places: spec.places.map(named), features: (spec.features || []).map(named) });
  }
  const stage = { key: null, el: null, painting: null, view: null };
  function atlasStage(spec) {
    const live = liveSpec(spec), key = S.wid + '|' + JSON.stringify(live);
    if (stage.key !== key && stage.painting !== key) {
      stage.painting = key;
      // drawing a world takes a moment, so it happens after this render, not during it
      setTimeout(() => {
        if (stage.painting !== key) return;
        const el = h('div', { class: 'atlas-stage', tabindex: '0', id: 'atlas-stage', 'aria-label': 'The map. Drag to move, scroll or press + and − to zoom, and choose a region or a place to read about it.' });
        if (mapArt.key !== key) keepMap(key, AT.paint(live, { id: S.wid, zoom: 1 }));
        el.innerHTML = mapArt.html;
        el.dataset.wid = S.wid;
        wireStage(el);
        if (!stage.el || stage.el.dataset.wid !== S.wid) stage.view = local.get('atlasView.' + S.wid, null);
        stage.key = key; stage.el = el; stage.painting = null;
        setView(stage.view || { x: 0, y: 0, w: AT.W });
        render();
      }, 20);
    }
    if (!stage.el || stage.el.dataset.wid !== S.wid) return h('div', { class: 'atlas-stage atlas-wait' }, h('p', null, h('span', { class: 'drop', 'aria-hidden': 'true' }), 'Drawing the map…'));
    for (const el of stage.el.querySelectorAll('.selected')) el.classList.remove('selected');
    const sel = S.atlasSel && stage.el.querySelector(`[data-id="${CSS.escape(S.atlasSel.id)}"]`);
    if (sel) sel.classList.add('selected');
    return stage.el;
  }
  function setView(v) {
    const w = Math.min(AT.W, Math.max(AT.W / 10, v.w)), hh = (w * AT.H) / AT.W;
    const x = Math.min(AT.W - w, Math.max(0, v.x)), y = Math.min(AT.H - hh, Math.max(0, v.y));
    stage.view = { x, y, w };
    const svg = stage.el && stage.el.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`);
      // names of lesser places come in as you zoom closer
      svg.dataset.z = AT.W / w < 1.6 ? '1' : AT.W / w < 2.8 ? '2' : '3';
    }
    if (S.wid) local.set('atlasView.' + S.wid, stage.view);
  }
  function zoomAt(factor, x, y) {
    const v = stage.view, hh = (v.w * AT.H) / AT.W;
    setView({ x: x - (x - v.x) / factor, y: y - (y - v.y) / factor, w: v.w / factor });
    void hh;
  }
  function zoomBy(factor) { const v = stage.view; zoomAt(factor, v.x + v.w / 2, v.y + (v.w * AT.H) / AT.W / 2); }
  function wireStage(el) {
    let drag = null;
    const toMap = (ev) => { const r = el.getBoundingClientRect(), v = stage.view, hh = (v.w * AT.H) / AT.W; return [v.x + ((ev.clientX - r.left) / r.width) * v.w, v.y + ((ev.clientY - r.top) / r.height) * hh]; };
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); const [x, y] = toMap(ev); zoomAt(ev.deltaY < 0 ? 1.2 : 1 / 1.2, x, y); }, { passive: false });
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, v: Object.assign({}, stage.view), moved: false, target: ev.target.closest && ev.target.closest('.atlas-place, .atlas-region') };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      drag.moved = true;
      el.classList.add('dragging');
      const r = el.getBoundingClientRect();
      setView({ x: drag.v.x - (dx / r.width) * drag.v.w, y: drag.v.y - (dy / r.height) * ((drag.v.w * AT.H) / AT.W), w: drag.v.w });
    });
    el.addEventListener('pointerup', () => {
      if (!drag) return;
      const { moved, target } = drag;
      drag = null;
      el.classList.remove('dragging');
      if (!moved && target) chooseOnMap(target.classList.contains('atlas-place') ? 'place' : 'region', target.dataset.id);
    });
    el.addEventListener('pointercancel', () => { drag = null; el.classList.remove('dragging'); });
    el.addEventListener('keydown', (ev) => {
      const v = stage.view, step = v.w * 0.1, move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (move) { ev.preventDefault(); setView({ x: v.x + move[0], y: v.y + move[1], w: v.w }); }
      else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomBy(1.25); }
      else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); zoomBy(0.8); }
      else if (ev.key === '0') { ev.preventDefault(); setView({ x: 0, y: 0, w: AT.W }); }
      else if (ev.key === 'Escape' && S.atlasSel) { S.atlasSel = null; render(); }
    });
  }
  function chooseOnMap(type, id) {
    S.atlasSel = id ? { type, id } : null;
    render();
  }

  function atlasView() {
    const doc = atlasDoc();
    if (!doc || !doc.spec) return atlasEmpty();
    const spec = doc.spec;
    const tools = h('div', { class: 'atlas-tools' },
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.4) }, '+'),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.4) }, '−'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => setView({ x: 0, y: 0, w: AT.W }) }, 'Whole map'),
      h('span', { class: 'faint' }, 'Drag to move. Scroll to zoom: lesser places are named as you come closer.'));
    return h('div', { class: 'atlas-view' }, h('div', { class: 'atlas-main' }, atlasStage(spec), tools), atlasPanel(spec));
  }
  const liveFacts = (e) => (e ? (e.facts || []).filter((f) => !f.retired).map((f) => f.text) : []);
  const KIND_NAME = { capital: 'Capital', city: 'City', town: 'Town', village: 'Village', port: 'Port', fortress: 'Fortress', ruin: 'Ruin', temple: 'Temple', tower: 'Tower', mine: 'Mine', camp: 'Camp', wreck: 'Wreck', landmark: 'Landmark', range: 'Mountain range', forest: 'Forest', desert: 'Desert', marsh: 'Marsh', lake: 'Lake', river: 'River', chasm: 'Chasm', volcano: 'Volcano', plain: 'Plain', bay: 'Bay', island: 'Island' };
  function atlasPanel(spec) {
    const w = world(), live = liveSpec(spec), sel = S.atlasSel;
    const panel = h('aside', { class: 'atlas-panel', 'aria-label': 'About the map' });
    const add = (...parts) => panel.append(...parts.filter(Boolean));
    const regionOf = (id) => live.regions.find((g) => g.id === id);
    const placeList = (list) => h('ul', { class: 'atlas-list' }, list.map((p) => h('li', null, h('button', { class: 'linklike', type: 'button', onclick: () => chooseOnMap('place', p.id) }, p.name), h('span', { class: 'faint' }, ' ' + (KIND_NAME[p.kind] || '').toLowerCase()))));
    const factsOf = (e) => { const fs = liveFacts(e); return fs.length ? h('ul', { class: 'atlas-facts' }, fs.map((f) => h('li', null, f))) : h('p', { class: 'faint' }, 'Nothing is known about it yet.'); };
    // an entry beside the map: no picture or title of its own (the map and the panel give those), and what it's connected to opens on the map where it can
    const beside = { art: false, head: false, tools: false, compact: true, onLink: (x) => { const w = mapEntry(x); if (w) chooseOnMap(w.type, w.id); else openEntry(x.id); } };
    const back = h('button', { class: 'btn ghost small', type: 'button', onclick: () => chooseOnMap(null, null) }, '← The whole world');
    const pl = sel && sel.type === 'place' ? live.places.concat(live.features || []).find((x) => x.id === sel.id) : null;
    const rg = sel && sel.type === 'region' ? regionOf(sel.id) : null;
    if (pl) {
      const g = regionOf(pl.region), e = pl.entity && S.canon.get(pl.entity);
      add(back,
        h('p', { class: 'eyebrow' }, KIND_NAME[pl.kind] || 'Place'),
        h('h2', null, pl.name),
        g ? h('p', { class: 'muted' }, 'In ', h('button', { class: 'linklike', type: 'button', onclick: () => chooseOnMap('region', g.id) }, g.name)) : null,
        e ? entryPage(e, beside) : factsOf(e));
      return panel;
    }
    if (rg) {
      const e = rg.entity && S.canon.get(rg.entity), here = live.places.filter((p) => p.region === rg.id), feats = (live.features || []).filter((f) => f.region === rg.id);
      const busy = S.busy['explore:' + rg.id];
      add(back,
        h('p', { class: 'eyebrow' }, 'Region'),
        h('h2', null, rg.name),
        e ? entryPage(e, beside) : factsOf(e),
        busy
          ? h('div', { class: 'plate-wait' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), `Exploring ${rg.name}…`, h('button', { class: 'btn ghost small', type: 'button', onclick: () => busy.ctl.abort() }, 'Stop'))
          : aiOn() ? h('div', { class: 'btn-row' }, h('button', { class: 'btn primary small', type: 'button', onclick: () => exploreDeeper(rg.id) }, 'Explore deeper')) : null,
        h('h3', null, `Places (${here.length})`), here.length ? placeList(here) : h('p', { class: 'faint' }, 'None mapped yet.'),
        feats.length ? h('h3', null, 'Features') : null, feats.length ? placeList(feats) : null);
      return panel;
    }
    const factsCount = entities().reduce((s, x) => s + (x.facts || []).filter((f) => !f.retired).length, 0);
    add(
      h('p', { class: 'eyebrow' }, 'Atlas'),
      h('h2', null, w.title),
      w.dream ? h('blockquote', { class: 'atlas-dream' }, w.dream) : null,
      w.premise ? h('p', null, w.premise) : null,
      h('p', { class: 'faint' }, `${plural(live.regions.length, 'region')}, ${plural(live.places.length, 'place')} and ${plural(factsCount, 'fact')} in the canon.`),
      h('h3', null, 'Regions'),
      h('ul', { class: 'atlas-list' }, live.regions.map((g) => h('li', null, h('button', { class: 'linklike', type: 'button', onclick: () => chooseOnMap('region', g.id) }, g.name), h('span', { class: 'faint' }, ` ${live.places.filter((p) => p.region === g.id).length}`)))),
      h('p', { class: 'faint' }, 'Choose a region to explore it further: Claude adds the places nobody has mapped yet, and they go into the canon.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(`${slug(w.title)}-map.svg`, AT.paint(live, { id: 'save', zoom: 2 })) }, 'Save the map'),
        S.readOnly ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: redrawLand }, 'Draw the land again')));
    return panel;
  }
  function atlasEmpty() {
    const busy = S.busy.atlas;
    return h('section', { class: 'page-pad' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Atlas'),
        h('h1', null, 'This world has no map yet'),
        h('p', { class: 'muted' }, 'Claude can draw one from your canon. Every place you already have stays as it is; the land around them is filled in with regions, seas and new places. Whatever it adds goes into the canon, marked as suggested, so you can change or delete any of it.')),
      busy
        ? h('div', { class: 'plate-wait' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), 'Drawing the atlas… this can take a minute.', h('button', { class: 'btn ghost small', type: 'button', onclick: () => busy.ctl.abort() }, 'Stop'))
        : aiOn() ? h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: drawAtlas }, 'Draw the atlas'))
          : h('p', { class: 'faint' }, 'Drawing a map needs Claude. Open this page on claude.ai.'));
  }
  const randomSeed = () => 1 + Math.floor(Math.random() * 2147483646);
  // A new lie of the land for the same world: every region, place and fact stays; only the ground moves.
  async function redrawLand() {
    const doc = atlasDoc();
    if (!doc) return;
    const ok = await ask({ title: 'Draw the land again?', body: 'The coasts, mountains and rivers are drawn afresh. Every region and place stays in the world and in the canon, but each one moves to wherever it fits on the new land.', confirm: 'Draw it again' });
    if (!ok) return;
    const seed = randomSeed();
    put('atlas', 'main', Object.assign({}, doc, { spec: AT.normalizeAtlas(Object.assign({}, doc.spec, { seed }), seed) }));
  }
  async function drawAtlas() {
    if (!aiOn() || S.busy.atlas) return;
    const w = world(), open = (e) => (e.facts || []).filter((f) => !f.retired && !f.secret).map((f) => f.text);
    const places = entities().filter((e) => e.kind === 'place').map((e) => ({ name: e.name, facts: open(e).slice(0, 4) }));
    const rules = entities().filter((e) => e.kind === 'rule').flatMap(open).slice(0, 16);
    const others = entities().filter((e) => e.kind === 'faction' || e.kind === 'character').slice(0, 16).map((e) => e.name + (open(e)[0] ? ': ' + open(e)[0] : ''));
    const busy = { ctl: new AbortController() }, wid = S.wid;
    S.busy.atlas = busy;
    render();
    try {
      const json = await S.sample.json(AT.buildAtlasPrompt({ world: w, places, rules, others }), { modelTier: 'complex', signal: busy.ctl.signal, cache: false });
      const d = AT.parseDream(Object.assign({ title: w.title }, json));
      if (!d) throw { code: 'invalid_json' };
      if (S.wid !== wid) return;
      const seed = randomSeed(), made = C.atlasForWorld(d, S.canon, { now: now(), seed, title: w.title });
      for (const e of made.entities) put('canon', e.id, e, { quiet: true });
      const spec = AT.normalizeAtlas(made.atlas, seed);
      put('atlas', 'main', { spec, drawnAt: now() }, { quiet: true });
      toast(`Drew ${w.title}: ${plural(spec.regions.length, 'region')} and ${plural(spec.places.length, 'place')}. ${plural(made.entities.length, 'new entry')} joined the canon.`);
    } catch (e) { aiError(e, 'drawing the atlas'); }
    finally { delete S.busy.atlas; render(); }
  }
  async function exploreDeeper(regionId) {
    const doc = atlasDoc();
    if (!doc || !aiOn() || S.busy['explore:' + regionId]) return;
    const spec = doc.spec, region = spec.regions.find((g) => g.id === regionId);
    if (!region) return;
    const w = world(), ent = region.entity && S.canon.get(region.entity), open = (e) => (e ? (e.facts || []).filter((f) => !f.retired && !f.secret).map((f) => f.text) : []);
    const input = {
      world: w, region: (ent && ent.name) || region.name, facts: open(ent),
      places: spec.places.filter((p) => p.region === regionId).map((p) => { const pe = p.entity && S.canon.get(p.entity); return { name: pe ? pe.name : p.name, kind: p.kind, facts: open(pe).slice(1, 3) }; }),
      rules: entities().filter((e) => e.kind === 'rule').flatMap(open).slice(0, 12),
      neighbours: spec.regions.filter((g) => g.id !== regionId).map((g) => { const ge = g.entity && S.canon.get(g.entity); return (ge ? ge.name : g.name) + (open(ge)[1] ? ': ' + open(ge)[1] : ''); }),
    };
    const busy = { ctl: new AbortController() }, wid = S.wid;
    S.busy['explore:' + regionId] = busy;
    render();
    try {
      const json = await S.sample.json(AT.buildExplorePrompt(input), { modelTier: 'default', signal: busy.ctl.signal, cache: false });
      const x = AT.parseExplore(json);
      if (!x) throw { code: 'invalid_json' };
      const cur = atlasDoc();
      if (S.wid !== wid || !cur) return;
      const res = C.exploreRegion(cur.spec, regionId, x, { now: now() });
      if (!res || !res.added) { toast('Nothing new came back for that region. Try again.'); return; }
      for (const e of res.entities) put('canon', e.id, e, { quiet: true });
      const re = region.entity && S.canon.get(region.entity);
      if (re && res.regionFacts.length) put('canon', re.id, Object.assign({}, re, { facts: re.facts.concat(res.regionFacts) }), { quiet: true });
      put('atlas', 'main', Object.assign({}, cur, { spec: AT.normalizeAtlas(res.atlas, cur.spec.seed) }), { quiet: true });
      toast(`Found ${plural(res.added, 'new place')} in ${input.region}.`);
    } catch (e) { aiError(e, 'exploring the region'); }
    finally { delete S.busy['explore:' + regionId]; render(); }
  }

  // ---------------------------------------------------------------- dreaming a world

  function dreamFormView() {
    const busy = S.busy.dream, draft = S.dreamDraft || {};
    const keep = (k) => (ev) => { S.dreamDraft = Object.assign({}, S.dreamDraft, { [k]: ev.target.value }); };
    return h('section', { class: 'page-pad dream-page' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Dream a world'),
        h('h1', null, 'Tell it the dream'),
        h('p', { class: 'muted' }, 'Write the dream the way it came, fragments and all. Claude grows it into a whole world: its lands and seas, its regions and peoples, places, powers and the people who matter now, drawn as a map you can explore further, one region at a time. Everything it invents goes into the canon, marked as suggested, so you can keep, change or delete any of it.')),
      busy
        ? h('div', { class: 'plate-wait' }, h('span', { class: 'drop', 'aria-hidden': 'true' }), 'Dreaming the world… this can take a minute or two.', h('button', { class: 'btn ghost small', type: 'button', onclick: () => busy.ctl.abort() }, 'Stop'))
        : h('form', { class: 'form-grid', onsubmit: (ev) => { ev.preventDefault(); dreamWorld(); } },
          h('label', { class: 'field' }, h('span', null, 'The dream'), h('textarea', { id: 'dream-text', rows: 8, 'data-keep': '', value: draft.dream || '', oninput: keep('dream'), placeholder: 'I dreamed the sea went out one night and didn’t come back…' })),
          h('label', { class: 'field' }, h('span', null, 'Anything else'), h('textarea', { id: 'dream-notes', rows: 3, 'data-keep': '', value: draft.notes || '', oninput: keep('notes'), placeholder: 'A feeling it must keep, something that has to be true, how big it is…' }), h('small', null, 'Optional.')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', type: 'submit', disabled: !aiOn() }, 'Dream it'),
            h('button', { class: 'btn', type: 'button', onclick: loadDreamExample }, 'See a dreamed world'),
            h('button', { class: 'btn ghost', type: 'button', onclick: cancelForm }, 'Cancel')),
          aiOn() ? null : h('p', { class: 'faint' }, 'Dreaming needs Claude: open this page on claude.ai to dream a world of your own. The dreamed example opens anywhere.')));
  }
  function cancelForm() {
    S.form = null;
    S.mode = S.wid ? 'studio' : (S.worlds.size ? 'studio' : 'welcome');
    if (!S.wid && S.worlds.size) chooseWorld();
    render();
  }
  async function dreamWorld() {
    const draft = S.dreamDraft || {}, dream = String(draft.dream || '').trim(), notes = String(draft.notes || '').trim();
    if (!dream) { toast('Write the dream first.', 'warn'); return; }
    if (!aiOn() || S.busy.dream) return;
    const busy = { ctl: new AbortController() };
    S.busy.dream = busy;
    render();
    try {
      const json = await S.sample.json(AT.buildDreamPrompt({ dream, notes }), { modelTier: 'complex', signal: busy.ctl.signal, cache: false });
      const d = AT.parseDream(json);
      if (!d) throw { code: 'invalid_json' };
      S.dreamDraft = null;
      makeDreamWorld(d, dream, randomSeed(), false);
    } catch (e) { aiError(e, 'dreaming the world'); }
    finally { delete S.busy.dream; render(); }
  }
  async function loadDreamExample() {
    try {
      const ex = await exampleData('dream-example.json'), d = AT.parseDream(ex.answer);
      if (!d) throw new Error('the example is damaged');
      makeDreamWorld(d, ex.dream, ex.seed || 7401, true);
    } catch (e) { toast(`Couldn't open the dreamed world (${e.message}).`, 'error'); }
  }
  function makeDreamWorld(d, dream, seed, example) {
    const made = C.worldFromDream(d, { now: now(), seed, dream });
    const spec = AT.normalizeAtlas(made.atlas, seed);
    const wid = C.uid('w'), cid = C.uid('c');
    openWorld(wid);
    S.leftOff.due = false;
    put('world', wid, Object.assign(made.world, { example: !!example, chapterOrder: [cid], createdAt: now() }), { quiet: true });
    for (const e of made.entities) put('canon', e.id, e, { quiet: true });
    put('chapters', cid, C.newChapter('Chapter one', 3, now()), { quiet: true });
    put('atlas', 'main', { spec, dreamedAt: now() }, { quiet: true });
    S.loaded = new Set(WORLD_KINDS);
    S.cid = cid; S.k = 0; S.view = 'atlas'; S.atlasSel = null;
    toast(`${made.world.title}: ${plural(spec.regions.length, 'region')}, ${plural(spec.places.length, 'place')} and ${plural(made.entities.length, 'entry', 'entries')} in the canon.`);
    render();
  }

  // ---------------------------------------------------------------- dreams view

  function dreamsView() {
    const seeds = [...S.seeds.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
    const page = h('section', { class: 'page-pad' },
      h('div', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'Dream inbox'),
        h('h1', null, 'Catch it before it fades'),
        h('p', { class: 'muted' }, 'A dream, a daydream, a line that hit you in the shower. Write it down as it came. Inkwash can suggest seeds from it: a place, a creature, a rule. Only the ones you keep join your canon.')));
    if (!S.readOnly) {
      page.append(h('form', { class: 'dream-form', onsubmit: (e) => { e.preventDefault(); const ta = e.target.querySelector('textarea'); const v = ta.value.trim(); if (!v) return; const id = C.uid('d'); put('seeds', id, { text: v, at: now(), proposals: [], askedAt: null }); ta.value = ''; } },
        h('label', { class: 'sr-only', for: 'dream-new' }, 'A new fragment'),
        h('textarea', { id: 'dream-new', 'data-keep': '', placeholder: 'I was climbing a ladder that kept growing one rung taller than the wall…' }),
        h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Catch it'))));
    }
    if (!seeds.length) page.append(h('p', { class: 'muted' }, 'No fragments yet.'));
    page.append(h('div', { class: 'dreams' }, seeds.map(dreamCard)));
    return page;
  }
  function dreamCard(d) {
    const busy = S.busy['seeds:' + d.id];
    const aiReady = !!S.sample && !S.aiOff && !S.readOnly;
    const card = h('article', { class: 'dream' },
      h('p', { class: 'faint' }, when(d.at)),
      h('p', { class: 'dream-text' }, d.text));
    for (const s of d.proposals || []) {
      card.append(h('div', { class: 'seed', 'data-status': s.status },
        h('div', null, h('p', { class: 'seed-kind' }, s.kind), h('p', null, h('strong', null, s.name + ': '), s.fact)),
        s.status === 'new' && !S.readOnly ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => keepSeed(d.id, s.id) }, 'Keep'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => setSeedStatus(d.id, s.id, 'dismissed') }, 'Dismiss'))
          : h('span', { class: 'faint' }, s.status === 'kept' ? 'Kept in canon' : s.status === 'dismissed' ? 'Dismissed' : '')));
    }
    card.append(h('div', { class: 'btn-row' },
      aiReady ? h('button', { class: 'btn small', type: 'button', disabled: !!busy, onclick: () => findSeeds(d.id) }, busy ? 'Finding seeds…' : (d.proposals || []).length ? 'Find more seeds' : 'Find seeds') : null,
      S.readOnly ? null : h('button', { class: 'btn ghost small danger', type: 'button', onclick: () => deleteDream(d.id) }, 'Delete')));
    return card;
  }
  async function findSeeds(id) {
    const d = S.seeds.get(id);
    if (!d || !S.sample || S.busy['seeds:' + id]) return;
    const busy = { ctl: new AbortController() };
    S.busy['seeds:' + id] = busy;
    render();
    try {
      const json = await S.sample.json(C.buildSeedPrompt({ world: world(), fragment: d.text, names: entities().map((e) => e.name) }), { modelTier: 'quick', signal: busy.ctl.signal, cache: false });
      const found = C.parseSeeds(json);
      const cur = S.seeds.get(id);
      if (cur) put('seeds', id, Object.assign({}, cur, { proposals: (cur.proposals || []).concat(found).slice(-15), askedAt: now() }));
      if (!found.length) toast('No seeds came back for that fragment. Try again, or add more of what you saw.');
    } catch (e) { aiError(e, 'finding seeds'); }
    finally { delete S.busy['seeds:' + id]; render(); }
  }
  function setSeedStatus(id, sid, status) {
    const d = S.seeds.get(id);
    if (!d) return;
    put('seeds', id, Object.assign({}, d, { proposals: d.proposals.map((s) => (s.id === sid ? Object.assign({}, s, { status }) : s)) }));
  }
  function keepSeed(id, sid) {
    const d = S.seeds.get(id);
    const s = d && d.proposals.find((x) => x.id === sid);
    if (!s) return;
    const rec = record(`Kept a seed: ${s.name}`, 'keep', { kept: 1 });
    const r = addFactTo(s.name, s.fact, s.kind);
    setSeedStatus(id, sid, 'kept');
    keptToast(r, rec.done());
  }
  async function deleteDream(id) {
    const ok = await ask({ title: 'Delete this fragment?', body: 'Anything you already kept stays in your canon.', confirm: 'Delete', danger: true });
    if (ok) { removeDoc('seeds', id); render(); }
  }

  // ---------------------------------------------------------------- toasts, questions, announcements

  // `action`: one { label, run }, or several
  function toast(message, kind, action) {
    const root = $('#toasts');
    if (!root) return;
    const actions = (Array.isArray(action) ? action : [action]).filter(Boolean);
    const el = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, h('p', null, message),
      actions.map((a) => h('button', { class: 'btn small', type: 'button', onclick: () => { el.remove(); a.run(); } }, a.label)),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, '×'));
    root.append(el);
    while (root.children.length > 3) root.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'error' ? 12000 : action ? 10000 : 5000);
  }
  function announce(message) {
    let live = $('#sr-live');
    if (!live) { live = h('div', { id: 'sr-live', class: 'sr-only', 'aria-live': 'polite' }); document.body.append(live); }
    live.textContent = message;
  }
  // The viewer never shows confirm(), so questions are asked on the page.
  function ask({ title, body, confirm, danger }) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      const prev = document.activeElement;
      const done = (v) => { clear(root); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      const yes = h('button', { class: 'btn ' + (danger ? 'seal' : 'primary'), type: 'button', onclick: () => done(true) }, confirm || 'OK');
      clear(root);
      root.append(h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === e.currentTarget) done(false); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
          h('h2', { id: 'modal-title' }, title),
          typeof body === 'string' ? h('p', { class: 'muted' }, body) : body || null,
          h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn ghost', type: 'button', onclick: () => done(false) }, 'Cancel')))));
      document.addEventListener('keydown', onKey);
      yes.focus();
    });
  }

  // ---------------------------------------------------------------- boot

  async function boot(hot) {
    hot = hot || {};
    S.view = hot.view || local.get('view', 'score');
    renderNow();
    const [db, user, sample, downloads] = await Promise.all(['db', 'user', 'sample', 'downloads'].map(use));
    S.user = user; S.sample = sample; S.downloads = downloads;
    let owner = null;
    if (user) { try { owner = await user.isOwner(); } catch (e) { owner = null; } }
    if (TRIAL && db && TRIAL.store !== 'shared') {
      // the platform keeps data/users/<id>/ to its person; without an id there is no private
      // place, and nothing is saved anywhere else instead
      let id = null;
      try { id = await user.id(); } catch (e) { id = null; }
      if (!id) { S.mode = 'blocked'; render(); return; }
      ROOT = `data/users/${id}/home/`;
    }
    if (user && owner === false && !TRIAL) { S.db = db; startReader(); return; }
    if (db) { S.db = db; S.persist = 'db'; }
    else { S.db = makeLocalDb(); S.persist = 'local'; }
    if (!sample) S.aiOff = window.claude ? 'Claude isn’t available in this view, so inking is off. You can still paint, write scenes yourself and set them.' : 'This copy of the page is running outside claude.ai, so inking is off. You can still paint, write scenes yourself and set them.';
    startStudio(hot);
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
  window.addEventListener('pagehide', onHide);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', () => Score.queue());
  }
  new MutationObserver(() => Score.queue()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Score.queue());

  const hotApi = window.claude && window.claude.hot;
  try { if (hotApi && typeof hotApi.snapshot === 'function') hotApi.snapshot(() => ({ view: S.view, wid: S.wid, cid: S.cid, k: S.k })); } catch (e) { /* optional */ }
  if (hotApi && typeof hotApi.ready === 'function') hotApi.ready((data) => boot(data || {}));
  else boot((hotApi && hotApi.data) || {});

  // For the end-to-end tests only: read-only access to state.
  window.__inkwash = { state: S, flush: flushAll };
})();
