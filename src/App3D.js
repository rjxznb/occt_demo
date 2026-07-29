import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { WallSelector } from './components/WallSelector.js';
import { MaterialSidebar } from './components/MaterialSidebar.js';
import { DragDropManager } from './components/DragDropManager.js';
import { SelectionManager } from './components/SelectionManager.js';
import { geometryService } from './core/GeometryService.js';
import { BundledDataSource, withSceneFixture } from './core/DataSource.js';
import { TemplatePicker } from './components/TemplatePicker.js';
import { RoomInfoView } from './components/RoomInfoView.js';

/**
 * 3D 预览应用（插件内嵌版）
 *
 * 这是从完整版 App.js 里拆出的「只含 3D」入口：保留全部 3D 功能（墙面选择、
 * 材质编辑、拖拽模型、选择管理、应用模板、房间标注、内墙尺寸、自动旋转/视角），
 * 剔除所有 2D 彩平图相关代码，并跳过数据源选择界面——直接加载内置示例数据。
 *
 * 用于放进 CAD 插件的渲染预览「页面二」（WebView2 iframe）。为此：
 * - 资源用相对路径（配合 Vite base:'./'），见 DataSource / TemplatePicker；
 * - 接入外壳的 renderer-preview 生命周期：标签不可见时暂停渲染，别空转烧 CPU。
 */
class OCCTApp3D {
    constructor() {
        this.sceneManager3D = null;

        this.roomRenderer = null;
        this.wallSelector = null;
        this.materialSidebar = null;
        this.dragDropManager = null;
        this.selectionManager = null;
        this.templatePicker = null;
        this.roomInfoView = null;

        this.uiElements = {};
        this.currentMode = 'view'; // 'view' 或 'edit'
        this.currentView = '3d';   // 恒为 3D，仅为兼容既有 3D 组件里的视图判断
        this.sharedData = null;
        this.fpsCounter = null;

        this.renderState = { '3d': false };

        this.init();
    }

    async init() {
        try {
            this.initUI();

            const container3D = document.getElementById('canvas-3d');
            this.sceneManager3D = new SceneManager(container3D);

            // 3D 组件
            this.roomRenderer = new RoomRenderer(this.sceneManager3D);
            this.wallSelector = new WallSelector(this.sceneManager3D);
            this.materialSidebar = new MaterialSidebar(this.sceneManager3D);
            this.dragDropManager = new DragDropManager(this.sceneManager3D);
            this.selectionManager = new SelectionManager(this.sceneManager3D);

            // 渐进式渲染进度 / 完成回调
            this.roomRenderer.setProgressCallback((current, total) => {
                this.updateStatus(`正在挖洞门窗: ${current}/${total} (${Math.round(current / total * 100)}%)`);
            });
            this.roomRenderer.setRenderCompleteCallback(() => {
                this.updateStatus('所有渲染完成！');
            });

            // 交互回调
            this.wallSelector.onWallSelected = (wallMesh) => this.onWallSelected(wallMesh);
            this.dragDropManager.onMaterialApplied = (mesh, materialData) => this.onMaterialApplied(mesh, materialData);
            this.dragDropManager.onModelCreated = (mesh, modelData) => this.onModelCreated(mesh, modelData);
            this.selectionManager.onObjectSelected = (object) => this.onObjectSelected(object);
            this.selectionManager.onObjectDeselected = (object) => this.onObjectDeselected(object);
            this.selectionManager.onObjectDeleted = (object) => this.onObjectDeleted(object);

            this.setMode('view');

            await this.loadData();

            this.startRenderLoop();
            this.setupHostLifecycle();

            this.updateStatus('就绪');
        } catch (error) {
            console.error('3D 应用初始化失败:', error);
            this.updateStatus('初始化失败: ' + error.message);
        }
    }

    startRenderLoop() {
        this.sceneManager3D.animate(() => {
            this.updateFPS();
            this.updateAutoRotationStatus();
        });
        console.log('3D 场景渲染循环已启动');
    }

