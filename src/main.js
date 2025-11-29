import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ==========================================
// 0. 动态加载奢华字体 (Google Fonts: Cinzel)
// ==========================================
const fontLink = document.createElement('link');
fontLink.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap';
fontLink.rel = 'stylesheet';
document.head.appendChild(fontLink);

// ==========================================
// 1. 核心 GPU 动画逻辑
// ==========================================
const globalUniforms = {
    uExpansion: { value: 0.0 } 
};

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
                return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                            oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                            oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                            0.0,                                0.0,                                0.0,                                1.0);
            }
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            float progress = uExpansion * aSpeed;
            vec3 offset = aDirection * progress * 7.0; 
            transformed += offset;
            
            if (progress > 0.01) {
                mat4 rot = rotationMatrix(aRotationAxis, progress * 2.5);
                transformed = (rot * vec4(transformed, 1.0)).xyz;
            }
            `
        );
    };
}

// ==========================================
// 2. 场景与相机
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color('#030504'); 
scene.fog = new THREE.FogExp2('#030504', 0.02);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 18); 

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- 灯光 ---
const ambientLight = new THREE.AmbientLight('#112211', 0.6); 
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight('#FFDDAA', 2.2);
mainLight.position.set(6, 8, 8);
mainLight.castShadow = true;
scene.add(mainLight);

const rimLight = new THREE.SpotLight('#6688AA', 2.0); 
rimLight.position.set(-10, 5, -5);
rimLight.lookAt(0, 0, 0);
scene.add(rimLight);

const bottomLight = new THREE.PointLight('#AA8866', 1.0, 10);
bottomLight.position.set(0, -6, 2);
scene.add(bottomLight);

const treeGroup = new THREE.Group();
treeGroup.scale.set(0.75, 0.75, 0.75); 
treeGroup.position.y = -4.0; // 稍微往上提一点点，给文字留空间
scene.add(treeGroup);


// ==========================================
// 3. 资产生成
// ==========================================

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

// --- A. 【重点】柔光五角星 (Soft 5-Pointed Star) ---
// 1. 绘制五角星形状
const starShape = new THREE.Shape();
const points = 5;
const outerRadius = 0.8;
const innerRadius = 0.35; // 胖一点的星星，看起来更可爱软糯
for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? outerRadius : innerRadius;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2; // 旋转90度让尖角朝上
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) starShape.moveTo(x, y);
    else starShape.lineTo(x, y);
}
starShape.closePath();

// 2. 挤压出厚度，并添加圆角 (Bevel)
const starGeo = new THREE.ExtrudeGeometry(starShape, {
    depth: 0.3,          // 厚度
    bevelEnabled: true,  // 【关键】开启倒角
    bevelThickness: 0.1, // 倒角厚度
    bevelSize: 0.1,      // 倒角延伸
    bevelSegments: 5     // 【关键】段数越高，边缘越圆润
});
starGeo.center(); // 居中几何体

const starMat = new THREE.MeshStandardMaterial({
    color: '#FFFDEE',
    emissive: '#FFCC66',    // 暖金色自发光
    emissiveIntensity: 0.8, // 柔光强度
    roughness: 0.4,         // 磨砂感，漫反射光线
    metalness: 0.6
});

const topStar = new THREE.Mesh(starGeo, starMat);
topStar.position.y = 11.2;
treeGroup.add(topStar);


// --- B. 祖母绿针叶 ---
const NEEDLE_COUNT = 20000; 
const needleGeo = new THREE.ConeGeometry(0.06, 0.25, 3);
const needleMat = new THREE.MeshStandardMaterial({
    color: '#042818',     
    roughness: 0.85,       
    metalness: 0.05,       
});
setupExplosionMaterial(needleMat); 

const needleMesh = new THREE.InstancedMesh(needleGeo, needleMat, NEEDLE_COUNT);
needleMesh.receiveShadow = true;
treeGroup.add(needleMesh);

const dummy = new THREE.Object3D();
const needleDirs = [];

for (let i = 0; i < NEEDLE_COUNT; i++) {
    const y = Math.pow(Math.random(), 1.6) * 11; 
    const maxR = 3.6 * (1 - y / 11.5) + 0.3;
    const r = (Math.random() * 0.6 + 0.4) * maxR;
    const angle = Math.random() * Math.PI * 2;
    
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    
    dummy.position.set(x, y, z);
    dummy.lookAt(0, y, 0); 
    dummy.rotateX(Math.PI / 2 + 0.35);
    
    const s = Math.random() * 0.5 + 0.5;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    needleMesh.setMatrixAt(i, dummy.matrix);
    needleDirs.push({x, y, z});
}
fillAttributes(needleGeo, NEEDLE_COUNT, (i, v) => v.set(needleDirs[i].x, needleDirs[i].y*0.1, needleDirs[i].z).normalize(), () => Math.random()*0.5+0.2);


// --- C. 柔光奶油珍珠 ---
const PEARL_COUNT = 700;
const pearlGeo = new THREE.SphereGeometry(0.12, 32, 32); 
const pearlMat = new THREE.MeshStandardMaterial({
    color: '#FFF0E0',    
    roughness: 0.7,      
    metalness: 0.1,      
    emissive: '#443322', 
    emissiveIntensity: 0.3, 
});
setupExplosionMaterial(pearlMat);

const pearlMesh = new THREE.InstancedMesh(pearlGeo, pearlMat, PEARL_COUNT);
pearlMesh.castShadow = true;
treeGroup.add(pearlMesh);
const pearlDirs = [];

for(let i=0; i<PEARL_COUNT; i++) {
    const y = Math.random() * 10;
    const r = (3.6 * (1 - y/11.5) + 0.3) * (0.92 + Math.random()*0.15); 
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0,0,0);
    const s = Math.random() * 0.3 + 0.7; 
    dummy.scale.set(s,s,s);
    dummy.updateMatrix();
    pearlMesh.setMatrixAt(i, dummy.matrix);
    pearlDirs.push({x, y, z});
}
fillAttributes(pearlGeo, PEARL_COUNT, (i, v) => v.set(pearlDirs[i].x, pearlDirs[i].y-5, pearlDirs[i].z).normalize(), () => Math.random()*0.8+0.5);


// --- D. 香槟金丝带 ---
const RIBBON_COUNT = 2500; 
const ribbonGeo = new THREE.BoxGeometry(0.12, 0.02, 0.3);
const ribbonMat = new THREE.MeshStandardMaterial({
    color: '#FFDD88',     
    roughness: 0.2,       
    metalness: 0.8,       
    transparent: true,    
    opacity: 0.7,         
    side: THREE.DoubleSide,
    depthWrite: false,    
    blending: THREE.AdditiveBlending 
});
setupExplosionMaterial(ribbonMat);

const ribbonMesh = new THREE.InstancedMesh(ribbonGeo, ribbonMat, RIBBON_COUNT);
treeGroup.add(ribbonMesh);
const ribbonDirs = [];

for (let i = 0; i < RIBBON_COUNT; i++) {
    const t = i / RIBBON_COUNT;
    const turns = 5.5;
    const y = t * 10.5;
    const r = 4.0 * (1 - y / 11.5) + 0.5; 
    const angle = t * Math.PI * 2 * turns;
    const x = Math.cos(angle) * r + (Math.random()-0.5)*0.2;
    const z = Math.sin(angle) * r + (Math.random()-0.5)*0.2;
    dummy.position.set(x, y, z);
    const targetX = Math.cos(angle + 0.1) * r;
    const targetZ = Math.sin(angle + 0.1) * r;
    dummy.lookAt(targetX, y + 0.5, targetZ);
    dummy.scale.set(1, 1, Math.random() * 0.5 + 1.0);
    dummy.updateMatrix();
    ribbonMesh.setMatrixAt(i, dummy.matrix);
    ribbonDirs.push({x, z});
}
fillAttributes(ribbonGeo, RIBBON_COUNT, (i, v) => v.set(ribbonDirs[i].x, 0, ribbonDirs[i].z).normalize(), () => Math.random() * 0.5 + 0.8);


// --- E. 银色碎钻 ---
const SILVER_COUNT = 1000;
const silverGeo = new THREE.OctahedronGeometry(0.06, 0); 
const silverMat = new THREE.MeshStandardMaterial({
    color: '#FFFFFF',
    roughness: 0.1,
    metalness: 1.0,
    emissive: '#222233',
    emissiveIntensity: 0.5
});
setupExplosionMaterial(silverMat);

const silverMesh = new THREE.InstancedMesh(silverGeo, silverMat, SILVER_COUNT);
treeGroup.add(silverMesh);
const silverDirs = [];

for(let i=0; i<SILVER_COUNT; i++) {
    const y = Math.random() * 11;
    const r = (3.6 * (1 - y/11.5)) * (Math.random()*0.5 + 0.5); 
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    dummy.position.set(x, y, z);
    dummy.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    const s = Math.random() * 0.5 + 0.5;
    dummy.scale.set(s,s,s);
    dummy.updateMatrix();
    silverMesh.setMatrixAt(i, dummy.matrix);
    silverDirs.push({x, y, z});
}
fillAttributes(silverGeo, SILVER_COUNT, (i, v) => v.set(silverDirs[i].x, silverDirs[i].y-5, silverDirs[i].z).normalize(), () => Math.random() * 1.2 + 0.5);


// ==========================================
// 4. 插入奢华电影感字幕 (HTML/CSS)
// ==========================================
const textContainer = document.createElement('div');
textContainer.style.position = 'absolute';
textContainer.style.bottom = '10%';
textContainer.style.left = '50%';
textContainer.style.transform = 'translateX(-50%)';
textContainer.style.textAlign = 'center';
textContainer.style.pointerEvents = 'none'; // 让鼠标能穿透文字控制3D
textContainer.style.width = '100%';
document.body.appendChild(textContainer);

const greeting = document.createElement('div');
greeting.innerHTML = "Merry Christmas";
// CSS 样式：奢华电影感
greeting.style.fontFamily = "'Cinzel', serif"; // 加载的谷歌字体
greeting.style.fontSize = 'min(4rem, 8vw)'; // 响应式大小
greeting.style.fontWeight = '700';
greeting.style.letterSpacing = '0.2em'; // 宽字间距，高级感来源
greeting.style.textTransform = 'uppercase';

// 核心：流金渐变色 + 阴影
greeting.style.background = "linear-gradient(to bottom, #cfc09f 0%, #ffecb3 40%, #a67c00 100%)";
greeting.style.webkitBackgroundClip = "text";
greeting.style.webkitTextFillColor = "transparent";
greeting.style.filter = "drop-shadow(0px 0px 10px rgba(255, 200, 100, 0.4))"; // 发光阴影
greeting.style.opacity = '0';
greeting.style.transition = 'opacity 2s ease-in-out';

const subTitle = document.createElement('div');
subTitle.innerHTML = "WISHING YOU A LUXURIOUS HOLIDAY";
subTitle.style.fontFamily = "'Cinzel', serif";
subTitle.style.fontSize = 'min(1rem, 3vw)';
subTitle.style.color = '#889988'; // 灰绿色，呼应背景
subTitle.style.letterSpacing = '0.5em';
subTitle.style.marginTop = '10px';
subTitle.style.opacity = '0';
subTitle.style.transition = 'opacity 2s ease-in-out 0.5s'; // 延迟显示

textContainer.appendChild(greeting);
textContainer.appendChild(subTitle);

// 页面加载后淡入文字
setTimeout(() => {
    greeting.style.opacity = '1';
    subTitle.style.opacity = '1';
}, 500);


// ==========================================
// 5. 后期处理
// ==========================================
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,  
    0.4,  
    0.85  
);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);


// ==========================================
// 6. 交互与动画
// ==========================================
let targetScroll = 0;
let currentScroll = 0;

window.addEventListener('wheel', (e) => {
    targetScroll += e.deltaY * 0.0015;
    targetScroll = Math.max(0, Math.min(targetScroll, 5.0));
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false; 
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.minPolarAngle = Math.PI / 3; 
controls.maxPolarAngle = Math.PI / 1.8;

function animate() {
    requestAnimationFrame(animate);

    currentScroll += (targetScroll - currentScroll) * 0.05;
    globalUniforms.uExpansion.value = currentScroll;

    const time = performance.now() * 0.0003;
    treeGroup.rotation.y = time * 0.2;
    ribbonMesh.rotation.y = time * 0.05; 

    // 星星旋转
    topStar.rotation.y = -time * 0.5;
    // 星星悬浮动画
    topStar.position.y = 11.2 + Math.sin(time * 2) * 0.15;
    // 星星随爆炸上升
    topStar.position.y += currentScroll * 2.5; 

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