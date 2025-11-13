// 這裡只用裸模組名稱，真正網址由 importmap 決定
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

console.log("Metal Viewer Web — app.js loaded");

// === DOM ===
const container = document.getElementById("viewer-container");
const statusBox = document.getElementById("status");
const metalSlider = document.getElementById("metal-slider");
const roughSlider = document.getElementById("roughness-slider");
const bgToggle = document.getElementById("bg-toggle");
const screenshotBtn = document.getElementById("screenshot-btn");

// === Renderer ===
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// === Scene & Camera ===
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.set(0, 0.7, 1.2); // 初始值，載入模型後會被自動調整

// === Controls ===
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// === Basic Light ===
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);

// === State ===
let currentModel = null;
let currentMaterialList = [];
let envMap = null;
let bgMode = 0; // 0 = HDR, 1 = 黑背景

// === 依據模型大小自動調整相機與控制器 ===
function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
  const fitOffset = 1.5; // 越大鏡頭越遠一點
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitDistance = (maxDim * fitOffset) / Math.tan(fov / 2);

  // 設定相機位置：對準中心、拉到適合距離
  camera.position.copy(center);
  camera.position.add(new THREE.Vector3(0, maxDim * 0.3, fitDistance));

  camera.near = maxDim / 100;
  camera.far  = maxDim * 20;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = maxDim * 0.1;
  controls.maxDistance = maxDim * 10;
  controls.update();
}

// === 更新材質參數 ===
function updateMaterialSettings() {
  currentMaterialList.forEach((mat) => {
    if (!mat) return;
    mat.metalness = parseFloat(metalSlider.value);
    mat.roughness = parseFloat(roughSlider.value);
    mat.needsUpdate = true;
  });
}

// === 載入 GLB ===
document.getElementById("model-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const loader = new GLTFLoader();

  statusBox.textContent = "載入 GLB 模型中...";

  loader.load(
    url,
    (gltf) => {
      if (currentModel) {
        scene.remove(currentModel);
      }

      currentModel = gltf.scene;
      scene.add(currentModel);

      // 收集所有材質
      currentMaterialList = [];
      currentModel.traverse((obj) => {
        if (obj.isMesh) {
          const mat = obj.material;
          currentMaterialList.push(mat);
          if (envMap) mat.envMap = envMap;
        }
      });

      updateMaterialSettings();
      frameObject(currentModel);   // ★ 這裡自動框景 ★

      statusBox.textContent = "模型載入完成";
      URL.revokeObjectURL(url);
    },
    undefined,
    (err) => {
      console.error(err);
      statusBox.textContent = "❌ 模型載入失敗";
    }
  );
});

// === 載入 HDR ===
document.getElementById("hdr-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const loader = new RGBELoader();

  statusBox.textContent = "載入 HDR 環境中...";

  loader.load(
    url,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;

      envMap = texture;

      if (bgMode === 0) scene.background = texture;
      scene.environment = texture;

      currentMaterialList.forEach((m) => {
        m.envMap = envMap;
        m.needsUpdate = true;
      });

      statusBox.textContent = "HDR 已載入完成";
      URL.revokeObjectURL(url);
    },
    undefined,
    (err) => {
      console.error(err);
      statusBox.textContent = "❌ HDR 載入失敗";
    }
  );
});

// === UI: sliders ===
metalSlider.addEventListener("input", updateMaterialSettings);
roughSlider.addEventListener("input", updateMaterialSettings);

// === UI: background toggle ===
bgToggle.addEventListener("click", () => {
  bgMode = (bgMode + 1) % 2;

  if (bgMode === 0) {
    bgToggle.textContent = "背景：環境";
    scene.background = envMap ? envMap : new THREE.Color(0x000000);
  } else {
    bgToggle.textContent = "背景：黑色";
    scene.background = new THREE.Color(0x000000);
  }
});

// === Screenshot ===
screenshotBtn.addEventListener("click", () => {
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "capture.png";
  a.click();
});

// === Resize ===
window.addEventListener("resize", () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// === Render loop ===
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
