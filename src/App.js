import { SceneManager } from './core/SceneManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { WallSelector } from './components/WallSelector.js';
import { MaterialSidebar } from './components/MaterialSidebar.js';
import { DragDropManager } from './components/DragDropManager.js';

/**
 * OCCT 户型图可视化应用
 */
class OCCTApp {
    constructor() {
        this.sceneManager = null;
        this.roomRenderer = null;
        this.wallSelector = null;
        this.materialSidebar = null;
        this.dragDropManager = null;
        this.uiElements = {};
        this.currentMode = 'view'; // 'view' 或 'edit'
        this.fpsCounter = null;
        this.currentCSGEngine = 'three-csgmesh'; // 当前CSG引擎
        this.currentEpsilon = 30; // 当前精度
        
        this.init();
    }

    /**
     * 初始化应用
     */
    async init() {
        try {
            // 初始化UI元素
            this.initUI();
            
            // 初始化场景管理器
            const container = document.getElementById('canvas-container');
            this.sceneManager = new SceneManager(container);
            
            // 初始化组件
            this.roomRenderer = new RoomRenderer(this.sceneManager, {
                csgEngine: this.currentCSGEngine,
                csgEpsilon: this.currentEpsilon
            });
            this.wallSelector = new WallSelector(this.sceneManager);
            this.materialSidebar = new MaterialSidebar(this.sceneManager);
            this.dragDropManager = new DragDropManager(this.sceneManager);
            
            // 设置渐进式渲染进度回调
            this.roomRenderer.setProgressCallback((current, total) => {
                this.updateStatus(`正在挖洞门窗: ${current}/${total} (${Math.round(current/total*100)}%)`);
            });
            
            // 设置渲染完成回调
            this.roomRenderer.setRenderCompleteCallback(() => {
                this.updateStatus('所有渲染完成！');
            });
            
            // 设置墙面选择回调
            this.wallSelector.onWallSelected = (wallMesh) => {
                this.onWallSelected(wallMesh);
            };
            
            // 设置拖拽事件回调
            this.dragDropManager.onMaterialApplied = (mesh, materialData) => {
                this.onMaterialApplied(mesh, materialData);
            };
            
            this.dragDropManager.onModelCreated = (mesh, modelData) => {
                this.onModelCreated(mesh, modelData);
            };
            
            // 开始渲染循环并添加FPS更新
            this.sceneManager.animate(() => {
                this.updateFPS();
            });
            
            // 加载数据
            await this.loadData();
            
            this.updateStatus('就绪');
            
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.updateStatus('初始化失败: ' + error.message);
        }
    }

    /**
     * 初始化UI元素
     */
    initUI() {
        this.uiElements = {
            info: document.getElementById('info'),
            fpsCounter: document.getElementById('fps-counter'),
            modeToggle: document.getElementById('mode-toggle'),
            resourceToggle: document.getElementById('resource-toggle')
        };

        // 初始化FPS计数器
        this.initFPSCounter();

        // 绑定模式切换按钮事件
        this.uiElements.modeToggle?.addEventListener('click', () => {
            this.toggleMode();
        });

        // 绑定资源库按钮事件
        this.uiElements.resourceToggle?.addEventListener('click', () => {
            this.toggleResourceSidebar();
        });

        // 设置初始模式
        this.setMode('view');
    }

    /**
     * 初始化FPS计数器
     */
    initFPSCounter() {
        this.fpsCounter = {
            lastTime: performance.now(),
            frameCount: 0,
            fps: 0,
        };
    }

    /**
     * 更新FPS计数器
     */
    updateFPS() {
        const now = performance.now();
        this.fpsCounter.frameCount++;
        
        if (now - this.fpsCounter.lastTime >= 1000) {
            this.fpsCounter.fps = Math.round((this.fpsCounter.frameCount * 1000) / (now - this.fpsCounter.lastTime));
            this.fpsCounter.frameCount = 0;
            this.fpsCounter.lastTime = now;
            
            if (this.uiElements.fpsCounter) {
                this.uiElements.fpsCounter.textContent = `FPS: ${this.fpsCounter.fps}`;
            }
        }
    }

    /**
     * 切换操作模式
     */
    toggleMode() {
        const newMode = this.currentMode === 'view' ? 'edit' : 'view';
        this.setMode(newMode);
    }

    /**
     * 设置操作模式
     * @param {string} mode - 'view' 或 'edit'
     */
    setMode(mode) {
        this.currentMode = mode;
        
        if (this.uiElements.modeToggle) {
            if (mode === 'view') {
                this.uiElements.modeToggle.textContent = '🔍 查看模式';
                this.uiElements.modeToggle.className = 'mode-view';
                // 禁用墙面选择
                if (this.wallSelector) {
                    this.wallSelector.setEnabled(false);
                }
            } else {
                this.uiElements.modeToggle.textContent = '✏️ 编辑模式';
                this.uiElements.modeToggle.className = 'mode-edit';
                // 启用墙面选择
                if (this.wallSelector) {
                    this.wallSelector.setEnabled(true);
                }
            }
        }
        
        console.log(`切换到${mode === 'view' ? '查看' : '编辑'}模式`);
    }

    /**
     * 切换资源侧边栏
     */
    toggleResourceSidebar() {
        if (this.materialSidebar) {
            this.materialSidebar.toggle();
        }
    }

