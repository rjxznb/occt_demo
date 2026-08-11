import * as THREE from 'three';

import { SceneManager } from './core/SceneManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { geometryService } from './core/GeometryService.js';
import { BundledDataSource, withSceneFixture } from './core/DataSource.js';
import { normalizePanoramaPoints } from './panorama/PanoramaPointModel.js';
import { resolvePanoramaDocumentContext } from './panorama/PanoramaDocumentContext.js';
import { LocalPanoramaPointRepository } from './panorama/PanoramaPointRepository.js';
import { PanoramaPointStore } from './panorama/PanoramaPointStore.js';
import { validatePanoramaPoint } from './panorama/PanoramaPointValidator.js';
import { PanoramaEditController } from './panorama/PanoramaEditController.js';
import { PanoramaInputPolicy } from './panorama/PanoramaInputPolicy.js';
import { PanoramaMiniMap } from './panorama/PanoramaMiniMap.js';
import { PanoramaHotspots } from './panorama/PanoramaHotspots.js';
import { selectDirectionalPanoramaPoint } from './panorama/PanoramaDirectionalNavigator.js';

const PASSIVE_WALL_REGISTRY = Object.freeze({
    addWall() {},
    addWalls() {},
});

const DEFAULT_CAMERA_HEIGHT = 1500;
const HEIGHT_NUDGE = 50;

export async function loadPanoramaSceneData(service = geometryService) {
    await service.init();
    const [outline, rooms, doorWindows, softlists, contentModels, cameraPresets] = await Promise.all([
        service.getOutline(),
        service.getRooms(),
        service.getDoorsAndWindows(),
        service.getSoftlists(),
        service.getContentModels(),
        service.getCameraPresets(),
    ]);
    return { outline, rooms, doorWindows, softlists, contentModels, cameraPresets };
}

export function collectContentObstacleBounds(sceneGroup) {
    if (!sceneGroup?.traverse) return null;
    const obstacles = [];
    sceneGroup.updateMatrixWorld?.(true);
    sceneGroup.traverse(object => {
        if (object?.userData?.contentModelRoot !== true) return;
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        obstacles.push({
            id: String(
                object.userData.instanceId
                ?? object.userData.sourceIndex
                ?? object.uuid
                ?? obstacles.length,
            ),
            minX: box.min.x,
            minY: box.min.y,
            minZ: box.min.z,
            maxX: box.max.x,
            maxY: box.max.y,
            maxZ: box.max.z,
        });
    });
    return obstacles;
}

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}

export class PanoramaApp {
    constructor({
        documentRef = globalThis.document,
        windowRef = globalThis.window,
        dataSourceId = 'data/Drawing2.json',
        dataLoader = () => loadPanoramaSceneData(),
        sceneManagerFactory = container => new SceneManager(container),
        roomRendererFactory = manager => new RoomRenderer(manager),
        repository = undefined,
        storeFactory = options => new PanoramaPointStore(options),
        miniMapFactory = (container, options) => new PanoramaMiniMap(container, options),
        hotspotsFactory = (container, options) => new PanoramaHotspots(container, options),
        logger = console,
    } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.dataSourceId = dataSourceId;
        this.dataLoader = dataLoader;
        this.sceneManagerFactory = sceneManagerFactory;
        this.roomRendererFactory = roomRendererFactory;
        this.repository = repository === undefined
            ? new LocalPanoramaPointRepository()
            : repository;
        this.storeFactory = storeFactory;
        this.miniMapFactory = miniMapFactory;
        this.hotspotsFactory = hotspotsFactory;
        this.logger = logger;

        this.phase = 'idle';
        this.initializing = null;
        this.disposed = false;
        this.runtimeActive = false;
        this.uiBound = false;
        this.uiDisposers = [];
        this.storeUnsubscribe = null;
        this.sceneManager = null;
        this.roomRenderer = null;
        this.store = null;
        this.editController = null;
        this.inputPolicy = null;
        this.miniMap = null;
        this.hotspots = null;
        this.rooms = { roomPoints: [], roomNames: [] };
        this.obstacles = null;
        this.hotspotsVisible = true;
        this.createMode = false;
        this.lastFrameTime = null;
        this.toastTimer = null;
        this.ui = {};
    }

    _element(id) {
        return this.document?.getElementById?.(id) ?? null;
    }

