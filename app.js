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
let pmremGenerator;
let currentEnvMap = null;
let currentModel = null;
let useEnvBackground = true;

// 初始化 three.js 場景
init();
animate();

function init() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
  camera.position.set(0, 0.15, 1.4);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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

  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  // 補一點柔光，避免 HDR 太暗時全黑
  const fillLight = new THREE.HemisphereLight(0xffffff, 0x202020, 0.4);
  scene.add(fillLight);

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
  if (statusEl) {
    statusEl.textContent = text;
  }
}

// 載入 GLB 模型
function handleModelFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  setStatus("載入模型中…");

  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      if (currentModel) {
        scene.remove(currentModel);
      }

      currentModel = gltf.scene;

      // 自動置中與縮放到合適大小
      autoCenterAndScale(currentModel);

      // 套用金屬材質參數
      applyMetalMaterial(currentModel);

      scene.add(currentModel);
      setStatus(`模型已載入：${file.name}`);
      URL.revokeObjectURL(url);
    },
    undefined,
    (err) => {
      console.error(err);
      setStatus("載入模型失敗，請檢查檔案格式是否為 GLB/GLTF。");
      URL.revokeObjectURL(url);
    }
  );
}

// 載入 HDR 環境圖
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
        currentEnvMap.dispose();
      }

      currentEnvMap = pmremGenerator.fromEquirectangular(texture).texture;
      texture.dispose();

      scene.environment = currentEnvMap;
      if (useEnvBackground) {
        scene.background = currentEnvMap;
      }

      // 更新現有模型的材質 envMapIntensity
      if (currentModel) {
        applyMetalMaterial(currentModel);
      }

      setStatus(`環境圖已載入：${file.name}`);
      URL.revokeObjectURL(url);
    },
    undefined,
    (err) => {
      console.error(err);
      setStatus("載入 HDR 失敗，請確認檔案為 .hdr 或 .exr。");
      URL.revokeObjectURL(url);
    }
  );
}

// 自動置中與縮放模型
function autoCenterAndScale(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // 將模型移到原點附近（略微移高）
  object.position.x += -center.x;
  object.position.y += -center.y + size.y * 0.02;
  object.position.z += -center.z;

  // 將最大尺寸規範到約 0.6
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 0.6 / maxDim;
    object.scale.setScalar(scale);
  }
}

// 套用金屬材質（調整 metalness / roughness）
function applyMetalMaterial(root) {
  const metalness = parseFloat(metalSlider.value);
  const roughness = parseFloat(roughnessSlider.value);

  root.traverse((child) => {
    if (child.isMesh) {
      const mat = child.material;

      // 若是多層材質陣列
      if (Array.isArray(mat)) {
        mat.forEach((m) => tweakPBR(m, metalness, roughness));
      } else {
        tweakPBR(mat, metalness, roughness);
      }
    }
  });
}

function tweakPBR(material, metalness, roughness) {
  if (!material || !("metalness" in material) || !("roughness" in material)) {
    return;
  }

  material.metalness = metalness;
  material.roughness = roughness;

  // 讓反射強一點（假設環境圖有載入）
  if (currentEnvMap) {
    material.envMapIntensity = 1.2;
  } else {
    material.envMapIntensity = 0.4;
  }

  material.needsUpdate = true;
}

// 更新材質 slider
function updateMaterialParams() {
  if (currentModel) {
    applyMetalMaterial(currentModel);
    setStatus(
      `金屬感：${metalSlider.value}   粗糙度：${roughnessSlider.value}`
    );
  }
}

// 背景切換：環境 / 純黑
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

// 匯出 PNG
function handleScreenshot() {
  // 先 render 一次確保畫面最新
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
