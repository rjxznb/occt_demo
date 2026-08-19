import { SceneManager } from './core/SceneManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { geometryService } from './core/GeometryService.js';
import { BundledDataSource, RendererPreviewDataSource, withSceneFixture } from './core/DataSource.js';
import { collectContentObstacleBounds } from './shared/ContentObstacleBounds.js';
import { validatePanoramaPoint } from './panorama/PanoramaPointValidator.js';
import { PanoramaInputPolicy } from './panorama/PanoramaInputPolicy.js';
import { resolveAiDocumentContext } from './ai-concept/AiDocumentContext.js';
import { LocalAiViewRepository } from './ai-concept/AiViewRepository.js';
import { generateAiViewCandidates } from './ai-concept/AiViewCandidateGenerator.js';
import { AiViewStore } from './ai-concept/AiViewStore.js';
import { AiViewFilmstrip } from './ai-concept/AiViewFilmstrip.js';
import { AiViewEditController } from './ai-concept/AiViewEditController.js';
import { AiViewMiniMap } from './ai-concept/AiViewMiniMap.js';
import { AiViewThumbnailCapture } from './ai-concept/AiViewThumbnailCapture.js';
import { AiViewGenerationCapture } from './ai-concept/AiViewGenerationCapture.js';
import { AiGenerationConditionsDialog } from './ai-concept/AiGenerationConditionsDialog.js';
import { LocalAiGenerationConditionRepository } from './ai-concept/AiGenerationConditionRepository.js';
import { AiGenerationClient } from './ai-concept/AiGenerationClient.js';
import { AiGenerationJobStore } from './ai-concept/AiGenerationJobStore.js';
import { AiGenerationProgress } from './ai-concept/AiGenerationProgress.js';
import {
    DEFAULT_GENERATION_CONDITIONS,
    ENVIRONMENT_CATALOG,
    MAX_IMAGES_PER_JOB,
    STYLE_CATALOG,
    normalizeGenerationConditions,
} from './ai-concept/AiGenerationCatalog.js';

const PASSIVE_WALL_REGISTRY = Object.freeze({ addWall() {}, addWalls() {} });
const HEIGHT_NUDGE = 50;

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function messageOf(error) {
    return typeof error?.code === 'string'
        ? error.code
        : error instanceof Error ? error.message : String(error);
}

function activeJobKey(context) {
    return `occt.ai-concept-generation.active:${encodeURIComponent(context?.planId ?? '')}:${encodeURIComponent(context?.version ?? '')}`;
}

function safeStorageCall(storage, method, ...args) {
    try { return storage?.[method]?.(...args) ?? null; } catch { return null; }
}

function canSubmitView(view) {
    return Boolean(view)
        && view.valid !== false
        && !['excluded', 'disabled'].includes(view.status);
}

export async function loadAiConceptSceneData(service = geometryService) {
    await service.init();
    const [outline, rooms, doorWindows, softlists, contentModels] = await Promise.all([
        service.getOutline(),
        service.getRooms(),
        service.getDoorsAndWindows(),
        service.getSoftlists(),
        service.getContentModels(),
    ]);
    return { outline, rooms, doorWindows, softlists, contentModels };
}

