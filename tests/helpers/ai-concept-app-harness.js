import * as THREE from 'three';

import { AiConceptApp } from '../../src/AiConceptApp.js';
import { FakeDocument, FakeElement } from './fake-dom.js';

const REQUIRED_IDS = [
    'ai-concept-app', 'ai-concept-canvas', 'ai-concept-status',
    'ai-concept-previous', 'ai-concept-next', 'ai-concept-filmstrip',
    'ai-concept-minimap',
    'ai-concept-selection-count', 'ai-concept-continue',
    'ai-concept-edit-controls', 'ai-concept-edit-cancel', 'ai-concept-edit-save',
    'ai-concept-height-down', 'ai-concept-height-value', 'ai-concept-height-up',
    'ai-concept-loading', 'ai-concept-empty', 'ai-concept-error',
    'ai-concept-error-message', 'ai-concept-retry', 'ai-concept-toast',
    'ai-concept-conditions',
];

function createDocument() {
    const documentRef = new FakeDocument();
    for (const id of REQUIRED_IDS) documentRef.registerElement(id, new FakeElement('div'));
    return documentRef;
}
export function sceneData() {
    return {
        outline: { outlineRings: null },
        rooms: {
            roomPoints: [[[0, 0, 0], [4200, 0, 0], [4200, 3200, 0], [0, 3200, 0]]],
            roomNames: ['客厅'],
            roomInfo: [{ name: '客厅' }],
        },
        doorWindows: {},
        softlists: { softlists: [] },
        contentModels: { contentModels: [] },
    };
}

export function createAiConceptHarness({ loader, repository = null, captureDeferred = null } = {}) {
    const calls = [];
    const captureCalls = [];
    const documentRef = createDocument();
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 10000);
    const sceneManager = {
        pose: null,
        setMaterialRestorationEnabled(value) { calls.push(['white', value]); },
        setCameraPreset(view) { this.pose = { ...view }; calls.push(['camera', view.id]); return true; },
        transitionCameraPreset(view, options) { this.pose = { ...view }; calls.push(['transition', view.id, options]); return true; },
        getCameraPresetPose() { return this.pose ? { ...this.pose } : null; },
        updateCameraPresetPose(view, options) { this.pose = { ...this.pose, ...view }; calls.push(['preview', view.id, options]); return true; },
        getCamera() { return camera; },
        getScene() { return roomRenderer.sceneGroup; },
        getRenderer() { return { name: 'renderer' }; },
        animate(callback) { this.frame = callback; calls.push(['animate']); },
        destroy() { calls.push(['scene-destroy']); },
    };
    const roomRenderer = {
        sceneGroup: new THREE.Group(),
        async render(data, registry) { calls.push(['render', data, registry]); return { contentFailures: 0 }; },
        setRoomLabelsVisible(value) { calls.push(['room-labels', value]); },
        setCeilingsVisible(value) { calls.push(['ceilings', value]); },
        dispose() { calls.push(['room-dispose']); },
    };
    const thumbnailCapture = {
        capture(view) {
            captureCalls.push(['capture', view.id]);
            return captureDeferred?.promise
                ?? Promise.resolve({ status: 'ready', url: `blob:${view.id}`, cacheKey: view.id });
        },
        invalidate(id) { captureCalls.push(['invalidate', id]); },
        dispose() { captureCalls.push(['dispose']); },
    };
    const windowRef = {
        location: { search: '?planId=test-plan&version=v1', hash: '#debug' },
        listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); },
        confirm: () => true,
    };
    const app = new AiConceptApp({
        documentRef,
        windowRef,
        dataSourceId: 'data/Drawing2.json',
        dataLoader: loader ?? (async () => { calls.push(['load']); return sceneData(); }),
        sceneManagerFactory: () => sceneManager,
        roomRendererFactory: () => roomRenderer,
        repository,
        thumbnailCaptureFactory: ({ scene, renderer }) => {
            captureCalls.push(['create', scene, renderer]);
            return thumbnailCapture;
        },
        logger: { error() {} },
    });
    return { app, calls, captureCalls, documentRef, windowRef, sceneManager, roomRenderer, thumbnailCapture };
}
