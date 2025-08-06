import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 2D场景管理器 - 专门用于2D彩平图视图
 */
export class Scene2DManager {
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
        
        // 设置简洁的2D背景
        this.scene.background = new THREE.Color(0xf8f8f8);

        // 创建正交相机（2D视图）
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = 2000;
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            frustumSize / -2,
            1,
            10000
        );
        
        // 设置俯视角度
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);
        this.camera.up.set(0, 1, 0);

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // 2D渲染不需要阴影
        this.renderer.shadowMap.enabled = false;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        this.container.appendChild(this.renderer.domElement);

        // 创建控制器 - 禁用旋转，只允许平移和缩放
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 0, 0);
        this.controls.enableRotate = false; // 2D模式禁用旋转
        this.controls.screenSpacePanning = false;
        this.controls.minZoom = 0.1;
        this.controls.maxZoom = 10;

        // 添加简单的2D光照
        this.setupLighting();

        // 监听窗口大小变化
        window.addEventListener('resize', () => this.onWindowResize());
    }

    /**
     * 设置2D光照
     */
    setupLighting() {
        // 环境光
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(ambientLight);

        // 方向光（从上方照射）
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 0, 100);
        this.scene.add(directionalLight);
    }

    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        
        // 更新正交相机
        const frustumSize = 2000;
        this.camera.left = frustumSize * aspect / -2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = frustumSize / -2;
        this.camera.updateProjectionMatrix();
        
        // 更新渲染器
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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
        
        // 调整正交相机的缩放和位置
        this.camera.position.set(center.x, center.y, 1000);
        this.controls.target.set(center.x, center.y, 0);
        
        const maxDim = Math.max(size.x, size.y);
        const fov = Math.min(
            this.camera.right - this.camera.left, 
            this.camera.top - this.camera.bottom
        );
        const distance = maxDim / fov * 1.2;
        
        this.camera.zoom = 1 / distance;
        this.camera.updateProjectionMatrix();
        
        this.controls.update();
    }

    animate(callback = null) {
        requestAnimationFrame(() => this.animate(callback));
        
        try {
            this.controls.update();
            
            // 执行回调函数
            if (callback && typeof callback === 'function') {
                callback();
            }
            
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.error('2D渲染错误:', error);
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

    // 销毁场景管理器
    destroy() {        
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
}