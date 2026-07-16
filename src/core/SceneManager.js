import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AutoRotationManager } from '../components/AutoRotationManager.js';

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
        this.currentViewMode = '3d'; // '3d' 或 '2d'
        
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

        // 基于图像的环境光照：给 PBR 材质（墙面等）柔和的环境反射与漫反射，
        // 是提升观感最有效的一步。用内置 RoomEnvironment 生成，不需要外部贴图文件。
        this.setupEnvironmentLighting();

        // 创建控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 0, 0);
        this.controls.maxPolarAngle = Math.PI * 0.85; // 限制俯仰角度
        this.controls.minDistance = 50;    // 最近距离
        this.controls.maxDistance = 20000; // 大幅增加最远距离，适应大场景

        // 添加专业级光照系统
        this.setupProfessionalLighting();

        // 初始化自动旋转管理器
        this.initAutoRotation();

        // 监听窗口大小变化
        window.addEventListener('resize', () => this.onWindowResize());
    }

    /**
     * 设置专业级背景环境
     */
    setupEnvironment() {
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

        // 3. 天空/地面半球光 —— 天光偏冷、地面反光偏暖，模拟室内漫反射
        const hemiLight = new THREE.HemisphereLight(0xCFE0F5, 0xD8CFC0, 0.9);
        this.scene.add(hemiLight);

        // 4. 少量环境光兜底（env + 半球光已提供大部分环境，这里只补一点点）
        const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.15);
        this.scene.add(ambientLight);

        // 5. 地面网格
        this.createProfessionalGround();

        console.log('光照系统已设置（物理标定 + 冷暖对比）');
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
        this.perspectiveCamera.updateProjectionMatrix();
        
        // 更新正交相机
        const frustumSize = 2000;
        this.orthographicCamera.left = frustumSize * aspect / -2;
        this.orthographicCamera.right = frustumSize * aspect / 2;
        this.orthographicCamera.top = frustumSize / 2;
        this.orthographicCamera.bottom = frustumSize / -2;
        this.orthographicCamera.updateProjectionMatrix();
        
        // 更新渲染器
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * 切换到正交视图（2D模式）
     */
    switchToOrthographicView() {
        if (this.currentViewMode === '2d') return;
        
        console.log('切换到正交视图');
        this.currentViewMode = '2d';
        this.camera = this.orthographicCamera;
        
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

    animate(callback = null) {
        requestAnimationFrame(() => this.animate(callback));

        try {
            // 视角补间（按帧间隔推进，独立于 controls）
            const now = performance.now();
            const dt = this._lastFrame ? Math.min(0.05, (now - this._lastFrame) / 1000) : 0.016;
            this._lastFrame = now;
            this._updateViewTween(dt);

            this.controls.update();
            
            // 执行回调函数（如FPS更新）
            if (callback && typeof callback === 'function') {
                callback();
            }
            
            this.renderer.render(this.scene, this.camera);
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