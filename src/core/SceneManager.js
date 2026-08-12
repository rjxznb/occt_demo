import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AutoRotationManager } from '../components/AutoRotationManager.js';
import { isGlassMaterial } from '../components/WindowGlassMaterial.js';
import { createOutdoorPanoramaTexture } from '../components/OutdoorPanorama.js';
import { configureOrbitControls } from './OrbitControlPolicy.js';
import {
    clampPanoramaHorizontalFov,
    horizontalToVerticalFov,
} from './CameraFov.js';

// 主光源方向（场景为 Z 轴向上）。只表示方向，实际距离由场景尺度决定。
const KEY_LIGHT_DIR = new THREE.Vector3(100, 80, 120).normalize();

/**
 * 场景管理器 - 负责Three.js场景的初始化和管理
 */
export class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.perspectiveCamera = null;
        this.orthographicCamera = null;
        this.renderer = null;
        this.controls = null;
        this.autoRotationManager = null;
        this.composer = null;
        this.renderPass = null;
        this.gtaoPass = null;
        this.outputPass = null;
        this.outdoorPanoramaTexture = null;
        this.outdoorPanoramaState = null;
        this.materialRestorationEnabled = true;
        this.whiteModelOriginalMaterials = new Map();
        this.whiteModelMaterialCache = new Map();
        this.whiteModelOwnedMaterials = new Set();
        this.groundGrid = null;
        this.groundGridVisibleBeforeWhiteModel = null;
        this.whiteModelHiddenObjects = new Map();
        this.whiteModelLightingState = null;
        this.currentViewMode = '3d'; // '3d' 或 '2d'
        this.cameraPresetViewState = null;
        this.cameraPresetPointer = null;
        this.cameraPresetYaw = 0;
        this.cameraPresetPitch = 0;
        this.cameraPresetHorizontalFov = null;
        this._cameraPresetTransition = null;
        
        this.init();
    }

    init() {
        // 创建场景
        this.scene = new THREE.Scene();
        
        // 创建专业级背景环境
        this.setupEnvironment();

        // 创建透视相机（3D视图）
        const aspect = window.innerWidth / window.innerHeight;
        this.perspectiveCamera = new THREE.PerspectiveCamera(75, aspect, 10, 100000);
        // 场景是 Z 轴向上（户型在 XY 平面，墙体往 +Z 挤出）。相机 up 必须设为 Z，
        // 否则 OrbitControls 会绕默认的 Y 轴转，导致画面滚转、地平线不水平。
        this.perspectiveCamera.up.set(0, 0, 1);
        this.perspectiveCamera.position.set(0, -150, 100);
        
        // 创建正交相机（2D视图）
        const frustumSize = 2000;
        this.orthographicCamera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            frustumSize / -2,
            1,
            10000
        );
        this.orthographicCamera.position.set(0, 0, 100);
        this.orthographicCamera.lookAt(0, 0, 0);
        
        // 默认使用透视相机
        this.camera = this.perspectiveCamera;

        // 创建高质量渲染器
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // 启用专业级渲染特性
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // ACES Filmic：比线性映射色彩更饱满、高光过渡更自然（建筑可视化常用）
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.08;

        this.container.appendChild(this.renderer.domElement);
        this.setupCameraPresetControls();

        // 基于图像的环境光照：给 PBR 材质（墙面等）柔和的环境反射与漫反射，
        // 是提升观感最有效的一步。用内置 RoomEnvironment 生成，不需要外部贴图文件。
        this.setupEnvironmentLighting();

        // 创建控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        configureOrbitControls(this.controls);
        this.controls.target.set(0, 0, 0);
        this.controls.maxPolarAngle = Math.PI * 0.85; // 限制俯仰角度
        this.controls.minDistance = 50;    // 最近距离
        this.controls.maxDistance = 20000; // 大幅增加最远距离，适应大场景

        // 添加专业级光照系统
        this.setupProfessionalLighting();

        // 白模专用后处理；普通材质模式仍然直接渲染。
        this.setupPostProcessing();

        // 初始化自动旋转管理器
        this.initAutoRotation();

        // 监听窗口大小变化
        window.addEventListener('resize', () => this.onWindowResize());
    }

    /**
     * 设置专业级背景环境
     */
    setupEnvironment() {
        const outdoorPanorama = createOutdoorPanoramaTexture();
        if (outdoorPanorama) {
            this.outdoorPanoramaTexture = outdoorPanorama;
        }

        // 创建渐变背景
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        
        // 创建平衡的垂直渐变，既不过亮也不过暗
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#7BA7D9');    // 适中的天空蓝
        gradient.addColorStop(0.4, '#C8D6E5');  // 适中的浅蓝白
        gradient.addColorStop(0.7, '#E8E8E8');  // 适中的浅灰
        gradient.addColorStop(1, '#CCCCCC');    // 适中的灰色地面
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        const texture = new THREE.CanvasTexture(canvas);
        this.scene.background = texture;
        
        // 添加远距离雾效，只在极远处生效，避免影响正常观察距离
        this.scene.fog = new THREE.Fog(0xB8C6DB, 12000, 25000);
    }

    /**
     * 设置专业级三点照明系统
     */
    /**
     * 基于图像的环境光照（IBL）。用 three 内置的 RoomEnvironment 烘一张环境贴图，
     * 赋给 scene.environment —— PBR 材质据此得到柔和的环境漫反射和微反射，
     * 是整体观感从"死板"到"有质感"的关键一步。不依赖任何外部 HDR 文件。
     */
    setupEnvironmentLighting() {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        // 环境光的整体强度（three r155+ 支持），压低一点避免冲淡方向光的明暗
        this.scene.environmentIntensity = 0.55;
        pmrem.dispose();
    }

    setupProfessionalLighting() {
        // 光照强度按 three r155+ 的物理光照标定（旧值 0.5 在新版里明显偏暗）。
        // 暖色主光 + 冷色补光形成冷暖对比，比一片均匀白光更有立体感。

        // 1. 主光源 (Key Light) —— 暖白，负责主要明暗与投影
        // 阴影相机范围不在这里写死（户型上万毫米，硬编码盖不到），
        // 等场景建好后由 fitShadowToScene() 按实际包围盒拟合。
        const keyLight = new THREE.DirectionalLight(0xFFF4E2, 2.1);
        keyLight.position.copy(KEY_LIGHT_DIR).multiplyScalar(1000);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        this.scene.add(keyLight);
        this.scene.add(keyLight.target);
        this.keyLight = keyLight;

        // 2. 补光 (Fill Light) —— 冷调，柔化背光面的死黑，不投影
        const fillLight = new THREE.DirectionalLight(0xDCE8FF, 0.8);
        fillLight.position.set(-800, 400, 900);
        this.scene.add(fillLight);
        this.fillLight = fillLight;

        // 3. 天空/地面半球光 —— 天光偏冷、地面反光偏暖，模拟室内漫反射
        const hemiLight = new THREE.HemisphereLight(0xCFE0F5, 0xD8CFC0, 0.9);
        this.scene.add(hemiLight);
        this.hemiLight = hemiLight;

        // 4. 少量环境光兜底（env + 半球光已提供大部分环境，这里只补一点点）
        const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.15);
        this.scene.add(ambientLight);
        this.ambientLight = ambientLight;

        // 5. 地面网格
        this.createProfessionalGround();

        console.log('光照系统已设置（物理标定 + 冷暖对比）');
    }

    setupPostProcessing() {
        const width = Math.max(1, this.container?.clientWidth || window.innerWidth);
        const height = Math.max(1, this.container?.clientHeight || window.innerHeight);
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        this.composer.setSize(width, height);

        this.renderPass = new RenderPass(this.scene, this.camera);
        this.gtaoPass = new GTAOPass(
            this.scene,
            this.camera,
            width,
            height,
            undefined,
            {
                radius: 180,
                distanceExponent: 1.4,
                thickness: 450,
                distanceFallOff: 1,
                scale: 1,
                samples: 16,
                screenSpaceRadius: false,
            },
            {
                lumaPhi: 8,
                depthPhi: 2,
                normalPhi: 3,
                radius: 6,
                radiusExponent: 2,
                rings: 2,
                samples: 12,
            },
        );
        this.gtaoPass.blendIntensity = 0.58;
        this.gtaoPass.output = GTAOPass.OUTPUT.Default;
        this.gtaoPass.enabled = false;
        this.outputPass = new OutputPass();

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.gtaoPass);
        this.composer.addPass(this.outputPass);
    }

    syncPostProcessingCamera() {
        if (this.renderPass) this.renderPass.camera = this.camera;
        if (this.gtaoPass) this.gtaoPass.camera = this.camera;
    }

    /**
     * 按场景实际包围盒拟合主光源的阴影相机。
     *
     * 户型的尺度是上万毫米，而阴影相机是正交的、范围必须显式给定——写死的范围
     * （原先是 ±1000 / far=2000）只能盖住场景的百分之几，等于每帧白算一张阴影图。
     * 因此必须等几何建好、拿到真实包围盒之后再拟合。
     *
     * 场景是静态的，阴影算一次就够，故拟合后关掉 shadowMap.autoUpdate。
     *
     * @param {THREE.Box3} box - 场景包围盒（世界坐标）
     */
    fitShadowToScene(box) {
        const light = this.keyLight;
        if (!light || !box || box.isEmpty()) {
            console.warn('阴影拟合跳过：包围盒为空');
            return;
        }

        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

        // 存下场景中心/半径，供快速视角（setView）框景用
        this.sceneCenter = center.clone();
        this.sceneRadius = radius;

        // 雾按场景尺度推到模型之外：只在远处地面渐隐，任何观察角度都不会把户型糊掉。
        // （原先写死 12000~25000，斜视时相机离模型两万多毫米，正好把模型笼进雾里。）
        if (this.scene.fog) {
            this.scene.fog.near = radius * 3;
            this.scene.fog.far = radius * 8;
        }

        // 光源退到场景之外，正交阴影相机罩住整个包围球
        const distance = radius * 2.5;
        light.position.copy(center).addScaledVector(KEY_LIGHT_DIR, distance);
        light.target.position.copy(center);
        light.target.updateMatrixWorld();

        const cam = light.shadow.camera;
        cam.left = -radius;
        cam.right = radius;
        cam.top = radius;
        cam.bottom = -radius;
        cam.near = Math.max(1, distance - radius * 1.5);
        cam.far = distance + radius * 1.5;
        cam.updateProjectionMatrix();

        // bias 以世界单位（毫米）计：场景尺度大，太小的值挡不住阴影痤疮
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = Math.max(1, radius * 0.001);

        // 静态场景：阴影图渲染一次即可，不必每帧重算。
        // 场景一旦变动（拖拽、变换、增删物体），须调用 invalidateShadow()。
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.needsUpdate = true;

        console.log(`阴影相机已拟合场景：半径 ${radius.toFixed(0)}mm，光源距离 ${distance.toFixed(0)}mm`);
    }

    /**
     * 标记阴影图需要重算。
     * 因为 shadowMap.autoUpdate 被关掉了（静态场景不必每帧重算一张 2048² 的阴影图），
     * 所以任何改变场景的操作都要主动调用它，否则阴影会停留在旧状态。
     */
    invalidateShadow() {
        if (this.renderer) {
            this.renderer.shadowMap.needsUpdate = true;
        }
    }

    /**
     * 创建专业级地面
     */
    createProfessionalGround() {
        // 只创建网格线，不创建地面平面，避免中间出现多余平面
        const gridHelper = new THREE.GridHelper(20000, 400, 0x999999, 0xBBBBBB); // 适中的灰色
        // 压到地板下方 200mm。地板在 z=0，网格若也在 z=0 会与地板共面 z-fighting
        // （俯视时地板上会出现斜向网点带）。下移一点让两者在深度上分开即可。
        gridHelper.position.z = -200;
        gridHelper.rotation.x = Math.PI / 2;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.08; // 适中的透明度，既不过于突出也不太隐蔽
        gridHelper.material.depthWrite = false; // 淡网格不必写深度，避免和其他面互抢
        gridHelper.userData.isHelper = true;
        this.groundGrid = gridHelper;
        
        this.scene.add(gridHelper);
        
        console.log('已创建地面网格线（平衡调整）');
    }

    /**
     * 旧的光照设置方法 - 保留作为备用
     */
    setupLighting() {
        // 环境光
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        // 方向光
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 4000;
        directionalLight.shadow.mapSize.height = 4000;
        this.scene.add(directionalLight);

        // 补充光源
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-50, -50, 50);
        this.scene.add(fillLight);
    }

    initAutoRotation() {
        // 创建自动旋转管理器
        this.autoRotationManager = new AutoRotationManager(this, this.controls);
        console.log('自动旋转管理器已初始化');
    }


    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        
        // 更新透视相机
        this.perspectiveCamera.aspect = aspect;
        if (this.cameraPresetViewState && Number.isFinite(this.cameraPresetHorizontalFov)) {
            this.applyCameraPresetHorizontalFov(this.cameraPresetHorizontalFov);
        } else {
            this.perspectiveCamera.updateProjectionMatrix();
        }
        
        // 更新正交相机
        const frustumSize = 2000;
        this.orthographicCamera.left = frustumSize * aspect / -2;
        this.orthographicCamera.right = frustumSize * aspect / 2;
        this.orthographicCamera.top = frustumSize / 2;
        this.orthographicCamera.bottom = frustumSize / -2;
        this.orthographicCamera.updateProjectionMatrix();
        
        // 更新渲染器
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer?.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * 切换到正交视图（2D模式）
     */
    switchToOrthographicView() {
        if (this.currentViewMode === '2d') return;
        
        console.log('切换到正交视图');
        this.currentViewMode = '2d';
        this.camera = this.orthographicCamera;
        this.syncPostProcessingCamera();
        
        // 重新配置控制器
        this.controls.object = this.camera;
        this.controls.enableRotate = false; // 2D模式禁用旋转
        this.controls.screenSpacePanning = false;
        this.controls.minZoom = 0.1;
        this.controls.maxZoom = 10;
        
        // 更新相机位置
        this.camera.position.set(0, 0, 100);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /**
     * 切换到透视视图（3D模式）
     */
    switchToPerspectiveView() {
        if (this.currentViewMode === '3d') return;
        
        console.log('切换到透视视图');
        this.currentViewMode = '3d';
        this.camera = this.perspectiveCamera;
        this.syncPostProcessingCamera();
        
        // 重新配置控制器
        this.controls.object = this.camera;
        this.controls.enableRotate = true; // 3D模式启用旋转
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 50;
        this.controls.maxDistance = 20000;
        
        // 重置相机位置
        this.camera.position.set(0, -150, 100);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /**
     * 适应视图以显示所有对象
     */
    fitToView() {
        const box = new THREE.Box3();
        
        // 计算场景中所有可见对象的边界框
        this.scene.traverse((object) => {
            if (object.isMesh && object.visible) {
                box.expandByObject(object);
            }
        });
        
        if (box.isEmpty()) return;
        
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        if (this.currentViewMode === '2d') {
            // 2D模式：调整正交相机的缩放
            this.camera.position.set(center.x, center.y, 100);
            this.controls.target.copy(center);
            
            const maxDim = Math.max(size.x, size.y);
            const fov = Math.min(
                this.camera.right - this.camera.left, 
                this.camera.top - this.camera.bottom
            );
            const distance = maxDim / fov * 1.2;
            
            this.camera.zoom = 1 / distance;
            this.camera.updateProjectionMatrix();
        } else {
            // 3D模式：调整透视相机的位置
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = this.camera.fov * (Math.PI / 180);
            const distance = maxDim / (2 * Math.tan(fov / 2)) * 1.5;
            
            this.camera.position.copy(center);
            this.camera.position.z += distance;
            this.controls.target.copy(center);
        }
        
        this.controls.update();
    }

    /**
     * 快速切换到预设鸟瞰视角。保留 OrbitControls，切换后鼠标可继续从该角度旋转。
     *
     * @param {'SE'|'SW'|'NE'|'NW'|'top'} dir - 视角方向
     */
    setView(dir) {
        const center = this.sceneCenter ? this.sceneCenter.clone() : new THREE.Vector3(0, 0, 0);
        const radius = this.sceneRadius || 8000;

        // 各方向的单位向量（场景 Z 轴向上）。水平分量选角落，Z 分量决定俯角。
        const dirs = {
            SE: new THREE.Vector3( 1, -1, 1.25),
            SW: new THREE.Vector3(-1, -1, 1.25),
            NE: new THREE.Vector3( 1,  1, 1.25),
            NW: new THREE.Vector3(-1,  1, 1.25),
            top: new THREE.Vector3( 0,  0.001, 1),   // 近乎正俯视
        };
        const v = (dirs[dir] || dirs.SE).clone().normalize();

        // 75° FOV 下 ~1.8r 能把整个包围球框满，又不至于远到吃上雾效
        const distance = radius * 1.85;
        const toPos = center.clone().addScaledVector(v, distance);

        // 停掉自动旋转，否则切过去马上又被转走
        this.enableAutoRotation(false);

        // 用绕 Z 轴的球面坐标插值，而不是直线位置插值。
        // 直线插值会让相机沿两点连线（穿过球心的弦）俯冲再拉出、从顶部飞过去 → 晕；
        // 球面插值固定半径与俯角、只转方位角，相机沿圆弧平滑绕 Z 扫过去（转盘式）。
        const from = this._toZSpherical(this.camera.position, this.controls.target);
        const to = this._toZSpherical(toPos, center);

        // 方位角走最短弧；正好 180°（对面视角）时统一取正方向，绕 Z 转半圈
        let dAz = to.az - from.az;
        while (dAz > Math.PI) dAz -= Math.PI * 2;
        while (dAz < -Math.PI) dAz += Math.PI * 2;
        if (Math.abs(Math.abs(dAz) - Math.PI) < 1e-4) dAz = Math.PI;

        this._viewTween = {
            from, to, dAz,
            fromCenter: this.controls.target.clone(),
            toCenter: center,
            t: 0,
            dur: 0.6,
        };
    }

    setupCameraPresetControls() {
        const canvas = this.renderer.domElement;
        this._cameraPresetPointerDown = event => this.onCameraPresetPointerDown(event);
        this._cameraPresetPointerMove = event => this.onCameraPresetPointerMove(event);
        this._cameraPresetPointerUp = event => this.onCameraPresetPointerUp(event);
        this._cameraPresetWheel = event => this.onCameraPresetWheel(event);
        this._cameraPresetClick = event => {
            if (!this.cameraPresetViewState) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        canvas.addEventListener('pointerdown', this._cameraPresetPointerDown, true);
        canvas.addEventListener('pointermove', this._cameraPresetPointerMove, true);
        canvas.addEventListener('pointerup', this._cameraPresetPointerUp, true);
        canvas.addEventListener('pointercancel', this._cameraPresetPointerUp, true);
        canvas.addEventListener('wheel', this._cameraPresetWheel, { capture: true, passive: false });
        canvas.addEventListener('click', this._cameraPresetClick, true);
    }

    /** Enter a CAD camera preset and rotate in place instead of orbiting a target. */
    setCameraPreset(preset) {
        if (!preset) return false;
        this._cameraPresetTransition = null;
        if (!this.cameraPresetViewState) {
            const status = this.getAutoRotationStatus();
            this.cameraPresetViewState = {
                viewMode: this.currentViewMode,
                position: this.perspectiveCamera.position.clone(),
                quaternion: this.perspectiveCamera.quaternion.clone(),
                fov: this.perspectiveCamera.fov,
                target: this.controls.target.clone(),
                controlsEnabled: this.controls.enabled,
                autoRotationEnabled: status?.enabled !== false,
            };
        }
        this.switchToPerspectiveView();
        this._viewTween = null;
        this.enableAutoRotation(false);
        this.controls.enabled = false;

        const camera = this.perspectiveCamera;
        camera.up.set(0, 0, 1);
        camera.position.set(preset.x, preset.y, preset.z);
        this.applyCameraPresetHorizontalFov(
            Number.isFinite(Number(preset.fov)) ? Number(preset.fov) : 90,
        );

        this.cameraPresetYaw = THREE.MathUtils.degToRad(preset.yaw || 0);
        this.cameraPresetPitch = THREE.MathUtils.degToRad(preset.pitch || 0);
        this.updateCameraPresetOrientation();
        this.activateOutdoorPanorama();
        this.renderer.domElement.classList.add('camera-preset-active');
        return true;
    }

    /** Return the live fixed-point camera pose without exposing Three.js objects. */
    getCameraPresetPose() {
        if (!this.cameraPresetViewState) return null;
        const camera = this.perspectiveCamera;
        return {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            yaw: Number(THREE.MathUtils.radToDeg(this.cameraPresetYaw).toFixed(10)),
            pitch: Number(THREE.MathUtils.radToDeg(this.cameraPresetPitch).toFixed(10)),
            fov: Number.isFinite(this.cameraPresetHorizontalFov)
                ? this.cameraPresetHorizontalFov
                : camera.fov,
        };
    }

    /** Keep CAD/UE horizontal FOV authoritative and project it for Three.js. */
    applyCameraPresetHorizontalFov(horizontalFov) {
        const numeric = Number(horizontalFov);
        if (!Number.isFinite(numeric) || !this.perspectiveCamera) return false;
        this.cameraPresetHorizontalFov = clampPanoramaHorizontalFov(numeric);
        this.perspectiveCamera.fov = horizontalToVerticalFov(
            this.cameraPresetHorizontalFov,
            this.perspectiveCamera.aspect,
        );
        this.perspectiveCamera.updateProjectionMatrix();
        return true;
    }

    /** Smoothly move between fixed panorama points without leaving preset mode. */
    transitionCameraPreset(point, { duration = 0.8 } = {}) {
        const to = {
            x: Number(point?.x),
            y: Number(point?.y),
            z: Number(point?.z),
            yaw: Number(point?.yaw),
            pitch: Number(point?.pitch),
            fov: Number(point?.fov),
        };
        if (!Object.values(to).every(Number.isFinite)) return false;
        if (!this.cameraPresetViewState) return this.setCameraPreset(point);

        const from = this.getCameraPresetPose();
        const seconds = Number(duration);
        if (!Number.isFinite(seconds) || seconds <= 0) return this.setCameraPreset(to);

        let yawDelta = to.yaw - from.yaw;
        yawDelta = ((yawDelta + 180) % 360 + 360) % 360 - 180;
        this._cameraPresetTransition = {
            elapsed: 0,
            duration: seconds,
            from,
            to,
            yawDelta,
        };
        return true;
    }

    _updateCameraPresetTransition(deltaSeconds) {
        const transition = this._cameraPresetTransition;
        if (!transition || !this.cameraPresetViewState) return;

        const delta = Number(deltaSeconds);
        transition.elapsed = Math.min(
            transition.duration,
            transition.elapsed + (Number.isFinite(delta) ? Math.max(0, delta) : 0),
        );
        const progress = transition.elapsed / transition.duration;
        const eased = progress * progress * (3 - 2 * progress);
        const mix = (from, to) => THREE.MathUtils.lerp(from, to, eased);
        const camera = this.perspectiveCamera;

        if (progress >= 1) {
            camera.position.set(transition.to.x, transition.to.y, transition.to.z);
            this.cameraPresetYaw = THREE.MathUtils.degToRad(transition.to.yaw);
            this.cameraPresetPitch = THREE.MathUtils.degToRad(transition.to.pitch);
            this.applyCameraPresetHorizontalFov(transition.to.fov);
        } else {
            camera.position.set(
                mix(transition.from.x, transition.to.x),
                mix(transition.from.y, transition.to.y),
                mix(transition.from.z, transition.to.z),
            );
            this.cameraPresetYaw = THREE.MathUtils.degToRad(
                transition.from.yaw + transition.yawDelta * eased,
            );
            this.cameraPresetPitch = THREE.MathUtils.degToRad(
                mix(transition.from.pitch, transition.to.pitch),
            );
            this.applyCameraPresetHorizontalFov(mix(transition.from.fov, transition.to.fov));
        }
        this.updateCameraPresetOrientation();
        if (progress >= 1) this._cameraPresetTransition = null;
    }

    /** Preview a moved panorama point while keeping the current look direction by default. */
    updateCameraPresetPose(point, { resetView = false } = {}) {
        if (!this.cameraPresetViewState || !point) return false;
        this._cameraPresetTransition = null;
        const camera = this.perspectiveCamera;
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if ([x, y, z].every(Number.isFinite)) camera.position.set(x, y, z);

        if (resetView) {
            const yaw = Number(point.yaw);
            const pitch = Number(point.pitch);
            const fov = Number(point.fov);
            if (Number.isFinite(yaw)) this.cameraPresetYaw = THREE.MathUtils.degToRad(yaw);
            if (Number.isFinite(pitch)) {
                this.cameraPresetPitch = THREE.MathUtils.clamp(
                    THREE.MathUtils.degToRad(pitch),
                    -Math.PI * 0.495,
                    Math.PI * 0.495,
                );
            }
            if (Number.isFinite(fov)) {
                this.applyCameraPresetHorizontalFov(fov);
            }
        }

        this.controls.enabled = false;
        this.updateCameraPresetOrientation();
        return true;
    }

    resetCameraPresetOrientation(point) {
        return this.updateCameraPresetPose(point, { resetView: true });
    }

    activateOutdoorPanorama() {
        if (!this.scene || !this.outdoorPanoramaTexture) return false;
        if (!this.outdoorPanoramaState) {
            this.outdoorPanoramaState = {
                background: this.scene.background,
                backgroundRotation: this.scene.backgroundRotation.clone(),
            };
        }
        this.scene.background = this.outdoorPanoramaTexture;
        this.scene.backgroundRotation.set(-Math.PI / 2, 0, 0);
        return true;
    }

    restoreOutdoorPanorama() {
        const state = this.outdoorPanoramaState;
        if (!state || !this.scene) return false;
        this.scene.background = state.background;
        this.scene.backgroundRotation.copy(state.backgroundRotation);
        this.outdoorPanoramaState = null;
        return true;
    }

    updateCameraPresetOrientation() {
        if (!this.cameraPresetViewState) return;
        const camera = this.perspectiveCamera;
        const horizontal = Math.cos(this.cameraPresetPitch);
        const direction = new THREE.Vector3(
            Math.cos(this.cameraPresetYaw) * horizontal,
            Math.sin(this.cameraPresetYaw) * horizontal,
            Math.sin(this.cameraPresetPitch),
        );
        this.controls.target.copy(camera.position).addScaledVector(direction, 1000);
        camera.lookAt(this.controls.target);
    }

    onCameraPresetPointerDown(event) {
        if (!this.cameraPresetViewState || event.button !== 0) return;
        this._cameraPresetTransition = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.cameraPresetPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.classList.add('camera-preset-dragging');
    }

    onCameraPresetPointerMove(event) {
        if (!this.cameraPresetViewState || !this.cameraPresetPointer
            || event.pointerId !== this.cameraPresetPointer.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const dx = event.clientX - this.cameraPresetPointer.x;
        const dy = event.clientY - this.cameraPresetPointer.y;
        this.cameraPresetPointer.x = event.clientX;
        this.cameraPresetPointer.y = event.clientY;
        this.cameraPresetYaw -= dx * 0.0035;
        this.cameraPresetPitch = THREE.MathUtils.clamp(
            this.cameraPresetPitch - dy * 0.0035,
            -Math.PI * 0.495,
            Math.PI * 0.495,
        );
        this.updateCameraPresetOrientation();
    }

    onCameraPresetPointerUp(event) {
        if (!this.cameraPresetPointer || event.pointerId !== this.cameraPresetPointer.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        this.cameraPresetPointer = null;
        event.currentTarget.classList.remove('camera-preset-dragging');
    }

    onCameraPresetWheel(event) {
        if (!this.cameraPresetViewState) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const camera = this.perspectiveCamera;
        const horizontalFov = Number.isFinite(this.cameraPresetHorizontalFov)
            ? this.cameraPresetHorizontalFov
            : camera.fov;
        this.applyCameraPresetHorizontalFov(horizontalFov + event.deltaY * 0.025);
    }

    exitCameraPreset() {
        this._cameraPresetTransition = null;
        const saved = this.cameraPresetViewState;
        if (!saved) return false;
        this.restoreOutdoorPanorama();
        this.cameraPresetViewState = null;
        this.cameraPresetPointer = null;
        this.renderer.domElement.classList.remove('camera-preset-active', 'camera-preset-dragging');

        if (saved.viewMode === '2d') this.switchToOrthographicView();
        else this.switchToPerspectiveView();
        const camera = this.perspectiveCamera;
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        this.cameraPresetHorizontalFov = null;
        this.controls.target.copy(saved.target);
        this.enableAutoRotation(saved.autoRotationEnabled);
        this.controls.enabled = saved.controlsEnabled;
        this.controls.update();
        return true;
    }

    isCameraPresetActive() {
        return Boolean(this.cameraPresetViewState);
    }

    /** 相机位置相对目标点，转成绕 Z 轴的球面坐标 {radius, az(方位), el(俯仰)} */
    _toZSpherical(pos, target) {
        const dx = pos.x - target.x, dy = pos.y - target.y, dz = pos.z - target.z;
        const radius = Math.hypot(dx, dy, dz) || 1;
        return {
            radius,
            az: Math.atan2(dy, dx),         // XY 平面内绕 Z 的方位角
            el: Math.asin(Math.max(-1, Math.min(1, dz / radius))), // 相对 XY 平面的俯仰角
        };
    }

    /** 推进视角补间（每帧调用）。easeInOutCubic 让起止更顺。 */
    _updateViewTween(dt) {
        const tw = this._viewTween;
        if (!tw) return;

        tw.t = Math.min(1, tw.t + dt / tw.dur);
        const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2;

        // 半径、俯角线性插值；方位角沿最短弧插值 → 绕 Z 旋转
        const radius = tw.from.radius + (tw.to.radius - tw.from.radius) * e;
        const el = tw.from.el + (tw.to.el - tw.from.el) * e;
        const az = tw.from.az + tw.dAz * e;

        const center = this.controls.target;
        center.lerpVectors(tw.fromCenter, tw.toCenter, e);

        const hr = radius * Math.cos(el);
        this.camera.position.set(
            center.x + hr * Math.cos(az),
            center.y + hr * Math.sin(az),
            center.z + radius * Math.sin(el),
        );

        if (tw.t >= 1) this._viewTween = null;
    }

    /** 暂停/恢复渲染（嵌入插件时，标签页不可见就停手，别空转烧 CPU） */
    setPaused(paused) {
        this.paused = !!paused;
    }

    animate(callback = null) {
        requestAnimationFrame(() => this.animate(callback));

        // 暂停时保持 rAF 存活但跳过更新与渲染
        if (this.paused) return;

        try {
            // 视角补间（按帧间隔推进，独立于 controls）
            const now = performance.now();
            const dt = this._lastFrame ? Math.min(0.05, (now - this._lastFrame) / 1000) : 0.016;
            this._lastFrame = now;
            this._updateViewTween(dt);
            this._updateCameraPresetTransition(dt);

            if (!this.cameraPresetViewState) this.controls.update();
            
            // 执行回调函数（如FPS更新）
            if (callback && typeof callback === 'function') {
                callback();
            }
            
            if (this.gtaoPass?.enabled && this.composer) {
                this.composer.render(dt);
            } else {
                this.renderer.render(this.scene, this.camera);
            }
        } catch (error) {
            console.error('渲染错误:', error);
            // 不中断动画循环，继续尝试渲染
        }
    }

    // 添加对象到场景
    add(object) {
        this.scene.add(object);
    }

    // 从场景移除对象
    remove(object) {
        this.scene.remove(object);
    }

    // 获取场景对象
    getScene() {
        return this.scene;
    }

    // 获取相机对象
    getCamera() {
        return this.camera;
    }

    // 获取渲染器对象
    getRenderer() {
        return this.renderer;
    }

    // 获取控制器对象
    getControls() {
        return this.controls;
    }

    applyWhiteModelLighting() {
        if (this.whiteModelLightingState || !this.scene || !this.renderer) return;

        this.whiteModelLightingState = {
            background: this.scene.background,
            fogColor: this.scene.fog?.color?.clone() || null,
            environmentIntensity: this.scene.environmentIntensity,
            exposure: this.renderer.toneMappingExposure,
            keyIntensity: this.keyLight?.intensity,
            keyColor: this.keyLight?.color?.clone() || null,
            fillIntensity: this.fillLight?.intensity,
            fillColor: this.fillLight?.color?.clone() || null,
            hemiIntensity: this.hemiLight?.intensity,
            hemiSkyColor: this.hemiLight?.color?.clone() || null,
            hemiGroundColor: this.hemiLight?.groundColor?.clone() || null,
            ambientIntensity: this.ambientLight?.intensity,
        };

        // A warm, high-key clay setup: bright enough for an interior presentation,
        // but with less fill light so GTAO and cast shadows retain form definition.
        this.scene.background = new THREE.Color(0xe7e4df);
        if (this.scene.fog?.color) this.scene.fog.color.setHex(0xe7e4df);
        this.scene.environmentIntensity = 0.5;
        this.renderer.toneMappingExposure = 1.04;
        if (this.keyLight) {
            this.keyLight.color.setHex(0xfff5e8);
            this.keyLight.intensity = 2.15;
        }
        if (this.fillLight) {
            this.fillLight.color.setHex(0xe8efff);
            this.fillLight.intensity = 0.4;
        }
        if (this.hemiLight) {
            this.hemiLight.color.setHex(0xeaf1f8);
            this.hemiLight.groundColor.setHex(0xd8cfc2);
            this.hemiLight.intensity = 0.52;
        }
        if (this.ambientLight) this.ambientLight.intensity = 0.06;
        this.invalidateShadow();
    }

    restoreWhiteModelLighting() {
        const state = this.whiteModelLightingState;
        if (!state || !this.scene || !this.renderer) return;

        this.scene.background = state.background;
        if (state.fogColor && this.scene.fog?.color) this.scene.fog.color.copy(state.fogColor);
        this.scene.environmentIntensity = state.environmentIntensity;
        this.renderer.toneMappingExposure = state.exposure;
        if (this.keyLight) {
            if (state.keyColor) this.keyLight.color.copy(state.keyColor);
            this.keyLight.intensity = state.keyIntensity;
        }
        if (this.fillLight) {
            if (state.fillColor) this.fillLight.color.copy(state.fillColor);
            this.fillLight.intensity = state.fillIntensity;
        }
        if (this.hemiLight) {
            if (state.hemiSkyColor) this.hemiLight.color.copy(state.hemiSkyColor);
            if (state.hemiGroundColor) this.hemiLight.groundColor.copy(state.hemiGroundColor);
            this.hemiLight.intensity = state.hemiIntensity;
        }
        if (this.ambientLight) this.ambientLight.intensity = state.ambientIntensity;
        this.whiteModelLightingState = null;
        this.invalidateShadow();
    }

    /**
     * Toggle between authored materials and a neutral white clay render.
     * Scene.overrideMaterial keeps the real mesh materials intact, so restoring
     * them is lossless and meshes added later automatically follow this mode.
     */
    setMaterialRestorationEnabled(enabled) {
        const nextEnabled = Boolean(enabled);
        if (!this.scene) {
            this.materialRestorationEnabled = nextEnabled;
            return nextEnabled;
        }

        if (!nextEnabled && this.materialRestorationEnabled) {
            if (this.groundGrid) {
                this.groundGridVisibleBeforeWhiteModel = this.groundGrid.visible;
                this.groundGrid.visible = false;
            }
            this.whiteModelHiddenObjects.clear();
            this.scene.traverse(object => {
                if (object?.userData?.whiteModelSurfaceOverlay !== true) return;
                this.whiteModelHiddenObjects.set(object, object.visible);
                object.visible = false;
            });
            this.applyWhiteModelMaterials();
            this.applyWhiteModelLighting();
            if (this.gtaoPass) this.gtaoPass.enabled = true;
        } else if (nextEnabled && !this.materialRestorationEnabled) {
            if (this.gtaoPass) this.gtaoPass.enabled = false;
            this.restoreWhiteModelMaterials();
            this.restoreWhiteModelLighting();
            if (this.groundGrid && this.groundGridVisibleBeforeWhiteModel !== null) {
                this.groundGrid.visible = this.groundGridVisibleBeforeWhiteModel;
            }
            for (const [object, visible] of this.whiteModelHiddenObjects) {
                object.visible = visible;
            }
            this.whiteModelHiddenObjects.clear();
            this.groundGridVisibleBeforeWhiteModel = null;
        }

        this.materialRestorationEnabled = nextEnabled;
        return nextEnabled;
    }

    createWhiteModelMaterial(mesh, source) {
        if (!source?.isMaterial || isGlassMaterial(mesh, source)) return source;
        const cached = this.whiteModelMaterialCache.get(source);
        if (cached) return cached;

        const material = source.clone();
        if (material.color?.isColor) material.color.setHex(0xd2cfca);
        if ('map' in material) material.map = null;
        if ('vertexColors' in material) material.vertexColors = false;
        if ('metalness' in material) material.metalness = 0;
        if ('roughness' in material) material.roughness = 0.82;
        if ('transmission' in material) material.transmission = 0;
        if ('clearcoat' in material) material.clearcoat = 0;
        if (material.emissive?.isColor && material.emissive.getHex() !== 0) {
            material.emissive.setHex(0xffead0);
            material.emissiveIntensity = Math.min(
                Number.isFinite(source.emissiveIntensity) ? source.emissiveIntensity : 1,
                0.35,
            );
            if ('emissiveMap' in material) material.emissiveMap = null;
        }
        material.name = `${source.name || source.type || 'Material'} [WhiteModel]`;
        material.needsUpdate = true;

        this.whiteModelMaterialCache.set(source, material);
        this.whiteModelOwnedMaterials.add(material);
        return material;
    }

    applyWhiteModelMaterials(root = this.scene) {
        root?.traverse(object => {
            if (!object?.isMesh || !object.material
                || object.userData?.whiteModelSurfaceOverlay === true
                || this.whiteModelOriginalMaterials.has(object)) return;
            this.whiteModelOriginalMaterials.set(object, object.material);
            object.material = Array.isArray(object.material)
                ? object.material.map(material => this.createWhiteModelMaterial(object, material))
                : this.createWhiteModelMaterial(object, object.material);
        });
    }

    restoreWhiteModelMaterials() {
        for (const [object, material] of this.whiteModelOriginalMaterials) {
            object.material = material;
        }
        this.whiteModelOriginalMaterials.clear();
        for (const material of this.whiteModelOwnedMaterials) material.dispose();
        this.whiteModelOwnedMaterials.clear();
        this.whiteModelMaterialCache.clear();
    }

    isMaterialRestorationEnabled() {
        return this.materialRestorationEnabled;
    }

    disposeOutdoorPanorama() {
        this.restoreOutdoorPanorama();
        const texture = this.outdoorPanoramaTexture;
        if (!texture) return;
        if (this.scene?.background === texture) this.scene.background = null;
        texture.dispose();
        this.outdoorPanoramaTexture = null;
    }

    // 自动旋转管理方法
    enableAutoRotation(enabled = true) {
        if (this.autoRotationManager) {
            this.autoRotationManager.setEnabled(enabled);
        }
    }

    disableAutoRotation() {
        this.enableAutoRotation(false);
    }

    setAutoRotationIdleTime(minutes) {
        if (this.autoRotationManager) {
            this.autoRotationManager.setIdleTimeout(minutes);
        }
    }

    setAutoRotationSpeed(degreesPerSecond) {
        if (this.autoRotationManager) {
            this.autoRotationManager.setRotationSpeed(degreesPerSecond);
        }
    }

    getAutoRotationStatus() {
        return this.autoRotationManager ? this.autoRotationManager.getStatus() : null;
    }

    // 手动触发自动旋转（用于测试）
    triggerAutoRotation() {
        if (this.autoRotationManager) {
            this.autoRotationManager.triggerAutoRotation();
        }
    }

    // 销毁场景管理器
    destroy() {
        this._cameraPresetTransition = null;
        this.exitCameraPreset();
        const canvas = this.renderer?.domElement;
        canvas?.removeEventListener('pointerdown', this._cameraPresetPointerDown, true);
        canvas?.removeEventListener('pointermove', this._cameraPresetPointerMove, true);
        canvas?.removeEventListener('pointerup', this._cameraPresetPointerUp, true);
        canvas?.removeEventListener('pointercancel', this._cameraPresetPointerUp, true);
        canvas?.removeEventListener('wheel', this._cameraPresetWheel, true);
        canvas?.removeEventListener('click', this._cameraPresetClick, true);
        this.restoreWhiteModelMaterials();
        this.restoreWhiteModelLighting();
        this.disposeOutdoorPanorama();
        this.groundGrid = null;
        this.groundGridVisibleBeforeWhiteModel = null;
        this.whiteModelHiddenObjects.clear();
        this.gtaoPass?.dispose();
        this.outputPass?.dispose();
        this.composer?.dispose();
        this.gtaoPass = null;
        this.outputPass = null;
        this.renderPass = null;
        this.composer = null;

        if (this.autoRotationManager) {
            this.autoRotationManager.destroy();
            this.autoRotationManager = null;
        }
        
        if (this.controls) {
            this.controls.dispose();
        }
        
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        // 清理场景中的所有对象
        while(this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }
    }
    
    // 兼容性方法，与其他管理器保持一致的命名
    dispose() {
        this.destroy();
    }
}