export class AiConceptApp {
    constructor({
        documentRef = globalThis.document,
        windowRef = globalThis.window,
        dataSourceId = 'data/Drawing2.json',
        dataLoader = () => loadAiConceptSceneData(),
        sceneManagerFactory = container => new SceneManager(container),
        roomRendererFactory = manager => new RoomRenderer(manager),
        repository = undefined,
        storeFactory = options => new AiViewStore(options),
        generator = generateAiViewCandidates,
        filmstripFactory = (container, options) => new AiViewFilmstrip(container, options),
        miniMapFactory = (container, options) => new AiViewMiniMap(container, options),
        thumbnailCaptureFactory = options => new AiViewThumbnailCapture(options),
        generationCaptureFactory = options => new AiViewGenerationCapture(options),
        generationDialogFactory = (container, options) => new AiGenerationConditionsDialog(container, options),
        generationConditionRepository = undefined,
        generationClientFactory = () => new AiGenerationClient(),
        generationJobStoreFactory = options => new AiGenerationJobStore(options),
        generationProgressFactory = (container, options) => new AiGenerationProgress(container, options),
        generationJobStorage = globalThis.localStorage,
        requestIdFactory = () => globalThis.crypto?.randomUUID?.()
            ?? `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        logger = console,
    } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.dataSourceId = dataSourceId;
        this.dataLoader = dataLoader;
        this.sceneManagerFactory = sceneManagerFactory;
        this.roomRendererFactory = roomRendererFactory;
        this.repository = repository === undefined ? new LocalAiViewRepository() : repository;
        this.storeFactory = storeFactory;
        this.generator = generator;
        this.filmstripFactory = filmstripFactory;
        this.miniMapFactory = miniMapFactory;
        this.thumbnailCaptureFactory = thumbnailCaptureFactory;
        this.generationCaptureFactory = generationCaptureFactory;
        this.generationDialogFactory = generationDialogFactory;
        this.generationConditionRepository = generationConditionRepository === undefined
            ? new LocalAiGenerationConditionRepository()
            : generationConditionRepository;
        this.generationClientFactory = generationClientFactory;
        this.generationJobStoreFactory = generationJobStoreFactory;
        this.generationProgressFactory = generationProgressFactory;
        this.generationJobStorage = generationJobStorage;
        this.requestIdFactory = requestIdFactory;
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
        this.filmstrip = null;
        this.miniMap = null;
        this.thumbnailCapture = null;
        this.generationCapture = null;
        this.generationDialog = null;
        this.generationClient = null;
        this.generationJobStore = null;
        this.generationProgress = null;
        this.generationJobUnsubscribe = null;
        this.documentContext = null;
        this.generationConditions = clone(DEFAULT_GENERATION_CONDITIONS);
        this.thumbnailStates = new Map();
        this.runtimeGeneration = 0;
        this.editController = null;
        this.inputPolicy = null;
        this.rooms = { roomPoints: [], roomNames: [], roomInfo: [] };
        this.obstacles = null;
        this.lastFrameTime = null;
        this.ui = {};
    }

    _element(id) { return this.document?.getElementById?.(id) ?? null; }

    _collectUi() {
        const ids = [
            'ai-concept-app', 'ai-concept-canvas', 'ai-concept-status',
            'ai-concept-previous', 'ai-concept-next', 'ai-concept-filmstrip',
            'ai-concept-minimap',
            'ai-concept-primary-actions', 'ai-concept-continue',
            'ai-concept-edit-controls', 'ai-concept-edit-cancel', 'ai-concept-edit-save',
            'ai-concept-height-down', 'ai-concept-height-value', 'ai-concept-height-up',
            'ai-concept-loading', 'ai-concept-empty', 'ai-concept-error',
            'ai-concept-error-message', 'ai-concept-retry', 'ai-concept-toast',
            'ai-concept-conditions',
            'ai-concept-generation-progress',
        ];
        this.ui = Object.fromEntries(ids.map(id => [
            id.replace(/^ai-concept-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
            this._element(id),
        ]));
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
        this._listen(this.ui.previous, 'click', () => void this.selectRelativeView(-1));
        this._listen(this.ui.next, 'click', () => void this.selectRelativeView(1));
        this._listen(this.ui.continue, 'click', () => this.continueToConditions());
        this._listen(this.ui.editCancel, 'click', () => this.cancelEdit());
        this._listen(this.ui.editSave, 'click', () => void this.saveEdit());
        this._listen(this.ui.heightDown, 'click', () => this.nudgeHeight(-HEIGHT_NUDGE));
        this._listen(this.ui.heightUp, 'click', () => this.nudgeHeight(HEIGHT_NUDGE));
        this._listen(this.ui.retry, 'click', () => void this.retry());
        for (const preset of this.document?.querySelectorAll?.('[data-height-preset]') ?? []) {
            this._listen(preset, 'click', () => this.setHeightPreset(preset.dataset.heightPreset));
        }
        this._listen(this.window, 'keydown', event => this.inputPolicy?.handleKeyDown(event));
        this._listen(this.window, 'keyup', event => this.inputPolicy?.handleKeyUp(event));
        this._listen(this.window, 'blur', () => this.inputPolicy?.reset());
        this._listen(this.window, 'beforeunload', () => this.dispose());
    }

    _createRuntime() {
        this.sceneManager = this.sceneManagerFactory(this.ui.canvas);
        this.roomRenderer = this.roomRendererFactory(this.sceneManager);
        this.store = this.storeFactory({ repository: this.repository });
        this.inputPolicy = new PanoramaInputPolicy();
        this.filmstrip = this.filmstripFactory(this.ui.filmstrip, {
            documentRef: this.document,
            onActivate: id => void this.selectView(id),
            onEdit: id => void this.enterEditMode(id),
            onDelete: id => void this.deleteView(id),
            onRestore: () => void this.restoreExcluded(),
            onAdd: () => void this.addCustomView(),
            onRetryThumbnail: id => void this.retryThumbnail(id),
        });
        this.miniMap = this.miniMapFactory(this.ui.minimap, {
            documentRef: this.document,
            onSelect: id => void this.selectView(id),
        });
        this.generationDialog = this.generationDialogFactory(this.ui.conditions, {
            documentRef: this.document,
            eventTarget: this.window,
            onSubmit: conditions => this._submitGenerationConditions(conditions),
            onCancel: () => this.cancelGenerationConditions(),
        });
        this.generationClient = this.generationClientFactory();
        this.generationJobStore = this.generationJobStoreFactory({ client: this.generationClient });
        this.generationProgress = this.generationProgressFactory(this.ui.generationProgress, {
            documentRef: this.document,
            onRetry: id => void this.generationJobStore?.retry?.(id),
            onCancel: () => void this.generationJobStore?.cancel?.(),
        });
        this.generationJobUnsubscribe = this.generationJobStore?.subscribe?.(state => {
            this.generationProgress?.render?.(state);
        }) ?? null;
        this.runtimeGeneration += 1;
        this.runtimeActive = true;
    }

    async init() {
        if (this.disposed) return false;
        if (this.initializing) return this.initializing;
        this.initializing = this._initialize();
        try { return await this.initializing; } finally { this.initializing = null; }
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
                roomInfo: clone(data.rooms?.roomInfo ?? []),
            };
            if (!this.rooms.roomPoints.length) throw new Error('户型中没有可分析的房间');
            const renderResult = await this.roomRenderer.render(
                clone(data),
                PASSIVE_WALL_REGISTRY,
            );
            await renderResult?.contentLoad;
            this.roomRenderer.setRoomLabelsVisible(false);
            this.roomRenderer.setCeilingsVisible(true);
            this.sceneManager.setMaterialRestorationEnabled(false);
            this.obstacles = collectContentObstacleBounds(this.roomRenderer.sceneGroup);
            this.thumbnailCapture = this.thumbnailCaptureFactory({
                scene: this.sceneManager.getScene(),
                renderer: this.sceneManager.getRenderer(),
            });
            this.generationCapture = this.generationCaptureFactory({
                scene: this.sceneManager.getScene(),
                renderer: this.sceneManager.getRenderer(),
            });
            const context = resolveAiDocumentContext({
                search: this.window?.location?.search ?? '',
                dataSourceId: this.dataSourceId,
                roomPoints: this.rooms.roomPoints,
                roomNames: this.rooms.roomNames,
                contentModels: data.contentModels?.contentModels ?? [],
            });
            this.documentContext = context;
            const generated = this.generator({
                context,
                rooms: this.rooms,
                doorWindows: data.doorWindows,
                obstacles: this.obstacles,
            });
            await this.store.initialize({
                generatedViews: generated.candidates,
                roomResults: generated.roomResults,
                context,
            });
            const conditionDraft = await this.generationConditionRepository?.load?.(context);
            this.generationConditions = conditionDraft?.ok
                ? normalizeGenerationConditions(conditionDraft.conditions)
                : clone(DEFAULT_GENERATION_CONDITIONS);
            this.editController = new AiViewEditController({
                store: this.store,
                validator: view => this._validateView(view),
                onPreview: preview => this._previewEdit(preview),
            });
            this.storeUnsubscribe = this.store.subscribe(() => this._renderState());
            this._renderState();
            const active = this._activeView();
            if (active) {
                this._enterView(active);
                this._queueMissingThumbnails(this.store.getState().views);
                const activeJobId = safeStorageCall(
                    this.generationJobStorage, 'getItem', activeJobKey(context),
                );
                if (activeJobId) {
                    this._setPhase('generation');
                    await this.generationJobStore?.start?.(activeJobId);
                } else {
                    this._setPhase('ready');
                }
            } else {
                this._setPhase('empty');
            }
            this._startRenderLoop();
            return true;
        } catch (error) {
            this.logger?.error?.('[AiConceptApp] initialization failed', error);
            this._setPhase('error', messageOf(error));
            return false;
        }
    }

    _validateView(view) {
        return validatePanoramaPoint(view, {
            roomPoints: this.rooms.roomPoints,
            roomNames: this.rooms.roomNames,
            obstacles: this.obstacles,
            minWallDistance: 80,
            cameraRadius: 80,
        });
    }

    _activeView() {
        const state = this.store?.getState();
        return state?.views?.find(view => view.id === state.activeViewId) ?? null;
    }

    _enterView(view) {
        if (!view) return false;
        this.roomRenderer.setCeilingsVisible(true);
        return this.sceneManager.setCameraPreset(view);
    }

    _transitionView(view) {
        if (!view) return false;
        this.roomRenderer.setCeilingsVisible(true);
        return this.sceneManager.transitionCameraPreset(view, { duration: 0.55 });
    }

    getState() {
        return {
            ...(this.store?.getState() ?? { views: [], activeViewId: null }),
            phase: this.phase,
            generation: this.generationJobStore?.getState?.() ?? null,
        };
    }

    _setPhase(phase, detail = '') {
        this.phase = phase;
        this._syncCameraInteraction();
        if (this.ui.app) this.ui.app.dataset.state = phase;
        if (this.ui.loading) this.ui.loading.hidden = phase !== 'loading';
        if (this.ui.empty) this.ui.empty.hidden = phase !== 'empty';
        if (this.ui.error) this.ui.error.hidden = phase !== 'error';
        if (this.ui.conditions) this.ui.conditions.hidden = phase !== 'conditions';
        if (this.ui.generationProgress) this.ui.generationProgress.hidden = phase !== 'generation';
        if (this.ui.errorMessage && detail) this.ui.errorMessage.textContent = detail;
        this._syncActions();
    }

    _syncCameraInteraction() {
        this.sceneManager?.setCameraPresetInteractionEnabled?.(this.phase === 'editing');
    }

    _renderState() {
        const state = this.store?.getState();
        if (!state) return;
        this.filmstrip?.render({ ...state, thumbnails: this.thumbnailStates });
        this.miniMap?.render({
            roomPoints: this.rooms.roomPoints,
            views: state.views,
            activeViewId: state.activeViewId,
        });
        if (this.ui.heightValue && this.editController?.getState().workingView) {
            this.ui.heightValue.textContent = `${Math.round(this.editController.getState().workingView.z)} mm`;
        }
        this._syncActions();
    }

    _syncActions() {
        const state = this.store?.getState();
        const editing = this.phase === 'editing';
        const focused = editing || this.phase === 'generation';
        if (this.ui.previous) this.ui.previous.disabled = editing || this.phase !== 'ready';
        if (this.ui.next) this.ui.next.disabled = editing || this.phase !== 'ready';
        if (this.ui.continue) this.ui.continue.disabled = editing || !state?.canContinue || this.phase !== 'ready';
        if (this.ui.filmstrip) this.ui.filmstrip.hidden = focused;
        if (this.ui.previous) this.ui.previous.hidden = focused;
        if (this.ui.next) this.ui.next.hidden = focused;
        if (this.ui.primaryActions) this.ui.primaryActions.hidden = focused;
        if (this.ui.editControls) this.ui.editControls.hidden = !editing;
        this.document?.documentElement?.classList?.toggle('ai-concept-editing', editing);
    }

    async selectView(id) {
        if (this.phase !== 'ready') return false;
        const changed = await this.store.setActiveView(id);
        if (!changed) return false;
        this._transitionView(this._activeView());
        this.filmstrip?.scrollViewIntoView?.(id);
        return true;
    }

    async selectRelativeView(offset) {
        if (this.phase !== 'ready') return false;
        const state = this.store.getState();
        const views = state.views.filter(view => view.valid !== false
            && !['excluded', 'disabled'].includes(view.status));
        if (views.length < 2) return false;
        const index = Math.max(0, views.findIndex(view => view.id === state.activeViewId));
        return this.selectView(views[(index + offset + views.length) % views.length].id);
    }

    async selectRoom(roomId) {
        if (this.phase !== 'ready') return false;
        const changed = await this.store.setRoomFilter(roomId);
        if (changed) this._transitionView(this._activeView());
        return changed;
    }

    async excludeView(id) {
        if (this.phase !== 'ready') return false;
        const changed = await this.store.excludeView(id);
        if (changed) {
            this.thumbnailCapture?.invalidate?.(id);
            this.thumbnailStates.delete(id);
            this._transitionView(this._activeView());
        }
        return changed;
    }

    async deleteView(id) {
        const view = this.store?.getState().views.find(candidate => candidate.id === id);
        if (!view || this.phase !== 'ready') return false;
        if (!this.window?.confirm?.(`确认删除“${view.name}”吗？`)) return false;
        if (view.source === 'auto') return this.excludeView(id);
        const changed = await this.store.deleteCustomView(id);
        if (changed) {
            this.thumbnailCapture?.invalidate?.(id);
            this.thumbnailStates.delete(id);
            this._transitionView(this._activeView());
        }
        return changed;
    }

    async restoreExcluded() {
        if (this.phase !== 'ready') return false;
        const changed = await this.store.restoreExcluded();
        if (changed) this._queueMissingThumbnails(this.store.getState().views);
        return changed;
    }

    async addCustomView() {
        if (this.phase !== 'ready') return false;
        const active = this._activeView();
        if (!active) return false;
        const custom = await this.store.addCustomView({
            ...active,
            id: undefined,
            name: `自定义视角 ${this.store.getState().views.filter(view => view.source === 'custom').length + 1}`,
            source: 'custom',
            selected: false,
            generationReason: 'custom',
        });
        this._enterView(custom);
        await this.enterEditMode(custom.id);
        return custom;
    }

    async enterEditMode(id = this.store?.getState().activeViewId) {
        if (this.phase !== 'ready') return false;
        if (id !== this.store.getState().activeViewId) await this.selectView(id);
        const entered = this.editController.enter(id, this.sceneManager.getCameraPresetPose());
        if (!entered) return false;
        this.inputPolicy.setMode('edit');
        await this.store.setPhase('editing', id);
        this._setPhase('editing');
        return true;
    }

    async saveEdit() {
        if (this.phase !== 'editing') return false;
        const result = await this.editController.save();
        if (result && result.valid === false) return result;
        this.inputPolicy.setMode('browse');
        await this.store.setPhase('ready');
        this._setPhase('ready');
        this._enterView(this._activeView());
        const active = this._activeView();
        if (active) {
            this.thumbnailCapture?.invalidate?.(active.id);
            this.thumbnailStates.delete(active.id);
            this._queueThumbnail(active, { force: true });
        }
        return result;
    }

    cancelEdit() {
        if (this.phase !== 'editing' || !this.editController.cancel()) return false;
        this.inputPolicy.setMode('browse');
        void this.store.setPhase('ready');
        this._setPhase('ready');
        return true;
    }

    setHeightPreset(name) { return this.editController?.setHeightPreset(name) ?? false; }
    nudgeHeight(delta) { return this.editController?.nudgeHeight(delta) ?? false; }

    _previewEdit({ point, view }) {
        this.sceneManager.updateCameraPresetPose({ ...point, ...view }, { resetView: true });
        this._renderState();
    }

    _queueMissingThumbnails(views = []) {
        for (const view of views) this._queueThumbnail(view);
    }

    _queueThumbnail(view, { force = false } = {}) {
        if (!view || view.valid === false || ['excluded', 'disabled'].includes(view.status)
            || !this.thumbnailCapture || !this.runtimeActive) return false;
        const current = this.thumbnailStates.get(view.id);
        if (!force && ['loading', 'ready'].includes(current?.status)) return false;
        const generation = this.runtimeGeneration;
        this.thumbnailStates.set(view.id, { status: 'loading' });
        this._renderState();
        void this.thumbnailCapture.capture(view).then(result => {
            if (!this.runtimeActive || generation !== this.runtimeGeneration) return;
            this.thumbnailStates.set(view.id, result);
            this._renderState();
        }).catch(error => {
            if (!this.runtimeActive || generation !== this.runtimeGeneration) return;
            this.thumbnailStates.set(view.id, { status: 'error', code: messageOf(error) });
            this._renderState();
        });
        return true;
    }

    retryThumbnail(id) {
        if (this.phase !== 'ready') return false;
        const view = this.store?.getState().views.find(candidate => candidate.id === id);
        return this._queueThumbnail(view, { force: true });
    }

    _startRenderLoop() {
        this.lastFrameTime = null;
        this.sceneManager.animate(() => {
            const now = globalThis.performance?.now?.() ?? Date.now();
            const delta = this.lastFrameTime == null ? 0 : Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
            this.lastFrameTime = now;
            if (this.phase !== 'editing') return;
            const intent = this.inputPolicy.getMovementIntent();
            if (intent.forward || intent.right) {
                this.editController.applyMovement(intent, delta, this.sceneManager.getCameraPresetPose());
            }
        });
    }

    continueToConditions() {
        const state = this.store?.getState();
        if (this.phase !== 'ready' || !state?.canContinue) return false;
        const payload = {
            context: clone(state.context),
            selectedViews: clone(state.views.filter(canSubmitView)),
        };
        this._setPhase('conditions');
        this.generationDialog?.open?.({
            catalog: {
                styles: STYLE_CATALOG,
                environments: ENVIRONMENT_CATALOG,
                maxImagesPerJob: MAX_IMAGES_PER_JOB,
            },
            conditions: clone(this.generationConditions),
            viewCount: payload.selectedViews.length,
        });
        return payload;
    }

    cancelGenerationConditions() {
        if (this.phase !== 'conditions') return false;
        this.generationDialog?.close?.();
        this._setPhase('ready');
        return true;
    }

    async _submitGenerationConditions(input) {
        if (this.phase !== 'conditions') return false;
        const conditions = normalizeGenerationConditions(input);
        this.generationConditions = clone(conditions);
        const context = this.store?.getState()?.context;
        this.generationDialog?.setSubmitting?.(true);
        try {
            await this.generationConditionRepository?.save?.(context, conditions);
            const catalog = await this.generationClient.getCatalog();
            if (catalog?.configured !== true) {
                const error = new Error('OPENAI_NOT_CONFIGURED');
                error.code = 'OPENAI_NOT_CONFIGURED';
                throw error;
            }
            const views = this.store.getState().views.filter(canSubmitView);
            const captures = await this.generationCapture.captureAll(views);
            const captureById = new Map(captures.map(capture => [capture.viewId, capture]));
            const payload = {
                requestId: this.requestIdFactory(),
                planId: context.planId,
                planVersion: context.version,
                whiteModelVersion: context.version,
                styleIds: conditions.styleIds,
                environmentIds: conditions.environmentIds,
                views: views.map(view => ({
                    id: view.id,
                    roomId: view.roomId,
                    roomName: view.roomName,
                    name: view.name,
                    x: view.x, y: view.y, z: view.z,
                    yaw: view.yaw, pitch: view.pitch, fov: view.fov,
                    dataUrl: captureById.get(view.id)?.dataUrl,
                })),
            };
            const job = await this.generationClient.createJob(payload);
            if (!job?.id) throw new Error('INVALID_RESPONSE');
            safeStorageCall(this.generationJobStorage, 'setItem', activeJobKey(context), job.id);
            this.generationDialog?.setSubmitting?.(false);
            this.generationDialog?.close?.();
            this._setPhase('generation');
            await this.generationJobStore.start(job.id);
            return true;
        } catch (error) {
            this.generationDialog?.setSubmitting?.(false);
            this.generationDialog?.showError?.(messageOf(error));
            return false;
        }
    }

    async retry() {
        if (this.phase !== 'error') return false;
        this._destroyRuntime();
        return this.init();
    }

    _destroyRuntime() {
        if (!this.runtimeActive) return;
        this.runtimeGeneration += 1;
        this.sceneManager?.setCameraPresetInteractionEnabled?.(false);
        this.storeUnsubscribe?.();
        this.storeUnsubscribe = null;
        this.roomRenderer?.dispose?.(this.sceneManager?.getScene?.());
        this.sceneManager?.destroy?.();
        this.thumbnailCapture?.dispose?.();
        this.generationCapture?.dispose?.();
        this.generationDialog?.dispose?.();
        this.generationJobUnsubscribe?.();
        this.generationJobStore?.stop?.();
        this.miniMap?.dispose?.();
        this.sceneManager = null;
        this.roomRenderer = null;
        this.store = null;
        this.filmstrip = null;
        this.miniMap = null;
        this.thumbnailCapture = null;
        this.generationCapture = null;
        this.generationDialog = null;
        this.generationClient = null;
        this.generationJobStore = null;
        this.generationProgress = null;
        this.generationJobUnsubscribe = null;
        this.documentContext = null;
        this.thumbnailStates.clear();
        this.editController = null;
        this.inputPolicy = null;
        this.runtimeActive = false;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this._destroyRuntime();
        for (const disposeListener of this.uiDisposers.splice(0)) disposeListener();
        this.document?.documentElement?.classList?.remove('ai-concept-editing');
    }
}

function bootAiConceptPage() {
    const bundledData = new BundledDataSource('data/Drawing2.json', 'data/parsed_dxf');
    const dataSource = new RendererPreviewDataSource({
        windowRef: globalThis.window,
        fallback: bundledData,
    });
    geometryService.setDataSource(withSceneFixture(dataSource, globalThis.location?.search ?? ''));
    const app = new AiConceptApp({ dataSourceId: 'cad-render-preview' });
    globalThis.occtAiConceptApp = app;
    void app.init();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAiConceptPage, { once: true });
    else queueMicrotask(bootAiConceptPage);
}