    initUI() {
        this.uiElements = {
            info: document.getElementById('info'),
            fpsCounter: document.getElementById('fps-counter'),
            modeToggle: document.getElementById('mode-toggle'),
            resourceToggle: document.getElementById('resource-toggle'),
            rotationIndicator: document.getElementById('rotation-indicator'),
            rotationStatusText: document.getElementById('rotation-status-text'),
        };

        this.initFPSCounter();

        this.uiElements.modeToggle?.addEventListener('click', () => this.toggleMode());
        this.uiElements.resourceToggle?.addEventListener('click', () => this.toggleResourceSidebar());

        // 快速视角：切到对应鸟瞰角度（保留鼠标旋转）
        document.querySelectorAll('.view-angle-btn').forEach(btn => {
            btn.addEventListener('click', () => this.sceneManager3D?.setView(btn.dataset.view));
        });
        this.uiElements.viewAngleGroup = document.getElementById('view-angle-group');
        this.updateViewAngleVisibility();

        // 应用模板：把配色应用到 3D 场景
        document.getElementById('template-toggle')?.addEventListener('click', () => {
            if (!this.roomRenderer?.sceneGroup) return;
            if (!this.templatePicker) {
                this.templatePicker = new TemplatePicker({
                    sceneGroup: this.roomRenderer.sceneGroup,
                    scene: this.sceneManager3D.getScene(),
                });
            }
            this.templatePicker.toggle();
        });
    }

    /** 幂等地创建房间信息查看器（sceneGroup 就绪后） */
    _ensureRoomInfoView() {
        if (this.roomInfoView || !this.roomRenderer?.sceneGroup) return;
        this.roomInfoView = new RoomInfoView(this.sceneManager3D, this.roomRenderer.sceneGroup);
    }

    updateViewAngleVisibility() {
        if (this.uiElements.viewAngleGroup) {
            this.uiElements.viewAngleGroup.style.display = '';
        }
        if (this.roomInfoView) this.roomInfoView.setEnabled(true);
    }

    initFPSCounter() {
        this.fpsCounter = { lastTime: performance.now(), frameCount: 0, fps: 0 };
    }

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

