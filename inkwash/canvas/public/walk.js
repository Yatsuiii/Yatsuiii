// Walking inside a world. three.js draws the scene and Spark draws the world itself: hundreds of
// thousands of soft coloured points (Gaussian splats). World Labs stores worlds the way cameras
// see them, y down and z ahead, so each world is turned over to stand upright. You start where the
// picture was taken: W A S D or the arrow keys to walk, Shift to run, drag to look around.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, SparkControls } from '@sparkjsdev/spark';

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

export async function walk(container, { url, scale, onProgress } = {}) {
  stage = stage || setup();
  const { renderer, scene, camera, controls } = stage;
  const enable = (on) => { controls.fpsMovement.enable = on; controls.pointerControls.enable = on; };
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
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

  const world = new SplatMesh({ url, onProgress });
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
    renderer.domElement.remove();
  }
  try { await world.initialized; } catch (e) { close(); throw e; }
  if (closed) return { close, camera, world };
  enable(true);
  controls.lastTime = 0;
  renderer.setAnimationLoop(() => {
    controls.update(camera);
    renderer.render(scene, camera);
  });
  return { close, camera, world };
}
