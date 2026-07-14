import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { Scene2DManager } from './core/Scene2DManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { PlanRenderer } from './components/PlanRenderer.js';
import { WallSelector } from './components/WallSelector.js';
import { MaterialSidebar } from './components/MaterialSidebar.js';
import { DragDropManager } from './components/DragDropManager.js';
import { SelectionManager } from './components/SelectionManager.js';
import { Room2DSelector } from './components/Room2DSelector.js';
import { Softlist2DSelector } from './components/Softlist2DSelector.js';
import { SoftlistRenderer } from './components/SoftlistRenderer.js';
import { DXFMaterialSidebar } from './components/DXFMaterialSidebar.js';

/**
 * OCCT 户型图可视化应用
 */
class OCCTApp {
    constructor() {
        // 场景管理器
        this.sceneManager3D = null; // 3D场景管理器
        this.sceneManager2D = null; // 2D场景管理器
        
        // 渲染器
        this.roomRenderer = null;
        this.planRenderer = null;
        
        // 交互组件（只在3D模式下使用）
        this.wallSelector = null;
        this.materialSidebar = null;
        this.dragDropManager = null;
        this.selectionManager = null;
        
        // 2D交互组件
        this.room2DSelector = null;
        this.softlist2DSelector = null;
        this.softlistRenderer = null;
        this.dxfMaterialSidebar = null;
        
        // UI和状态
        this.uiElements = {};
        this.currentMode = 'view'; // 'view' 或 'edit'
        this.currentView = '3d'; // '3d' 或 '2d'
        this.sharedData = null; // 共享的数据
        this.fpsCounter = null;
        this.currentCSGEngine = 'three-csgmesh'; // 当前CSG引擎
        this.currentEpsilon = 30.1; // 当前精度
        
        // 渲染状态
        this.renderState = {
            '3d': false,
            '2d': false
        };
        
        this.init();
    }

    /**
     * 初始化应用
     */
    async init() {
        try {
            // 初始化UI元素
            this.initUI();
            
            // 初始化双场景管理器
            const container3D = document.getElementById('canvas-3d');
            const container2D = document.getElementById('canvas-2d');
            this.sceneManager3D = new SceneManager(container3D);
            this.sceneManager2D = new Scene2DManager(container2D);
            
            // 初始化组件（只使用3D场景管理器）
            this.roomRenderer = new RoomRenderer(this.sceneManager3D, {
                csgEngine: this.currentCSGEngine,
                csgEpsilon: this.currentEpsilon
            });
            this.planRenderer = new PlanRenderer();
            this.wallSelector = new WallSelector(this.sceneManager3D);
            this.materialSidebar = new MaterialSidebar(this.sceneManager3D);
            this.dragDropManager = new DragDropManager(this.sceneManager3D);
            this.selectionManager = new SelectionManager(this.sceneManager3D);
            
            // 初始化2D房间选择器
            this.room2DSelector = new Room2DSelector(this.sceneManager2D);
            
            // 初始化2D软装选择器
            this.softlist2DSelector = new Softlist2DSelector(this.sceneManager2D);
            
            // 初始化DXF材质编辑器
            this.dxfMaterialSidebar = new DXFMaterialSidebar();
            
            // 设置材质应用回调，连接材质编辑器和选择器
            this.dxfMaterialSidebar.onMaterialApplied = (softlistGroup, softlistId, materialData) => {
                console.log(`材质已应用到软装 ${softlistId}`);
                // 通知软装选择器更新材质备份
                if (this.softlist2DSelector) {
                    this.softlist2DSelector.updateAppliedMaterials(softlistGroup, softlistId, materialData);
                }
            };
            
            // 初始化软装渲染器
            this.softlistRenderer = new SoftlistRenderer(this.sceneManager2D.getScene());
            
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
            
            // 设置选择管理器事件回调
            this.selectionManager.onObjectSelected = (object) => {
                this.onObjectSelected(object);
            };
            
            this.selectionManager.onObjectDeselected = (object) => {
                this.onObjectDeselected(object);
            };
            
            this.selectionManager.onObjectDeleted = (object) => {
                this.onObjectDeleted(object);
            };
            
            // 设置2D房间选择器事件回调
            this.room2DSelector.onRoomSelected = (roomMesh, roomIndex) => {
                this.onRoomSelected(roomMesh, roomIndex);
            };
            
            this.room2DSelector.onRoomDeselected = (roomMesh, roomIndex) => {
                this.onRoomDeselected(roomMesh, roomIndex);
            };
            
            // 设置2D软装选择器事件回调
            this.softlist2DSelector.onSoftlistSelected = (softlistGroup, softlistId) => {
                this.onSoftlistSelected(softlistGroup, softlistId);
            };
            
            this.softlist2DSelector.onSoftlistDeselected = (softlistGroup, softlistId) => {
                this.onSoftlistDeselected(softlistGroup, softlistId);
            };
            
            // 所有组件创建完成后，设置初始模式为查看模式
            this.setMode('view');
            
            // 先加载数据，再开始渲染
            await this.loadData();
            
            // 启动双场景渲染循环
            this.startRenderLoop();
            
            this.updateStatus('就绪');
            
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.updateStatus('初始化失败: ' + error.message);
        }
    }

