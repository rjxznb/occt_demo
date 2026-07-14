import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
        this.renderer.toneMapping = THREE.LinearToneMapping; // 使用线性色调映射，避免过度曝光
        this.renderer.toneMappingExposure = 1.0; // 适中的曝光度
        
        this.container.appendChild(this.renderer.domElement);

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
    setupProfessionalLighting() {
        // 1. 主光源 (Key Light)
        // 阴影相机的范围不在这里写死——户型尺度有上万毫米，任何硬编码的范围都会
        // 覆盖不到。等场景建好后由 fitShadowToScene() 按实际包围盒拟合。
        const keyLight = new THREE.DirectionalLight(0xFFF8DC, 0.5);
        keyLight.position.copy(KEY_LIGHT_DIR).multiplyScalar(1000);
        keyLight.castShadow = true;

        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;

        this.scene.add(keyLight);
        this.scene.add(keyLight.target);
        this.keyLight = keyLight;

        // 2. 适度增加补光
        const fillLight = new THREE.DirectionalLight(0xE6F3FF, 0.5); // 增加到0.15
        fillLight.position.set(-80, 40, 80);
        this.scene.add(fillLight);
        
        // 3. 适度增加环境光
        const ambientLight = new THREE.AmbientLight(0xF0F8FF, 0.5); // 增加到0.12
        this.scene.add(ambientLight);
        
        // 4. 添加少量地面反射光
        const groundLight = new THREE.HemisphereLight(0xE6F3FF, 0xB8B8B8, 0.8); // 添加少量反射光
        groundLight.position.set(0, 0, -50);
        this.scene.add(groundLight);
        
        // 5. 添加地面
        this.createProfessionalGround();
        
        console.log('专业级光照系统已设置完成（平衡调整）');
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
        gridHelper.position.z = 0;
        gridHelper.rotation.x = Math.PI / 2;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.08; // 适中的透明度，既不过于突出也不太隐蔽
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

    animate(callback = null) {
        requestAnimationFrame(() => this.animate(callback));
        
        try {
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