    _collectUi() {
        const ids = [
            'panorama-app', 'panorama-canvas', 'panorama-edit-toggle',
            'panorama-primary-actions', 'panorama-submit-render',
            'panorama-minimap', 'panorama-hotspots', 'panorama-browse-controls',
            'panorama-edit-controls', 'panorama-previous', 'panorama-next',
            'panorama-reset-view', 'panorama-hotspot-toggle', 'panorama-fullscreen',
            'panorama-height-down', 'panorama-height-value', 'panorama-height-up',
            'panorama-edit-cancel', 'panorama-edit-save', 'panorama-loading',
            'panorama-loading-detail', 'panorama-empty', 'panorama-empty-create',
            'panorama-error', 'panorama-error-message', 'panorama-retry', 'panorama-toast',
        ];
        this.ui = Object.fromEntries(ids.map(id => [id.replace(/^panorama-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()), this._element(id)]));
    }

    _listen(target, type, listener) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, listener);
        this.uiDisposers.push(() => target.removeEventListener?.(type, listener));
    }

    _bindUi() {
        if (this.uiBound) return;
        this.uiBound = true;
        this._collectUi();

        this._listen(this.ui.editToggle, 'click', () => this.enterEditMode());
        this._listen(this.ui.previous, 'click', () => void this.selectRelativePoint(-1));
        this._listen(this.ui.next, 'click', () => void this.selectRelativePoint(1));
        this._listen(this.ui.resetView, 'click', () => this.resetView());
        this._listen(this.ui.hotspotToggle, 'click', () => this.toggleHotspots());
        this._listen(this.ui.fullscreen, 'click', () => void this.toggleFullscreen());
        this._listen(this.ui.emptyCreate, 'click', () => this.beginCreatePoint());
        this._listen(this.ui.editSave, 'click', () => void this.saveEdit());
        this._listen(this.ui.editCancel, 'click', () => this.cancelEdit());
        this._listen(this.ui.heightDown, 'click', () => this.nudgeHeight(-HEIGHT_NUDGE));
        this._listen(this.ui.heightUp, 'click', () => this.nudgeHeight(HEIGHT_NUDGE));
        this._listen(this.ui.retry, 'click', () => void this.retry());

        for (const button of this.document?.querySelectorAll?.('[data-height-preset]') ?? []) {
            this._listen(button, 'click', () => this.setHeightPreset(button.dataset.heightPreset));
        }

        this._listen(this.window, 'keydown', event => {
            if (!this.inputPolicy) return null;
            if (this.inputPolicy.mode === 'browse' && this.phase !== 'ready') return null;
            const command = this.inputPolicy.handleKeyDown(event);
            if (this.inputPolicy.mode === 'browse' && command) {
                return this.selectDirectionalPoint(command);
            }
            return command;
        });
        this._listen(this.window, 'keyup', event => this.inputPolicy?.handleKeyUp(event));
        this._listen(this.window, 'blur', () => this.inputPolicy?.reset());
        this._listen(this.window, 'beforeunload', () => this.dispose());
    }

    _createRuntime() {
        this.sceneManager = this.sceneManagerFactory(this.ui.canvas);
        this.roomRenderer = this.roomRendererFactory(this.sceneManager);
        this.store = this.storeFactory({ repository: this.repository });
        this.inputPolicy = new PanoramaInputPolicy();

        this.miniMap = this.miniMapFactory(this.ui.minimap, {
            documentRef: this.document,
            onSelect: id => void this.selectPoint(id),
            onCreate: point => void this.createPoint(point),
            onAdd: () => this.beginCreatePoint(),
            onRestoreAll: () => void this.restoreAllPoints(),
            onSetEntryView: () => void this.setCurrentEntryView(),
        });
        this.hotspots = this.hotspotsFactory(this.ui.hotspots, {
            documentRef: this.document,
            onSelect: id => void this.selectPoint(id),
        });
        this.runtimeActive = true;
    }

    async init() {
        if (this.disposed) return false;
        if (this.initializing) return this.initializing;
        this.initializing = this._initialize();
        try {
            return await this.initializing;
        } finally {
            this.initializing = null;
        }
    }

    async _initialize() {
        this._bindUi();
        this._setPhase('loading');
        if (!this.runtimeActive) this._createRuntime();

        try {
            const data = await this.dataLoader();
            this.rooms = {
                roomPoints: clone(data.rooms?.roomPoints ?? []),
                roomNames: clone(data.rooms?.roomNames ?? []),
            };
            await this.roomRenderer.render(clone(data), PASSIVE_WALL_REGISTRY);
            this.roomRenderer.setRoomLabelsVisible(false);
            this.sceneManager.setMaterialRestorationEnabled(false);

            const originalPoints = normalizePanoramaPoints(
                data.cameraPresets?.cameraList,
                this.rooms,
            );
            const context = resolvePanoramaDocumentContext({
                search: this.window?.location?.search ?? '',
                dataSourceId: this.dataSourceId,
                roomPoints: this.rooms.roomPoints,
                cameraList: data.cameraPresets?.cameraList ?? [],
            });
            await this.store.initialize({ originalPoints, context });
            this.obstacles = collectContentObstacleBounds(this.roomRenderer.sceneGroup);
            this.editController = new PanoramaEditController({
                store: this.store,
                movementSpeed: 120,
                validator: point => this._validatePoint(point),
                onPreview: preview => this._previewEdit(preview),
            });
            this.storeUnsubscribe = this.store.subscribe(() => this._renderState());
            this._renderState();

            const active = this._activePoint();
            if (active) {
                this._enterPoint(active);
                this._setPhase('ready');
            } else {
                this._setPhase('empty');
            }
            this._startRenderLoop();
            return true;
        } catch (error) {
            this.logger?.error?.('[PanoramaApp] initialization failed', error);
            this._setPhase('error', messageOf(error));
            return false;
        }
    }

    _validatePoint(point) {
        return validatePanoramaPoint(point, {
            roomPoints: this.rooms.roomPoints,
            roomNames: this.rooms.roomNames,
            obstacles: this.obstacles,
            minWallDistance: 80,
            cameraRadius: 80,
        });
    }

    _activePoint() {
        const state = this.store?.getState();
        return state?.points?.find(point => point.id === state.activePointId) ?? null;
    }

    _pointWithView(point) {
        const view = this.store?.getState()?.views?.[point.id];
        return view ? { ...point, ...view } : point;
    }

    _enterPoint(point) {
        if (!point) return false;
        this.roomRenderer.setCeilingsVisible(true);
        return this.sceneManager.setCameraPreset(this._pointWithView(point));
    }

    _transitionToPoint(point, viewOverride = null) {
        if (!point) return false;
        this.roomRenderer.setCeilingsVisible(true);
        const target = this._pointWithView(point);
        return this.sceneManager.transitionCameraPreset(
            viewOverride ? { ...target, ...viewOverride } : target,
            {
            duration: 0.8,
            },
        );
    }

    _renderState() {
        if (!this.store) return;
        const state = this.store.getState();
        this.miniMap?.render({
            roomPoints: this.rooms.roomPoints,
            points: state.points,
            activePointId: state.activePointId,
            dirtyPointIds: state.dirtyPointIds,
            createMode: this.createMode,
        });
        this.hotspots?.render({
            points: state.points,
            activePointId: state.activePointId,
            visible: this.hotspotsVisible,
        });

        if (this.ui.heightValue && this.editController?.getState().workingPoint) {
            this.ui.heightValue.textContent = `${Math.round(this.editController.getState().workingPoint.z)} mm`;
        }
        this._syncPrimaryActions();
    }

    _setPhase(phase, detail = '') {
        this.phase = phase;
        if (this.ui.app) this.ui.app.dataset.state = phase;
        if (this.ui.loading) this.ui.loading.hidden = phase !== 'loading';
        if (this.ui.empty) this.ui.empty.hidden = phase !== 'empty';
        if (this.ui.error) this.ui.error.hidden = phase !== 'error';
        if (this.ui.errorMessage && detail) this.ui.errorMessage.textContent = detail;
        if (this.ui.loadingDetail && phase === 'loading') {
            this.ui.loadingDetail.textContent = '正在加载户型与相机点位…';
        }
        this._syncPrimaryActions();
    }

    _startRenderLoop() {
        this.lastFrameTime = null;
        this.sceneManager.animate(() => {
            const now = globalThis.performance?.now?.() ?? Date.now();
            const delta = this.lastFrameTime == null
                ? 0
                : Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
            this.lastFrameTime = now;
            if (this.editController?.getState().mode === 'edit') {
                const intent = this.inputPolicy.getMovementIntent();
                if (intent.forward || intent.right) {
                    const livePose = this.sceneManager.getCameraPresetPose();
                    const result = this.editController.applyMovement(intent, delta, livePose);
                    if (!result.valid) this.showToast(this._validationMessage(result.code));
                }
            }
            this.hotspots?.update(this.sceneManager.getCamera());
        });
    }

    _validationMessage(code) {
        return {
            OUTSIDE_ROOM: '点位不能移出房间',
            TOO_CLOSE_TO_WALL: '点位距离墙面太近',
            BLOCKED: '点位不能进入固定家具',
        }[code] ?? '当前位置不可用';
    }

    getState() {
        const storeState = this.store?.getState() ?? {
            points: [],
            activePointId: null,
            initialPointId: null,
            views: {},
            dirtyPointIds: [],
        };
        return { phase: this.phase, ...storeState };
    }

    async _saveLiveView() {
        const state = this.store?.getState();
        if (!state?.activePointId) return false;
        const pose = this.sceneManager.getCameraPresetPose();
        if (!pose) return false;
        return this.store.updateView(state.activePointId, {
            yaw: pose.yaw,
            pitch: pose.pitch,
            fov: pose.fov,
        });
    }

    async selectPoint(id, { transitionView = null } = {}) {
        const state = this.store?.getState();
        if (!state || id === state.activePointId) return false;
        const target = state.points.find(point => point.id === id && point.valid !== false);
        if (!target) return false;
        await this._saveLiveView();
        const selected = await this.store.selectPoint(id);
        if (!selected) return false;
        this.createMode = false;
        this._transitionToPoint(this._activePoint(), transitionView);
        this._setPhase('ready');
        return true;
    }

    async selectRelativePoint(offset) {
        const state = this.store?.getState();
        const points = state?.points?.filter(point => point.valid !== false) ?? [];
        if (points.length < 2) return false;
        const currentIndex = Math.max(0, points.findIndex(point => point.id === state.activePointId));
        const nextIndex = (currentIndex + offset + points.length) % points.length;
        return this.selectPoint(points[nextIndex].id);
    }

    async selectDirectionalPoint(direction) {
        if (this.phase !== 'ready' || this.inputPolicy?.mode !== 'browse') return false;
        const activePoint = this._activePoint();
        const pose = this.sceneManager.getCameraPresetPose();
        if (!activePoint || !Number.isFinite(Number(pose?.yaw))) return false;
        const target = selectDirectionalPanoramaPoint({
            activePoint,
            points: this.store.getState().points,
            yaw: Number(pose.yaw),
            direction,
        });
        return target ? this.selectPoint(target.id, {
            transitionView: {
                yaw: Number(pose.yaw),
                pitch: Number(pose.pitch),
                fov: Number(pose.fov),
            },
        }) : false;
    }

    async setCurrentEntryView() {
        const active = this._activePoint();
        const pose = this.sceneManager?.getCameraPresetPose?.();
        const view = {
            yaw: Number(pose?.yaw),
            pitch: Number(pose?.pitch),
            fov: Number(pose?.fov),
        };
        if (!active || !Object.values(view).every(Number.isFinite)) {
            this.showToast('当前视角不可保存');
            return false;
        }
        const changed = await this.store.setEntryView(active.id, view);
        this.showToast(changed ? '已设为进入视角' : '当前已是进入视角');
        return changed;
    }

    resetView() {
        const active = this._activePoint();
        if (!active) return false;
        return this.sceneManager.resetCameraPresetOrientation(this._pointWithView(active));
    }

    toggleHotspots() {
        this.hotspotsVisible = !this.hotspotsVisible;
        this.hotspots?.setVisible(this.hotspotsVisible);
        if (this.ui.hotspotToggle) {
            this.ui.hotspotToggle.textContent = this.hotspotsVisible ? '隐藏热点' : '显示热点';
            this.ui.hotspotToggle.setAttribute?.('aria-pressed', String(this.hotspotsVisible));
        }
        return this.hotspotsVisible;
    }

    beginCreatePoint() {
        this.createMode = true;
        this._renderState();
        this.showToast('请在小地图中选择房间内的位置');
        return true;
    }

    async createPoint(position) {
        if (!this.createMode) return false;
        this.obstacles = collectContentObstacleBounds(this.roomRenderer?.sceneGroup);
        const candidate = {
            x: Number(position.x),
            y: Number(position.y),
            z: DEFAULT_CAMERA_HEIGHT,
        };
        const validation = this._validatePoint(candidate);
        if (!validation.valid) {
            this.showToast(this._validationMessage(validation.code));
            return false;
        }
        const point = await this.store.addPoint({
            name: `点位 ${this.store.getState().points.length + 1}`,
            ...candidate,
            yaw: 0,
            pitch: 0,
            fov: 90,
            valid: true,
            invalidReason: null,
            roomIndex: validation.roomIndex,
            roomName: validation.roomName,
        });
        this.createMode = false;
        const state = this.store.getState();
        if (state.activePointId !== point.id) await this.store.selectPoint(point.id);
        this._enterPoint(this._activePoint());
        this._setPhase('ready');
        return true;
    }

    enterEditMode() {
        const active = this._activePoint();
        const livePose = this.sceneManager.getCameraPresetPose();
        if (!active || !this.editController?.enter(active.id, livePose)) return false;
        this.obstacles = collectContentObstacleBounds(this.roomRenderer?.sceneGroup);
        this.inputPolicy.setMode('edit');
        this._setEditingUi(true);
        return true;
    }

    _previewEdit({ point, view }) {
        this.sceneManager.updateCameraPresetPose(point, { resetView: false });
        if (this.ui.heightValue) this.ui.heightValue.textContent = `${Math.round(point.z)} mm`;
    }

    async saveEdit() {
        if (this.editController?.getState().mode !== 'edit') return false;
        const livePose = this.sceneManager.getCameraPresetPose();
        if (livePose) this.editController.updateView(livePose);
        const saved = await this.editController.save();
        this.inputPolicy.setMode('browse');
        this._setEditingUi(false);
        this._renderState();
        return saved;
    }

    cancelEdit() {
        const cancelled = this.editController?.cancel() ?? false;
        if (!cancelled) return false;
        this.inputPolicy.setMode('browse');
        this._setEditingUi(false);
        this._renderState();
        return true;
    }

    _setEditingUi(editing) {
        this.document?.body?.classList?.toggle('panorama-editing', editing);
        if (this.ui.browseControls) this.ui.browseControls.hidden = editing;
        if (this.ui.editControls) this.ui.editControls.hidden = !editing;
        this._syncPrimaryActions(editing);
    }

    _syncPrimaryActions(editing = this.inputPolicy?.mode === 'edit') {
        const enabled = this.phase === 'ready' && Boolean(this._activePoint());
        if (this.ui.editToggle) this.ui.editToggle.disabled = !enabled || editing;
        if (this.ui.submitRender) this.ui.submitRender.disabled = !enabled || editing;
    }

    setHeightPreset(name) {
        const changed = this.editController?.setHeightPreset(name) ?? false;
        if (changed) this._renderState();
        return changed;
    }

    nudgeHeight(delta) {
        const changed = this.editController?.nudgeHeight(delta) ?? false;
        if (changed) this._renderState();
        return changed;
    }

    async restoreAllPoints() {
        if (this.window?.confirm && !this.window.confirm('确定恢复全部原始点位吗？')) return false;
        const changed = await this.store.restoreAll();
        if (changed) {
            const active = this._activePoint();
            if (active) this._enterPoint(active);
        }
        return changed;
    }

    async toggleFullscreen() {
        if (!this.document) return false;
        if (this.document.fullscreenElement) {
            await this.document.exitFullscreen?.();
            return false;
        }
        await this.ui.app?.requestFullscreen?.();
        return Boolean(this.document.fullscreenElement);
    }

    showToast(message) {
        if (!this.ui.toast || !message) return;
        this.ui.toast.textContent = message;
        this.ui.toast.hidden = false;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            if (this.ui.toast) this.ui.toast.hidden = true;
            this.toastTimer = null;
        }, 1800);
        this.toastTimer?.unref?.();
    }

    async retry() {
        if (this.phase !== 'error') return false;
        this._destroyRuntime();
        return this.init();
    }

    _destroyRuntime() {
        if (!this.runtimeActive) return;
        this.storeUnsubscribe?.();
        this.storeUnsubscribe = null;
        this.miniMap?.dispose();
        this.hotspots?.dispose();
        if (this.roomRenderer?.dispose) {
            this.roomRenderer.dispose(this.sceneManager?.getScene?.());
        }
        this.sceneManager?.destroy?.();
        this.sceneManager = null;
        this.roomRenderer = null;
        this.store = null;
        this.editController = null;
        this.inputPolicy = null;
        this.miniMap = null;
        this.hotspots = null;
        this.runtimeActive = false;
        this.lastFrameTime = null;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = null;
        this._destroyRuntime();
        for (const disposeListener of this.uiDisposers.splice(0)) disposeListener();
        this.uiBound = false;
    }
}

function bootPanoramaPage() {
    const bundledData = new BundledDataSource('data/Drawing2.json', 'data/parsed_dxf');
    geometryService.setDataSource(withSceneFixture(bundledData, globalThis.location?.search ?? ''));
    const app = new PanoramaApp({
        dataSourceId: bundledData.drawingUrl,
    });
    globalThis.occtPanoramaApp = app;
    void app.init();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootPanoramaPage, { once: true });
    } else {
        queueMicrotask(bootPanoramaPage);
    }
}
