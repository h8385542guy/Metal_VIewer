// app.js
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/RGBELoader.js";

const container = document.getElementById("viewer-container");
const statusEl = document.getElementById("status");
const modelInput = document.getElementById("model-input");
const hdrInput = document.getElementById("hdr-input");
const screenshotBtn = document.getElementById("screenshot-btn");
const metalSlider = document.getElementById("metal-slider");
const roughnessSlider = document.getElementById("roughness-slider");
const bgToggleBtn = document.getElementById("bg-toggle");

let scene, camera, renderer, controls;
let currentEnvMap = null;
let currentModel = null;
let useEnvBackground = true;

init();
animate();

function init() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
  camera.position.set(0, 0.15, 1.4);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // 匯出 PNG 用
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.3;
  controls.maxDistance = 3;
  controls.target.set(0, 0.1, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.4);
  scene.add(hemi);

  window.addEventListener("resize", onWindowResize);

  bindUI();
}

function onWindowResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function bindUI() {
  modelInput.addEventListener("change", handleModelFile);
  hdrInput.addEventListener("change", handleHDRFile);
  screenshotBtn.addEventListener("click", handleScreenshot);
  metalSlider.addEventListener("input", updateMaterialParams);
  roughnessSlider.addEventListener("input", updateMaterialParams);
  bgToggleBtn.addEventListener("click", toggleBackground);
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

// －－ 載入 GLB 模型 －－
function handleModelFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  setStatus("載入模型中…");

  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      if (currentModel) scene.remove(currentModel);

      currentModel = gltf.scene;

      autoCenterAndScale(currentModel);
      applyMetalMaterial(currentModel);

      scene.add(currentModel);
      setStatus(`模型已載入：${file.name}`);
      URL.revokeObjectURL(url);
    },
    undefined,
    (err) => {
      console.error(err);
      setStatus("載入模型失敗，請確認檔案為 GLB/GLTF。");
      URL.revokeObjectURL(url);
    }
  );
}

// －－ 載入 HDR 環境圖 －－
function handleHDRFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  setStatus("載入 HDR 環境圖中…");

  const rgbeLoader = new RGBELoader();
  rgbeLoader.load(
    url,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;

      if (currentEnvMap) {
        currentEnvMap.dispose?.();
      }
      currentEnvMap = texture;

      scene.environment = currentEnvMap;
      if (useEnvBackground) {
        scene.background = currentEnvMap;
      }

      if (currentModel) {
        applyMetalMaterial(currentModel);
      }

      setStatus(`環境圖已載入：${file.name}`);
      // 不要馬上 revoke，讓 texture 還能用
      // URL.revokeObjectURL(url);  // 可選：若發現問題再開
    },
    undefined,
    (err) => {
      console.error(err);
      setStatus("載入 HDR 失敗，請確認檔案為 .hdr 或 .exr。");
      URL.revokeObjectURL(url);
    }
  );
}

// －－ 模型置中＋縮放 －－
function autoCenterAndScale(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object.position.x += -center.x;
  object.position.y += -center.y + size.y * 0.02;
  object.position.z += -center.z;

  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 0.6 / maxDim;
    object.scale.setScalar(scale);
  }
}

// －－ 套用金屬材質參數 －－
function applyMetalMaterial(root) {
  const metalness = parseFloat(metalSlider.value);
  const roughness = parseFloat(roughnessSlider.value);

  root.traverse((child) => {
    if (child.isMesh) {
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => tweakPBR(m, metalness, roughness));
      } else {
        tweakPBR(mat, metalness, roughness);
      }
    }
  });
}

function tweakPBR(material, metalness, roughness) {
  if (!material || !("metalness" in material) || !("roughness" in material)) return;

  material.metalness = metalness;
  material.roughness = roughness;

  material.envMapIntensity = currentEnvMap ? 1.2 : 0.4;
  material.needsUpdate = true;
}

// －－ slider 更新 －－
function updateMaterialParams() {
  if (currentModel) {
    applyMetalMaterial(currentModel);
    setStatus(`金屬感：${metalSlider.value}   粗糙度：${roughnessSlider.value}`);
  }
}

// －－ 背景切換：環境 / 黑色 －－
function toggleBackground() {
  useEnvBackground = !useEnvBackground;
  if (useEnvBackground && currentEnvMap) {
    scene.background = currentEnvMap;
    bgToggleBtn.textContent = "背景：環境";
  } else {
    scene.background = new THREE.Color(0x000000);
    bgToggleBtn.textContent = "背景：黑色";
  }
}

// －－ 匯出 PNG 截圖 －－
function handleScreenshot() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");

  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = dataURL;
  a.download = `metal-viewer-${ts}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setStatus("已匯出 PNG 截圖。");
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
