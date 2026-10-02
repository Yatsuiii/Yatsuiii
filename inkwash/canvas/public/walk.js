// Walking inside a world. three.js draws the scene and Spark draws the world itself: hundreds of
// thousands of soft coloured points (Gaussian splats). World Labs stores worlds the way cameras
// see them, y down and z ahead, so each world is turned over to stand upright. You start where the
// picture was taken: W A S D or the arrow keys to walk, Shift to run, drag to look around.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, SparkControls } from '@sparkjsdev/spark';

// a soft gradient from one colour above to another below, behind everything
function haze({ top, bottom }) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256), css = (v) => `rgb(${v.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)).join(',')})`;
  grad.addColorStop(0, css(top)); grad.addColorStop(1, css(bottom));
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// One renderer serves every walk: Spark's controls listen on the page for as long as it is open.
let stage = null;
function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  scene.add(new SparkRenderer({ renderer }));
  const controls = new SparkControls({ canvas: renderer.domElement });
  return { renderer, scene, camera, controls };
}

// A world comes as a link to its file (`url`) or as the file itself (`fileBytes`, e.g. a scene
// built in this page). `bound` keeps you within that many metres of where you started, for scenes
// that are only whole from near their own viewpoint.
export async function walk(container, { url, fileBytes, fileType, scale, bound, fov, backdrop, onProgress } = {}) {
  stage = stage || setup();
  const { renderer, scene, camera, controls } = stage;
  const enable = (on) => { controls.fpsMovement.enable = on; controls.pointerControls.enable = on; };
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  // a scene made from one picture starts framed exactly on it, with a haze of its colours beyond
  camera.fov = fov > 10 && fov < 150 ? fov : 70;
  scene.background = backdrop ? haze(backdrop) : null;
  container.prepend(renderer.domElement);
  const fit = () => {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const watch = new ResizeObserver(fit);
  watch.observe(container);
  fit();

  const world = new SplatMesh(fileBytes ? { fileBytes, fileType } : { url, onProgress });
  world.quaternion.set(1, 0, 0, 0);
  // the world's own measure of a metre, when it gives one, so walking feels like walking
  if (scale > 0.01 && scale < 100) world.scale.setScalar(scale);
  scene.add(world);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    renderer.setAnimationLoop(null);
    enable(false);
    watch.disconnect();
    scene.remove(world);
    world.dispose();
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = null;
    renderer.domElement.remove();
  }
  try { await world.initialized; } catch (e) { close(); throw e; }
  if (closed) return { close, camera, world };
  enable(true);
  controls.lastTime = 0;
  renderer.setAnimationLoop(() => {
    controls.update(camera);
    if (bound > 0 && camera.position.length() > bound) camera.position.setLength(bound);
    renderer.render(scene, camera);
  });
  return { close, camera, world };
}
