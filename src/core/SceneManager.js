import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 场景管理器 - 负责Three.js场景的初始化和管理
 */
export class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        this.init();
    }

    init() {
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2a2a2a);

        // 创建相机
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 10, 100000); // 调整相机裁剪面，当出现闪烁的现象；；
        this.camera.position.set(0, 0, 150);

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.container.appendChild(this.renderer.domElement);

        // 创建控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 0, 0);

        // 添加光源
        this.setupLighting();

        // 监听窗口大小变化
        window.addEventListener('resize', () => this.onWindowResize());
    }

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

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate(callback = null) {
        requestAnimationFrame(() => this.animate(callback));
        this.controls.update();
        
        // 执行回调函数（如FPS更新）
        if (callback && typeof callback === 'function') {
            callback();
        }
        
        this.renderer.render(this.scene, this.camera);
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
}