// Step inside any picture, on this device. An open depth model (Depth Anything V2 Small,
// Apache-2.0) runs in the browser, on the graphics card when it can, and the picture becomes a
// scene you can look around and take a few steps in. No service, no key, no cost per world. The
// library and the model are fetched once and then come from the browser's cache.
import { splatsFromDepth, toPly } from './depth3d.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = 'onnx-community/depth-anything-v2-small';
let estimator = null;

async function depthModel(say) {
  if (estimator) return estimator;
  say('Opening the depth model…');
  const { pipeline } = await import(LIB);
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  const options = adapter ? { device: 'webgpu', dtype: 'fp16' } : { device: 'wasm', dtype: 'q8' };
  estimator = await pipeline('depth-estimation', MODEL, Object.assign(options, {
    progress_callback: (p) => { if (p && p.status === 'progress' && p.total > 1e6) say(`Fetching the depth model, once… ${Math.round(p.progress)}%`); },
  }));
  return estimator;
}

// `src` must come from this page's own server, so its pixels can be read
export async function sceneFromPicture(src, { budget = 600000, say = () => {} } = {}) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const estimate = await depthModel(say);
  say('Reading how far away everything is…');
  const out = await estimate(new URL(src, location.href).href);
  const depth = out.predicted_depth, [dh, dw] = depth.dims.slice(-2);
  say('Building the scene…');
  const splats = splatsFromDepth({ rgba: data, width: canvas.width, height: canvas.height, depth: depth.data, dw, dh, budget });
  return { fileBytes: toPly(splats), fileType: 'ply', bound: splats.bound, fov: splats.vfov, backdrop: splats.backdrop, count: splats.count };
}
