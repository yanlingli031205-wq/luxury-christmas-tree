import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap'; // 引入 GSAP 做丝滑动画 (Three.js 标配搭档)
// 如果没有安装gsap，请运行 npm install gsap，或者用简单的插值代替，
// 这里为了效果最好，我手写简单的插值函数，不需要额外安装gsap库，保证开箱即用。

// ==========================================
// 1. 全局状态与工具
// ==========================================
const state = {
    isLit: false,      // 是否已点亮
    isModalOpen: false, // 弹窗是否打开
    expansion: 0.0,    // 爆炸程度
    targetExpansion: 0.0
};

// 简单的缓动函数 (替代 GSAP 以减少依赖)
function lerp(start, end, t) {
    return start * (1 - t) + end * t;
}

// Shader 注入逻辑 (保持不变)
const globalUniforms = { uExpansion: { value: 0.0 } };
function setupExplosionMaterial(material) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uExpansion = globalUniforms.uExpansion;
        shader.vertexShader = `
            attribute vec3 aDirection;
            attribute float aSpeed;
            attribute vec3 aRotationAxis;
            uniform float uExpansion;
            mat4 rotationMatrix(vec3 axis, float angle) {
                axis = normalize(axis);
                float s = sin(angle);
                float c = cos(angle);
                float oc = 1.0 - c;
                return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
                            oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
                            oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
                            0.0, 0.0, 0.0, 1.0);
            }
        ` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float progress = uExpansion * aSpeed;
            vec3 offset = aDirection * progress * 8.0; 
            transformed += offset;
            if (progress > 0.01) {
                mat4 rot = rotationMatrix(aRotationAxis, progress * 2.5);
                transformed = (rot * vec4(transformed, 1.0)).xyz;
            }`
        );
    };
}

function fillAttributes(geometry, count, getDirFunc, getSpeedFunc) {
    const directions = [];
    const speeds = [];
    const axes = [];
    const dummyDir = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        getDirFunc(i, dummyDir);
        directions.push(dummyDir.x, dummyDir.y, dummyDir.z);
        speeds.push(getSpeedFunc(i));
        axes.push(Math.random(), Math.random(), Math.random());
    }
    geometry.setAttribute('aDirection', new THREE.InstancedBufferAttribute(new Float32Array(directions), 3));
    geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(new Float32Array(speeds), 1));
    geometry.setAttribute('aRotationAxis', new THREE.InstancedBufferAttribute(new Float32Array(axes), 3));
}

// ==========================================
// 2. 场景初始化
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000'); // 初始全黑
scene.fog = new THREE.FogExp2('#000000', 0.05);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 18);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.1; // 【关键】初始曝光极低，模拟黑夜
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

// --- 灯光系统 (初始全部关闭或极暗) ---
const ambientLight = new THREE.AmbientLight('#112211', 0.0); // 初始 0
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight('#FFDDAA', 0.0); // 初始 0
mainLight.position.set(6, 8, 8);
mainLight.castShadow = true;
scene.add(mainLight);

const rimLight = new THREE.SpotLight('#6688AA', 0.0); // 初始 0
rimLight.position.set(-10, 5, -5);
scene.add(rimLight);

const treeGroup = new THREE.Group();
treeGroup.scale.set(0.75, 0.75, 0.75);
treeGroup.position.y = -4.5;
scene.add(treeGroup);

// ==========================================
// 3. 资产生成
// ==========================================

// A. 柔光五角星 (Star) - 用于点击交互
const starShape = new THREE.Shape();
const points = 5;
for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? 0.8 : 0.4;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
}
starShape.closePath();
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 });
starGeo.center();
const starMat = new THREE.MeshStandardMaterial({
    color: '#FFFDEE', emissive: '#FFCC66', emissiveIntensity: 0.1, // 初始微光
    roughness: 0.4, metalness: 0.6
});
const topStar = new THREE.Mesh(starGeo, starMat);
topStar.position.y = 11.2;
topStar.name = "MagicStar"; // 用于射线检测
treeGroup.add(topStar);

// B. 祖母绿针叶
const NEEDLE_COUNT = 20000;
const needleGeo = new THREE.ConeGeometry(0.06, 0.25, 3);
const needleMat = new THREE.MeshStandardMaterial({ color: '#042818', roughness: 0.85, metalness: 0.05 });
setupExplosionMaterial(needleMat);
const needleMesh = new THREE.InstancedMesh(needleGeo, needleMat, NEEDLE_COUNT);
needleMesh.receiveShadow = true;
treeGroup.add(needleMesh);
const needleDirs = [];
const dummy = new THREE.Object3D();
for (let i = 0; i < NEEDLE_COUNT; i++) {
    const y = Math.pow(Math.random(), 1.6) * 11;
    const r = (Math.random() * 0.6 + 0.4) * (3.6 * (1 - y / 11.5) + 0.3);
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * r; const z = Math.sin(angle) * r;
    dummy.position.set(x, y, z);
    dummy.lookAt(0, y, 0); dummy.rotateX(Math.PI / 2 + 0.35);
    const s = Math.random() * 0.5 + 0.5; dummy.scale.set(s, s, s);
    dummy.updateMatrix(); needleMesh.setMatrixAt(i, dummy.matrix);
    needleDirs.push({x, y, z});
}
fillAttributes(needleGeo, NEEDLE_COUNT, (i,v)=>v.set(needleDirs[i].x, needleDirs[i].y*0.1, needleDirs[i].z).normalize(), ()=>Math.random()*0.5+0.2);

// C. 装饰品 (合并简化)
const DECOR_COUNT = 2000;
const ribbonGeo = new THREE.BoxGeometry(0.12, 0.02, 0.3);
const ribbonMat = new THREE.MeshStandardMaterial({ color: '#FFDD88', roughness: 0.2, metalness: 0.8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
setupExplosionMaterial(ribbonMat);
const ribbonMesh = new THREE.InstancedMesh(ribbonGeo, ribbonMat, DECOR_COUNT);
treeGroup.add(ribbonMesh);
const ribbonDirs = [];
for(let i=0; i<DECOR_COUNT; i++) {
    const t = i/DECOR_COUNT; const y = t*10.5; const r = 4.0*(1-y/11.5)+0.5; const a = t*Math.PI*2*5.5;
    const x = Math.cos(a)*r; const z = Math.sin(a)*r;
    dummy.position.set(x,y,z);
    dummy.lookAt(Math.cos(a+0.1)*r, y+0.5, Math.sin(a+0.1)*r);
    dummy.scale.set(1,1,Math.random()*0.5+1);
    dummy.updateMatrix(); ribbonMesh.setMatrixAt(i, dummy.matrix);
    ribbonDirs.push({x,z});
}
fillAttributes(ribbonGeo, DECOR_COUNT, (i,v)=>v.set(ribbonDirs[i].x, 0, ribbonDirs[i].z).normalize(), ()=>Math.random()*0.5+0.8);

// ==========================================
// 4. 后期处理
// ==========================================
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.0, 0.4, 0.85); // 初始 Bloom 为 0
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// ==========================================
// 5. 涟漪特效系统 (Golden Ripple)
// ==========================================
const ripples = [];
const ringGeo = new THREE.RingGeometry(0.1, 0.2, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true, opacity: 1.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

function createRipple(position) {
    const mesh = new THREE.Mesh(ringGeo, ringMat.clone());
    mesh.position.copy(position);
    mesh.lookAt(camera.position); // 朝向相机
    scene.add(mesh);
    ripples.push({ mesh, age: 0 });
}

// ==========================================
// 6. 文字转粒子系统 (Wish Particles)
// ==========================================
let wishParticles = null;
function createWishParticles(text) {
    if (wishParticles) {
        // 如果已有愿望，先销毁旧的
        treeGroup.remove(wishParticles);
        wishParticles.geometry.dispose();
    }

    // 1. 用 Canvas 绘制文字
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 128;
    ctx.fillStyle = 'black'; ctx.fillRect(0,0,512,128);
    ctx.font = 'bold 80px "Playfair Display", serif';
    ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    // 2. 读取像素生成粒子
    const imgData = ctx.getImageData(0,0,512,128).data;
    const particles = [];
    for(let y=0; y<128; y+=2) {
        for(let x=0; x<512; x+=2) {
            const alpha = imgData[(y*512 + x)*4]; // 只需要取颜色的一个通道，因为是黑底白字
            if(alpha > 128) {
                // 将 2D 坐标映射到 3D 空间，稍微弯曲环绕树
                const u = (x / 512 - 0.5) * 8; 
                const v = (1 - y / 128) * 2 + 5; // 悬浮在树中部
                
                particles.push({x: u, y: v, z: (Math.random()-0.5)*0.5 + 2.5}); // 放在树前
            }
        }
    }

    // 3. 创建 InstancedMesh
    const pCount = particles.length;
    const pGeo = new THREE.OctahedronGeometry(0.04, 0);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xFFD700, blending: THREE.AdditiveBlending });
    setupExplosionMaterial(pMat); // 【关键】注入爆炸逻辑

    wishParticles = new THREE.InstancedMesh(pGeo, pMat, pCount);
    treeGroup.add(wishParticles);

    const dummyP = new THREE.Object3D();
    const pDirs = [];
    const pSpeeds = [];
    
    for(let i=0; i<pCount; i++) {
        dummyP.position.set(particles[i].x, particles[i].y, particles[i].z);
        dummyP.rotation.set(Math.random(), Math.random(), Math.random());
        dummyP.updateMatrix();
        wishParticles.setMatrixAt(i, dummyP.matrix);
        
        // 爆炸方向：四散
        pDirs.push((Math.random()-0.5), (Math.random()-0.5), (Math.random()-0.5)+1.0); // 偏向屏幕外炸
        pSpeeds.push(Math.random()*2.0 + 1.0); // 飞快点
    }
    
    // 注入属性
    const pGeoBuff = wishParticles.geometry;
    fillAttributes(pGeoBuff, pCount, (i,v)=>v.set(pDirs[i*3], pDirs[i*3+1], pDirs[i*3+2]).normalize(), (i)=>pSpeeds[i]);
}


// ==========================================
// 7. 交互逻辑 (Raycaster & Events)
// ==========================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('pointerdown', (event) => {
    if (state.isModalOpen) return; // 弹窗打开时不处理

    // 1. 生成金色涟漪 (投影到3D空间较麻烦，这里简化为在点击位置前方生成)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    // 生成涟漪 (在射线前方 10 单位处)
    const ripplePos = raycaster.ray.at(10, new THREE.Vector3());
    createRipple(ripplePos);

    // 2. 检测点击星星
    const intersects = raycaster.intersectObjects([topStar]);
    if (intersects.length > 0) {
        // 点击星星 -> 打开弹窗
        openModal();
        return;
    }

    // 3. 点亮全场 (如果还没点亮)
    if (!state.isLit) {
        illuminateTree();
    }
});

// 点亮动画
function illuminateTree() {
    state.isLit = true;
    
    // 隐藏开场文字
    document.getElementById('intro-text').style.opacity = 0;
    
    // 灯光渐亮 (手动 lerp 在 animate 中处理，或使用简单的 settimeout 模拟)
    // 这里我们使用一个简单的动画对象目标值
    lightingTarget.ambient = 0.6;
    lightingTarget.main = 2.2;
    lightingTarget.rim = 2.0;
    lightingTarget.exposure = 1.2;
    lightingTarget.bloom = 1.0;
    lightingTarget.starEmissive = 1.0;
    lightingTarget.bg = new THREE.Color('#030504');
}

// 弹窗逻辑
const modal = document.getElementById('wish-modal');
const input = document.getElementById('wish-input');
const submitBtn = document.getElementById('wish-submit');
const closeBtn = document.getElementById('close-modal');

function openModal() {
    state.isModalOpen = true;
    modal.classList.add('visible');
    modal.classList.remove('hidden');
    input.focus();
}

function closeModal() {
    state.isModalOpen = false;
    modal.classList.remove('visible');
    setTimeout(() => modal.classList.add('hidden'), 500);
}

submitBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
        createWishParticles(text);
        // 特效：生成后轻微爆炸一下再收回来？或者直接显示
        closeModal();
        input.value = ''; // 清空
    }
});

closeBtn.addEventListener('click', closeModal);


// ==========================================
// 8. 动画循环
// ==========================================
const lightingCurrent = { ambient: 0, main: 0, rim: 0, exposure: 0.1, bloom: 0, starEmissive: 0.1 };
const lightingTarget = { ambient: 0, main: 0, rim: 0, exposure: 0.1, bloom: 0, starEmissive: 0.1 };

// 滚轮控制
window.addEventListener('wheel', (e) => {
    state.targetExpansion += e.deltaY * 0.002;
    state.targetExpansion = Math.max(0, Math.min(state.targetExpansion, 5.0));
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false; 
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.maxPolarAngle = Math.PI / 1.8;

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const time = clock.getElapsedTime();

    // 1. 灯光平滑过渡 (Lerp)
    const lerpSpeed = dt * 2.0;
    lightingCurrent.ambient += (lightingTarget.ambient - lightingCurrent.ambient) * lerpSpeed;
    lightingCurrent.main += (lightingTarget.main - lightingCurrent.main) * lerpSpeed;
    lightingCurrent.rim += (lightingTarget.rim - lightingCurrent.rim) * lerpSpeed;
    lightingCurrent.exposure += (lightingTarget.exposure - lightingCurrent.exposure) * lerpSpeed;
    lightingCurrent.bloom += (lightingTarget.bloom - lightingCurrent.bloom) * lerpSpeed;
    lightingCurrent.starEmissive += (lightingTarget.starEmissive - lightingCurrent.starEmissive) * lerpSpeed;

    // 应用灯光
    ambientLight.intensity = lightingCurrent.ambient;
    mainLight.intensity = lightingCurrent.main;
    rimLight.intensity = lightingCurrent.rim;
    renderer.toneMappingExposure = lightingCurrent.exposure;
    bloomPass.strength = lightingCurrent.bloom + Math.sin(time*2)*0.1; // 呼吸
    starMat.emissiveIntensity = lightingCurrent.starEmissive;

    if (state.isLit) {
        scene.background.lerp(lightingTarget.bg, 0.02);
        scene.fog.color.copy(scene.background);
    }

    // 2. 爆炸逻辑
    state.expansion += (state.targetExpansion - state.expansion) * 0.05;
    globalUniforms.uExpansion.value = state.expansion;

    // 3. 涟漪动画
    for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.age += dt;
        const scale = 1.0 + r.age * 5.0; // 快速扩大
        r.mesh.scale.set(scale, scale, 1);
        r.mesh.material.opacity = 1.0 - r.age * 1.5; // 快速消失
        if (r.mesh.material.opacity <= 0) {
            scene.remove(r.mesh);
            ripples.splice(i, 1);
        }
    }

    // 4. 物体自转
    treeGroup.rotation.y = time * 0.1;
    topStar.rotation.y = -time * 0.5;
    topStar.position.y = 11.2 + Math.sin(time * 2) * 0.15 + state.expansion * 2.5;

    controls.update();
    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();