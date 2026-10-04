// A place's page, floating beside the map: what kind of place it is and where, its name, and
// every fact the canon holds about it, drawn like a page of the studio's codex.
import * as THREE from 'three';

const W = 0.26, H = 0.355, PX = 1024, PY = Math.round((PX * H) / W);
const INK = '#1f232b', SOFT = '#4b5465', PAPER = '#f9f6ee', RULE = '#cdd3ca';
const KIND_WORD = { range: 'mountain range', lake: 'lake', volcano: 'volcano', chasm: 'chasm', river: 'river', forest: 'forest', desert: 'desert', marsh: 'marsh', plain: 'plain', bay: 'bay', island: 'island' };

function wrap(g, text, width) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export function makePage({ accent, worldTitle }) {
  const canvas = document.createElement('canvas');
  canvas.width = PX; canvas.height = PY;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const group = new THREE.Group();
  group.name = 'page';
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  group.add(sheet);
  group.visible = false;
  // the close button, at the page's top right, pressed like a pin
  const close = new THREE.Object3D();
  close.position.set(W / 2 - 0.024, H / 2 - 0.024, 0.004);
  group.add(close);
  const v = new THREE.Vector3();
  let shown = null;
  // where the line from the place's pin meets the page, in the page's own coordinates
  const anchor = new THREE.Vector3(-W / 2, 0, 0);

  const FONTS = {
    eyebrow: '600 32px "Alegreya Sans", "Helvetica Neue", Arial, sans-serif',
    name: '600 80px Alegreya, Georgia, serif',
    fact: '38px Alegreya, Georgia, serif',
    foot: 'italic 30px Alegreya, Georgia, serif',
  };

  // The page is as tall as what it says: it is laid out first, then drawn to that height, and
  // only that much of the canvas is shown, top-aligned under the close button.
  function draw(m) {
    const g = canvas.getContext('2d');
    const left = 72, width = PX - 2 * left;
    g.font = FONTS.name;
    const nameLines = wrap(g, m.name, width - 80);
    g.font = FONTS.fact;
    const factLines = m.facts.map((f) => wrap(g, f, width - 36));
    const factsTop = 120 + 92 + nameLines.length * 88 + 6 + 70;
    let y = factsTop, shownFacts = 0;
    for (const lines of factLines) {
      if (y + lines.length * 52 > PY - 130) break;
      y += lines.length * 52 + 22;
      shownFacts++;
    }
    const used = Math.min(PY, Math.max(Math.round(PY * 0.45), y + 70));

    g.clearRect(0, 0, PX, PY);
    // paper with an inked edge
    g.fillStyle = PAPER;
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath(); g.roundRect(4, 4, PX - 8, used - 8, 28); g.fill(); g.stroke();
    // close
    const cx = PX - 96, cy = 96;
    g.strokeStyle = SOFT; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 18, cy - 18); g.lineTo(cx + 18, cy + 18); g.moveTo(cx + 18, cy - 18); g.lineTo(cx - 18, cy + 18); g.stroke();
    // what and where
    y = 120;
    g.fillStyle = accent;
    g.font = FONTS.eyebrow;
    const kind = m.type === 'feature' ? KIND_WORD[m.kind] || m.kind : m.kind;
    g.fillText(`${kind} · ${m.region}`.toUpperCase(), left, y);
    // the name
    y += 92;
    g.fillStyle = INK;
    g.font = FONTS.name;
    for (const line of nameLines) { g.fillText(line, left, y); y += 88; }
    y += 6;
    g.strokeStyle = RULE; g.lineWidth = 3;
    g.beginPath(); g.moveTo(left, y); g.lineTo(PX - left, y); g.stroke();
    y += 70;
    // its facts, as the canon keeps them
    g.font = FONTS.fact;
    for (const lines of factLines.slice(0, shownFacts)) {
      g.fillStyle = accent;
      g.beginPath(); g.arc(left + 8, y - 12, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK;
      for (const line of lines) { g.fillText(line, left + 36, y); y += 52; }
      y += 22;
    }
    g.fillStyle = SOFT;
    g.font = FONTS.foot;
    const more = m.facts.length - shownFacts;
    g.fillText(more > 0 ? `and ${more} more in the canon of ${worldTitle}` : `From the canon of ${worldTitle}`, left, used - 52);

    const f = used / PY;
    tex.repeat.set(1, f);
    tex.offset.set(0, 1 - f);
    tex.needsUpdate = true;
    sheet.scale.y = f;
    sheet.position.y = H / 2 - (H * f) / 2;
    anchor.set(-W / 2, H / 2 - H * f * 0.35, 0);
  }

  return {
    group,
    get shown() { return shown; },
    show(m) { shown = m; draw(m); group.visible = true; },
    hide() { shown = null; group.visible = false; },
    closeTarget() {
      if (!group.visible) return null;
      close.getWorldPosition(v);
      return { id: '#close', p: { x: v.x, y: v.y, z: v.z }, r: 0.022 };
    },
    size: { W, H },
    anchor,
  };
}
