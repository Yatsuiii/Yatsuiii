// The diorama as three.js objects: a paper board, the land rising out of the ink map, and a pin
// for every place, with its name standing above it. Everything is in metres.
import * as THREE from 'three';

const INK = 0x1f232b, WATER = 0x2f4b63, PAPER = 0xd9cdb2, LAND = '#f5efdf';

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function labelSprite(text, { size = 0.014, color = '#1f232b', weight = 600 } = {}) {
  const font = `${weight} 64px Alegreya, Georgia, serif`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = 96;
  g.font = font;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = LAND;
  g.strokeText(text, 20, 50);
  g.fillStyle = color;
  g.fillText(text, 20, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
  sprite.scale.set((size * w) / 96, size, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 2;
  return sprite;
}

export function makeBoard(dio, mapTexture, { maxAnisotropy = 4 } = {}) {
  const group = new THREE.Group();
  group.name = 'board';
  const { width, depth, grid } = dio;
  const accent = new THREE.Color(dio.accent);

  // the paper block the map is mounted on, its edges inked
  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 0.024, 0.026, depth + 0.024), new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.92 }));
  base.position.y = -0.0134;
  group.add(base);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 }));
  edges.position.copy(base.position);
  group.add(edges);

  // the land: the ink map draped over its own relief
  const geo = new THREE.PlaneGeometry(width, depth, grid.cols - 1, grid.rows - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, grid.heights[k]);
  geo.computeVertexNormals();
  mapTexture.anisotropy = maxAnisotropy;
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: mapTexture, roughness: 0.96, metalness: 0 }));
  terrain.name = 'terrain';
  terrain.scale.y = 0.001;
  group.add(terrain);

  // a pin for each place: an ink stem and a head; capitals and cities in the world's colour,
  // features of the land as small diamonds in the colour of water
  const stemGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 6);
  const ball = new THREE.SphereGeometry(1, 18, 12);
  const diamond = new THREE.OctahedronGeometry(1, 0);
  const inkMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 });
  const markers = dio.markers.map((m) => {
    const pin = new THREE.Group();
    pin.name = 'pin:' + m.name;
    pin.position.set(m.x, m.y, m.z);
    const stemH = 0.014 + m.rank * 0.0055, r = 0.0042 + m.rank * 0.0012;
    const stem = new THREE.Mesh(stemGeo, inkMat);
    stem.scale.y = stemH;
    stem.position.y = stemH / 2;
    pin.add(stem);
    const color = m.type === 'feature' ? WATER : m.rank >= 2.4 ? accent.getHex() : INK;
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: accent, emissiveIntensity: 0 });
    const head = new THREE.Mesh(m.type === 'feature' ? diamond : ball, headMat);
    head.scale.setScalar(r);
    head.position.y = stemH + r * 0.8;
    pin.add(head);
    const label = labelSprite(m.name, { size: m.rank >= 2.4 ? 0.018 : 0.014, color: m.type === 'feature' ? '#2f4b63' : '#1f232b' });
    label.position.y = stemH + r * 2 + 0.003;
    label.visible = false;
    pin.add(label);
    pin.scale.setScalar(0.0001);
    pin.visible = false;
    group.add(pin);
    return { m, pin, head, label, r, hitR: Math.max(0.02, r * 2.6), headY: head.position.y, always: m.rank >= 2 };
  });

  let rise = 0, hovered = new Set(), opened = null;
  const v = new THREE.Vector3();

  return {
    group,
    terrain,
    markers,
    get rise() { return rise; },
    get risen() { return rise >= 1; },
    // start again from a flat map, as when the reader puts the headset on
    restart() {
      rise = 0;
      terrain.scale.y = 0.001;
      for (const k of markers) { k.pin.visible = false; k.pin.scale.setScalar(0.0001); k.label.visible = false; }
    },
    // the land swells out of the paper, then the pins are planted, most important first
    advance(dt) {
      if (rise >= 1) return;
      rise = Math.min(1, rise + dt / 3.2);
      terrain.scale.y = Math.max(0.001, ease(rise / 0.7));
      for (const k of markers) {
        const start = 0.62 + (3 - Math.min(3, k.m.rank)) * 0.09;
        const t = ease((rise - start) / 0.16);
        k.pin.visible = t > 0;
        k.pin.scale.setScalar(Math.max(0.0001, t));
        k.label.visible = t >= 1 && (k.always || hovered.has(k.m.id) || opened === k.m.id);
      }
    },
    setHover(ids) {
      hovered = ids;
      for (const k of markers) {
        const on = hovered.has(k.m.id) || opened === k.m.id;
        k.head.scale.setScalar(k.r * (on ? 1.4 : 1));
        k.head.material.emissiveIntensity = on ? 0.55 : 0;
        if (rise >= 1) k.label.visible = k.always || on;
      }
    },
    setOpen(id) { opened = id; this.setHover(hovered); },
    // where each pin's head is, in the world, and how near a fingertip has to come to press it
    targets() {
      return markers.filter((k) => k.pin.visible && rise >= 1).map((k) => {
        k.head.getWorldPosition(v);
        return { id: k.m.id, p: { x: v.x, y: v.y, z: v.z }, r: k.hitR };
      });
    },
    marker(id) { return markers.find((k) => k.m.id === id) || null; },
  };
}