    /**
     * 启动双场景渲染循环
     */
    startRenderLoop() {
        // 启动3D场景渲染
        this.sceneManager3D.animate(() => {
            this.updateFPS();
            this.updateAutoRotationStatus();
        });
        
        // 启动2D场景渲染
        this.sceneManager2D.animate();
        
        console.log('双场景渲染循环已启动');
    }

    /**
     * 初始化UI元素
     */
    initUI() {
        this.uiElements = {
            info: document.getElementById('info'),
            fpsCounter: document.getElementById('fps-counter'),
            modeToggle: document.getElementById('mode-toggle'),
            resourceToggle: document.getElementById('resource-toggle'),
            rotationIndicator: document.getElementById('rotation-indicator'),
            rotationStatusText: document.getElementById('rotation-status-text')
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

        // 绑定视图切换按钮事件
        this.uiElements.viewToggle = document.getElementById('view-toggle');
        if (this.uiElements.viewToggle) {
            this.updateViewButton(); // 初始化按钮状态和事件
        }

        // 先不设置模式，等组件创建完成后再设置
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
     * 更新自动旋转状态显示
     */
    updateAutoRotationStatus() {
        // 只在3D视图下显示自动旋转状态
        if (this.currentView !== '3d' || 
            !this.sceneManager3D?.autoRotationManager || 
            !this.uiElements.rotationIndicator || 
            !this.uiElements.rotationStatusText) {
            return;
        }

        const status = this.sceneManager3D.getAutoRotationStatus();
        if (!status) return;

        // 更新指示器颜色
        const indicator = this.uiElements.rotationIndicator;
        indicator.className = 'rotation-indicator';
        
        if (status.isRotating) {
            indicator.classList.add('rotating');
        } else if (status.enabled) {
            indicator.classList.add('enabled');
        }

        // 更新状态文本
        let statusText = '自动旋转: ';
        if (!status.enabled) {
            statusText += '禁用';
        } else if (status.isRotating) {
            statusText += '旋转中';
        } else if (status.isIdle) {
            statusText += '空闲';
        } else {
            const minutes = Math.floor(status.timeUntilIdle / 60);
            const seconds = status.timeUntilIdle % 60;
            if (minutes > 0) {
                statusText += `${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                statusText += `${seconds}s`;
            }
        }

        this.uiElements.rotationStatusText.textContent = statusText;
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
            } else {
                this.uiElements.modeToggle.textContent = '✏️ 编辑模式';
                this.uiElements.modeToggle.className = 'mode-edit';
            }
        }
        
        // 更新3D交互组件的启用状态（考虑当前视图和模式）
        this.updateInteractionStates();
        
        console.log(`切换到${mode === 'view' ? '查看' : '编辑'}模式`);
    }

    /**
     * 更新交互状态（基于当前视图和模式）
     */
    updateInteractionStates() {
        const is3DView = this.currentView === '3d';
        const is2DView = this.currentView === '2d';
        const isEditMode = this.currentMode === 'edit';
        
        // 墙面选择器：需要3D视图且编辑模式
        if (this.wallSelector) {
            this.wallSelector.setEnabled(is3DView && isEditMode);
        }
        
        // 拖拽和选择管理器：需要3D视图
        if (this.dragDropManager) {
            this.dragDropManager.setEnabled(is3DView);
        }
        
        if (this.selectionManager) {
            this.selectionManager.setEnabled(is3DView);
        }
        
        // 2D选择器：在2D视图下启用
        if (this.room2DSelector) {
            this.room2DSelector.setEnabled(is2DView);
        }
        
        if (this.softlist2DSelector) {
            this.softlist2DSelector.setEnabled(is2DView);
        }
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
     * 切换到2D彩平图视图
     */
    async switchTo2DView() {
        if (this.currentView === '2d') return;
        
        try {
            this.updateStatus('正在切换到2D彩平图视图...');
            
            // 清理3D拖拽状态
            this.cleanupDragState();
            
            // 切换视图模式
            this.currentView = '2d';
            
            // 更新按钮状态
            this.updateViewButton();
            
            // 切换canvas显示
            document.getElementById('canvas-3d').classList.remove('active');
            document.getElementById('canvas-3d').classList.add('hidden');
            document.getElementById('canvas-2d').classList.remove('hidden');
            document.getElementById('canvas-2d').classList.add('active');
            
            // 如果还没有数据，先加载
            if (!this.sharedData) {
                await this.loadData();
            }
            
            // 检查是否已经渲染过2D场景
            if (!this.renderState['2d']) {
                // 首次渲染2D场景
                const data2D = JSON.parse(JSON.stringify(this.sharedData));
                
                const result = await this.planRenderer.render(data2D, this.sceneManager2D.getScene());
                this.renderState['2d'] = true;
                console.log('2D场景首次渲染完成');
                
                // 设置2D房间选择器
                this.setup2DRoomSelector();
                
                // 加载并渲染软装
                await this.loadAndRenderSoftlists();
                
                // 适应视图
                this.sceneManager2D.fitToView();
            }
            
            // 隐藏3D相关UI和交互
            this.set3DUIVisible(false);
            
            // 显示2D相关UI
            this.set2DUIVisible(true);
            
            this.updateStatus('2D彩平图视图已切换');
            
        } catch (error) {
            console.error('切换到2D视图失败:', error);
            this.updateStatus('切换到2D视图失败: ' + error.message);
        }
    }

    /**
     * 切换到3D视图
     */
    async switchTo3DView() {
        if (this.currentView === '3d') return;
        
        try {
            this.updateStatus('正在切换到3D视图...');
            
            // 清理可能的拖拽状态
            this.cleanupDragState();
            
            // 切换视图模式
            this.currentView = '3d';
            
            // 更新按钮状态
            this.updateViewButton();
            
            // 切换canvas显示
            document.getElementById('canvas-2d').classList.remove('active');
            document.getElementById('canvas-2d').classList.add('hidden');
            document.getElementById('canvas-3d').classList.remove('hidden');
            document.getElementById('canvas-3d').classList.add('active');
            
            // 如果还没有数据，先加载
            if (!this.sharedData) {
                await this.loadData();
            }
            
            // 检查是否已经渲染过3D场景
            if (!this.renderState['3d']) {
                // 首次渲染3D场景
                const data3D = JSON.parse(JSON.stringify(this.sharedData));
                
                const result = await this.roomRenderer.render(data3D, this.wallSelector);
                this.renderState['3d'] = true;
                console.log('3D场景首次渲染完成');
            }
            
            // 显示3D相关UI和交互
            this.set3DUIVisible(true);
            
            // 隐藏2D相关UI
            this.set2DUIVisible(false);
            
            this.updateStatus('3D视图已切换');
            
        } catch (error) {
            console.error('切换到3D视图失败:', error);
            this.updateStatus('切换到3D视图失败: ' + error.message);
        }
    }


    /**
     * 更新视图按钮状态
     */
    updateViewButton() {
        const button = this.uiElements.viewToggle;
        if (button) {
            if (this.currentView === '3d') {
                button.textContent = '📋 2D彩平图';
                button.onclick = () => this.switchTo2DView();
            } else {
                button.textContent = '🏠 3D视图';
                button.onclick = () => this.switchTo3DView();
            }
        }
    }


    /**
     * 设置3D相关UI和交互的显示状态
     * @param {boolean} visible - 是否显示
     */
    set3DUIVisible(visible) {
        // 隐藏/显示模式切换按钮
        if (this.uiElements.modeToggle) {
            this.uiElements.modeToggle.style.display = visible ? 'block' : 'none';
        }
        
        // 隐藏/显示资源库按钮
        if (this.uiElements.resourceToggle) {
            this.uiElements.resourceToggle.style.display = visible ? 'block' : 'none';
        }
        
        // 隐藏/显示编辑相关UI
        const shortcutsInfo = document.querySelector('.shortcuts-info');
        if (shortcutsInfo) {
            shortcutsInfo.style.display = visible ? 'block' : 'none';
        }
        
        // 更新交互状态
        this.updateInteractionStates();
    }

    /**
     * 设置2D相关UI的显示状态
     * @param {boolean} visible - 是否显示
     */
    set2DUIVisible(visible) {
        
        console.log(`2D UI已${visible ? '显示' : '隐藏'}`);
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
            
            // 缓存共享数据
            this.sharedData = data;
            
            console.log('从后端加载的数据:', data);

            // 根据当前视图模式渲染数据
            this.updateStatus('正在渲染几何体...');
            if (this.currentView === '3d') {
                // 为3D创建数据深拷贝并渲染
                const data3D = JSON.parse(JSON.stringify(data));
                const result = await this.roomRenderer.render(data3D, this.wallSelector);
                this.renderState['3d'] = true;
            } else {
                // 为2D创建数据深拷贝并渲染
                const data2D = JSON.parse(JSON.stringify(data));
                const result = await this.planRenderer.render(data2D, this.sceneManager2D.getScene());
                this.renderState['2d'] = true;
                
                // 设置2D房间选择器
                this.setup2DRoomSelector();
            }
            
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
     * 对象选中回调
     * @param {THREE.Object3D} object - 选中的对象
     */
    onObjectSelected(object) {
        const objectName = object.userData.name || object.userData.modelType || '未知对象';
        this.updateStatus(`已选中: ${objectName} (G:移动 R:旋转 S:缩放 Del:删除)`);
        
        console.log('对象选中详情:', {
            object: object,
            name: objectName,
            position: object.position,
            userData: object.userData
        });
    }

    /**
     * 对象取消选中回调
     * @param {THREE.Object3D} object - 取消选中的对象
     */
    onObjectDeselected(object) {
        this.updateStatus('已取消选择');
        
        console.log('对象取消选中:', object.userData.name || object.userData.modelType);
    }

    /**
     * 对象删除回调
     * @param {THREE.Object3D} object - 删除的对象
     */
    onObjectDeleted(object) {
        const objectName = object.userData.name || object.userData.modelType || '未知对象';
        this.updateStatus(`已删除: ${objectName}`);
        
        console.log('对象删除详情:', {
            object: object,
            name: objectName,
            userData: object.userData
        });
    }

   
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
        // 清理交互组件
        if (this.wallSelector) {
            this.wallSelector.dispose();
        }
        
        if (this.materialSidebar) {
            this.materialSidebar.destroy();
        }
        
        if (this.dragDropManager) {
            this.dragDropManager.destroy();
        }
        
        if (this.selectionManager) {
            this.selectionManager.destroy();
        }
        
        if (this.room2DSelector) {
            this.room2DSelector.dispose();
        }
        
        if (this.softlist2DSelector) {
            this.softlist2DSelector.dispose();
        }
        
        if (this.softlistRenderer) {
            this.softlistRenderer.dispose();
        }
        
        if (this.dxfMaterialSidebar) {
            this.dxfMaterialSidebar.dispose();
        }
        
        
        // 清理双场景管理器
        if (this.sceneManager3D) {
            this.sceneManager3D.destroy();
        }
        
        if (this.sceneManager2D) {
            this.sceneManager2D.destroy();
        }
        
        console.log('双场景应用已清理');
    }

    /**
     * 清理拖拽状态
     * 在视图切换时调用，确保拖拽预览不会残留
     */
    cleanupDragState() {
        if (this.dragDropManager) {
            // 使用DragDropManager的强制清理方法
            this.dragDropManager.forceCleanupDragState();
            console.log('拖拽状态已清理');
        }
    }

    /**
     * 设置2D房间选择器
     */
    setup2DRoomSelector() {
        if (this.room2DSelector && this.planRenderer) {
            // 从PlanRenderer获取房间meshes
            const roomMeshes = this.planRenderer.getRoomMeshes();
            
            if (roomMeshes && roomMeshes.length > 0) {
                console.log(`设置2D房间选择器，房间数量: ${roomMeshes.length}`);
                this.room2DSelector.addRooms(roomMeshes);
            } else {
                console.warn('未找到可选择的房间mesh');
            }
        }
    }

    /**
     * 加载并渲染软装
     */
    async loadAndRenderSoftlists() {
        if (this.softlistRenderer) {
            try {
                this.updateStatus('正在加载软装数据...');
                console.log('开始加载软装数据...');
                
                await this.softlistRenderer.initialize();
                
                // 软装渲染完成后，将软装组添加到软装选择器
                this.setupSoftlistSelector();
                
                const stats = this.softlistRenderer.getStats();
                console.log(`软装加载完成，总计: ${stats.totalItems} 个软装项，渲染组: ${stats.renderedGroups} 个`);
                this.updateStatus(`软装加载完成，共 ${stats.totalItems} 个软装项`);
                
            } catch (error) {
                console.error('软装加载失败:', error);
                this.updateStatus('软装加载失败: ' + error.message);
            }
        }
    }

    /**
     * 设置软装选择器
     */
    setupSoftlistSelector() {
        if (this.softlist2DSelector && this.softlistRenderer) {
            // 从SoftlistRenderer获取软装组
            const softlistGroups = this.softlistRenderer.softlistGroups;
            
            if (softlistGroups && softlistGroups.length > 0) {
                console.log(`设置2D软装选择器，软装组数量: ${softlistGroups.length}`);
                
                // 打印每个软装组的详细信息
                softlistGroups.forEach((group, index) => {
                    console.log(`软装组 ${index}:`, {
                        name: group.name,
                        id: group.userData.softlistId,
                        children: group.children.length,
                        type: group.userData.type
                    });
                });
                
                this.softlist2DSelector.addSoftlists(softlistGroups);
            } else {
                console.warn('未找到可选择的软装组');
                console.log('SoftlistRenderer状态:', {
                    exists: !!this.softlistRenderer,
                    softlistGroups: this.softlistRenderer?.softlistGroups?.length || 0
                });
            }
        } else {
            console.warn('软装选择器设置失败：', {
                softlist2DSelector: !!this.softlist2DSelector,
                softlistRenderer: !!this.softlistRenderer
            });
        }
    }

    /**
     * 房间选择事件处理
     * @param {THREE.Mesh} roomMesh - 选中的房间mesh
     * @param {number} roomIndex - 房间索引
     */
    onRoomSelected(roomMesh, roomIndex) {
        console.log(`房间 ${roomIndex} 被选中`);
        this.updateStatus(`选中房间 ${roomIndex + 1}`);
        
        // 这里可以添加更多房间选择后的逻辑
        // 例如显示房间信息、切换材质等
    }

    /**
     * 房间取消选择事件处理
     * @param {THREE.Mesh} roomMesh - 被取消选择的房间mesh
     * @param {number} roomIndex - 房间索引
     */
    onRoomDeselected(roomMesh, roomIndex) {
        console.log(`房间 ${roomIndex} 被取消选择`);
        this.updateStatus('就绪');
        
        // 这里可以添加更多房间取消选择后的逻辑
    }

    /**
     * 软装选择事件处理
     * @param {THREE.Group} softlistGroup - 选中的软装组
     * @param {string} softlistId - 软装ID
     */
    onSoftlistSelected(softlistGroup, softlistId) {
        console.log(`软装 ${softlistId} 被选中`);
        this.updateStatus(`选中软装 ${softlistId} - 材质编辑器已打开`);
        
        // 显示DXF材质编辑器
        if (this.dxfMaterialSidebar) {
            this.dxfMaterialSidebar.show(softlistGroup, softlistId);
        }
        
        // 这里可以添加更多软装选择后的逻辑
        // 例如显示软装信息、允许编辑属性等
    }

    /**
     * 软装取消选择事件处理
     * @param {THREE.Group} softlistGroup - 被取消选择的软装组
     * @param {string} softlistId - 软装ID
     */
    onSoftlistDeselected(softlistGroup, softlistId) {
        console.log(`软装 ${softlistId} 被取消选择`);
        this.updateStatus('就绪');
        
        // 隐藏DXF材质编辑器
        if (this.dxfMaterialSidebar) {
            this.dxfMaterialSidebar.hide();
        }
        
        // 这里可以添加更多软装取消选择后的逻辑
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