    /**
     * 加载数据
     */
    async loadData() {
        try {
            this.updateStatus('正在加载数据...');
            
            // 从现有的 Node.js 后端 API 端点加载数据
            const backendUrl = 'http://localhost:4001';
            const [outlineResponse, roomsResponse, doorWindowResponse] = await Promise.all([
                fetch(`${backendUrl}/outline`),
                fetch(`${backendUrl}/rooms`),
                fetch(`${backendUrl}/doors_and_windows`)
            ]);
            
            if (!outlineResponse.ok || !roomsResponse.ok || !doorWindowResponse.ok) {
                throw new Error(`数据加载失败: outline ${outlineResponse.status}, rooms ${roomsResponse.status}, doors_and_windows ${doorWindowResponse.status}`);
            }
            
            const outline = await outlineResponse.json();
            const rooms = await roomsResponse.json();
            const doorWindows = await doorWindowResponse.json();
            
            const data = { outline, rooms, doorWindows };
            
            console.log('从后端加载的数据:', data);

            // 渲染数据
            this.updateStatus('正在渲染几何体...');
            await this.roomRenderer.render(data, this.wallSelector);
            
            console.log('数据加载和基础渲染完成');
            
        } catch (error) {
            console.error('数据加载失败:', error);
            this.updateStatus('数据加载失败: ' + error.message);
            throw error;
        }
    }


    /**
     * 墙面选中回调
     * @param {THREE.Mesh} wallMesh - 选中的墙面
     */
    onWallSelected(wallMesh) {
        if (this.currentMode !== 'edit') {
            return; // 查看模式下不处理选择
        }
        
        const wallType = wallMesh.userData.wallType || 'unknown';
        const roomIndex = wallMesh.userData.roomIndex;
        
        this.updateStatus(`已选中: ${wallType === 'arc' ? '弧形' : '直线'}墙面 (房间 ${roomIndex})`);
    }

    /**
     * 材质应用回调
     * @param {THREE.Mesh} mesh - 应用材质的网格
     * @param {Object} materialData - 材质数据
     */
    onMaterialApplied(mesh, materialData) {
        const objectName = mesh.userData.type || mesh.name || '未知对象';
        this.updateStatus(`已将 ${materialData.name} 材质应用到 ${objectName}`);
        
        // 可以在这里添加更多的材质应用后处理逻辑
        console.log('材质应用详情:', {
            object: mesh,
            material: materialData,
            position: mesh.position,
            userData: mesh.userData
        });
    }

    /**
     * 模型创建回调
     * @param {THREE.Mesh} mesh - 创建的模型网格
     * @param {Object} modelData - 模型数据
     */
    onModelCreated(mesh, modelData) {
        this.updateStatus(`已创建 ${modelData.name} 模型`);
        
        // 可以在这里添加更多的模型创建后处理逻辑
        console.log('模型创建详情:', {
            model: mesh,
            data: modelData,
            position: mesh.position,
            userData: mesh.userData
        });
    }

    /**
     * 切换CSG引擎
     */
    // toggleCSGEngine() {
    //     if (this.currentCSGEngine === 'three-bvh-csg') {
    //         this.currentCSGEngine = 'three-csgmesh';
    //         this.updateStatus('切换到 THREE-CSGMesh 引擎（高精度）');
    //     } else {
    //         this.currentCSGEngine = 'three-bvh-csg';
    //         this.updateStatus('切换到 Three-BVH-CSG 引擎（高性能）');
    //     }
        
    //     // this.updateCSGEngineUI();
    //     this.applyCSGConfig();
    // }

    // /**
    //  * 更新CSG精度
    //  * @param {number} epsilon - 新的精度值
    //  */
    // updateCSGPrecision(epsilon) {
    //     this.currentEpsilon = epsilon;
    //     this.updateStatus(`CSG精度更新为: ${epsilon.toExponential(0)}`);
    //     this.applyCSGConfig();
    // }

    /**
     * 更新CSG引擎UI显示
     */
    // updateCSGEngineUI() {
    //     const toggle = this.uiElements.csgEngineToggle;
    //     const precision = this.uiElements.csgPrecision;
        
    //     if (toggle) {
    //         if (this.currentCSGEngine === 'three-bvh-csg') {
    //             toggle.textContent = '⚡ BVH-CSG';
    //             toggle.className = 'csg-bvh';
    //             if (precision) precision.style.display = 'none';
    //         } else {
    //             toggle.textContent = '🔮 CSGMesh';
    //             toggle.className = 'csg-mesh';
    //             if (precision) precision.style.display = 'block';
    //         }
    //     }
    // }

    /**
     * 应用CSG配置到RoomRenderer
     */
    applyCSGConfig() {
        if (this.roomRenderer) {
            this.roomRenderer.setCSGEngine(this.currentCSGEngine, this.currentEpsilon);
            this.updateStatus(`CSG引擎已更新: ${this.currentCSGEngine} (ε=${this.currentEpsilon.toExponential(0)})`);
        }
    }

    /**
     * 更新状态信息
     * @param {string} message - 状态消息
     */
    updateStatus(message) {
        if (this.uiElements.info) {
            this.uiElements.info.textContent = message;
        }
        console.log('状态:', message);
    }

    /**
     * 销毁应用
     */
    dispose() {
        if (this.wallSelector) {
            this.wallSelector.dispose();
        }
        
        if (this.materialSidebar) {
            this.materialSidebar.destroy();
        }
        
        if (this.dragDropManager) {
            this.dragDropManager.destroy();
        }
        
        console.log('应用已清理');
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    window.occtApp = new OCCTApp();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.occtApp) {
        window.occtApp.dispose();
    }
});