    updateAutoRotationStatus() {
        if (!this.sceneManager3D?.autoRotationManager ||
            !this.uiElements.rotationIndicator ||
            !this.uiElements.rotationStatusText) {
            return;
        }

        const status = this.sceneManager3D.getAutoRotationStatus();
        if (!status) return;

        const indicator = this.uiElements.rotationIndicator;
        indicator.className = 'rotation-indicator';
        if (status.isRotating) {
            indicator.classList.add('rotating');
        } else if (status.enabled) {
            indicator.classList.add('enabled');
        }

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
            statusText += minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
        }
        this.uiElements.rotationStatusText.textContent = statusText;
    }

    toggleMode() {
        this.setMode(this.currentMode === 'view' ? 'edit' : 'view');
    }

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
        this.updateInteractionStates();
        console.log(`切换到${mode === 'view' ? '查看' : '编辑'}模式`);
    }

    updateInteractionStates() {
        const isEditMode = this.currentMode === 'edit';
        // 墙面选择器：编辑模式才启用
        this.wallSelector?.setEnabled(isEditMode);
        // 拖拽 / 选择：3D 下始终启用
        this.dragDropManager?.setEnabled(true);
        this.selectionManager?.setEnabled(true);
    }

    toggleResourceSidebar() {
        this.materialSidebar?.toggle();
    }

    async loadData() {
        globalThis.__renderPreviewDiagnostic?.('data-load-start', 'OK');
        try {
            this.updateStatus('正在初始化几何引擎...');
            await geometryService.init();

            this.updateStatus('正在加载数据...');
            const [outline, rooms, doorWindows, softlists, contentModels] = await Promise.all([
                geometryService.getOutline(),
                geometryService.getRooms(),
                geometryService.getDoorsAndWindows(),
                geometryService.getSoftlists(),
                geometryService.getContentModels(),
            ]);

            const data = { outline, rooms, doorWindows, softlists, contentModels };
            globalThis.__renderPreviewDiagnostic?.('data-load-ready', 'OK');
            this.sharedData = data;

            this.updateStatus('正在渲染几何体...');
            const data3D = JSON.parse(JSON.stringify(data));
            await this.roomRenderer.render(data3D, this.wallSelector);
            this.renderState['3d'] = true;
            this._ensureRoomInfoView();

            console.log('数据加载和 3D 渲染完成');
        } catch (error) {
            globalThis.__renderPreviewDiagnostic?.('data-load-error', 'DATA_ERROR');
            console.error('数据加载失败:', error);
            this.updateStatus('数据加载失败: ' + error.message);
            throw error;
        }
    }

    // -- 交互回调 --------------------------------------------------------------

    onWallSelected(wallMesh) {
        if (this.currentMode !== 'edit') return;
        const wallType = wallMesh.userData.wallType || 'unknown';
        const roomIndex = wallMesh.userData.roomIndex;
        this.updateStatus(`已选中: ${wallType === 'arc' ? '弧形' : '直线'}墙面 (房间 ${roomIndex})`);
    }

    onMaterialApplied(mesh, materialData) {
        const objectName = mesh.userData.type || mesh.name || '未知对象';
        this.updateStatus(`已将 ${materialData.name} 材质应用到 ${objectName}`);
    }

    onModelCreated(mesh, modelData) {
        this.updateStatus(`已创建 ${modelData.name} 模型`);
    }

    onObjectSelected(object) {
        const objectName = object.userData.name || object.userData.modelType || '未知对象';
        this.updateStatus(`已选中: ${objectName} (G:移动 R:旋转 S:缩放 Del:删除)`);
    }

    onObjectDeselected() {
        this.updateStatus('已取消选择');
    }

    onObjectDeleted(object) {
        const objectName = object.userData.name || object.userData.modelType || '未知对象';
        this.updateStatus(`已删除: ${objectName}`);
    }

    updateStatus(message) {
        if (this.uiElements.info) {
            this.uiElements.info.textContent = message;
        }
        console.log('状态:', message);
    }

    // -- 插件外壳生命周期 ------------------------------------------------------

    /**
     * 接入渲染预览外壳的 renderer-preview 协议：
     * 标签被切走(deactivate) 就暂停渲染，切回来(activate) 恢复，dispose 时清理。
     * 不主动发 ready——外壳在 iframe load 后会自行下发 activate/context，无需握手。
     */
    setupHostLifecycle() {
        if (window.parent === window) return; // 非嵌入场景（独立打开）直接跳过

        const CHANNEL = 'renderer-preview';
        const VERSION = 1;
        this._onHostMessage = (event) => {
            const msg = event.data;
            if (event.source !== window.parent || !msg || typeof msg !== 'object' ||
                msg.channel !== CHANNEL || msg.version !== VERSION) {
                return;
            }
            if (msg.type === 'activate') {
                this.sceneManager3D?.setPaused(false);
            } else if (msg.type === 'deactivate') {
                this.sceneManager3D?.setPaused(true);
            } else if (msg.type === 'dispose') {
                this.dispose();
            }
            // context（方案名/订单号）暂不使用——当前只做示例数据展示
        };
        window.addEventListener('message', this._onHostMessage);
    }

    cleanupDragState() {
        this.dragDropManager?.forceCleanupDragState();
    }

    dispose() {
        this.wallSelector?.dispose();
        this.materialSidebar?.destroy();
        this.dragDropManager?.destroy();
        this.selectionManager?.destroy();
        this.sceneManager3D?.destroy();
        if (this._onHostMessage) window.removeEventListener('message', this._onHostMessage);
        console.log('3D 应用已清理');
    }
}

// 启动：直接用内置示例数据（相对路径，兼容 iframe 内嵌），不再弹数据源选择
document.addEventListener('DOMContentLoaded', () => {
    globalThis.__renderPreviewDiagnostic?.('app-boot', 'OK');
    const bundledData = new BundledDataSource('data/Drawing2.json', 'data/parsed_dxf');
    geometryService.setDataSource(withSceneFixture(bundledData, window.location.search));
    window.occtApp = new OCCTApp3D();
});

window.addEventListener('beforeunload', () => {
    if (window.occtApp) window.occtApp.dispose();
});
