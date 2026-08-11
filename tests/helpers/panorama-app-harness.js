import * as THREE from 'three';

import { PanoramaApp } from '../../src/PanoramaApp.js';
import { FakeDocument, FakeElement } from './fake-dom.js';

const REQUIRED_IDS = [
    'panorama-app', 'panorama-canvas', 'panorama-topbar', 'panorama-plan-name',
    'panorama-plan-version', 'panorama-room-name', 'panorama-point-name',
    'panorama-edit-toggle', 'panorama-generate', 'panorama-minimap',
    'panorama-point-panel', 'panorama-point-count', 'panorama-point-panel-toggle',
    'panorama-point-list', 'panorama-add-point', 'panorama-restore-all',
    'panorama-hotspots', 'panorama-browse-controls', 'panorama-edit-controls',
    'panorama-previous', 'panorama-next', 'panorama-reset-view',
    'panorama-hotspot-toggle', 'panorama-fullscreen', 'panorama-height-down',
    'panorama-height-value', 'panorama-height-up', 'panorama-edit-cancel',
    'panorama-edit-save', 'panorama-loading', 'panorama-loading-detail',
    'panorama-empty', 'panorama-empty-create', 'panorama-error',
    'panorama-error-message', 'panorama-retry', 'panorama-toast',
];

function createDocument() {
    const documentRef = new FakeDocument();
    for (const id of REQUIRED_IDS) documentRef.registerElement(id, new FakeElement('div'));
    return documentRef;
}

export function cameraRecord(x, y, name) {
    return {
        TypeId: '27d2',
        BasePoint: `X=${x} Y=${y} Z=0`,
        DisplayName: name,
        BlockInnerInfo: { 离地高度: 1500, 旋转角度: 0, FOV: 90 },
    };
}

export function sceneData(cameraList) {
    return {
        outline: { outlineRings: null },
        rooms: {
            roomPoints: [[[0, 0, 0], [4000, 0, 0], [4000, 3000, 0], [0, 3000, 0]]],
            roomNames: ['客厅'],
            roomInfo: [],
        },
        doorWindows: {},
        softlists: { softlists: [] },
        contentModels: { contentModels: [] },
        cameraPresets: { cameraList },
    };
}

export function createHarness({
    cameraList = [cameraRecord(1000, 1000, '点位 A')],
    loader,
} = {}) {
    const calls = [];
    const documentRef = createDocument();
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 10000);
    const sceneManager = {
        pose: null,
        setMaterialRestorationEnabled(value) { calls.push(['white', value]); },
        setCameraPreset(point) { this.pose = { ...point }; calls.push(['camera', point.name]); return true; },
        getCameraPresetPose() { return this.pose ? { ...this.pose } : null; },
        updateCameraPresetPose(point) { this.pose = { ...this.pose, ...point }; calls.push(['preview', point.x]); return true; },
        resetCameraPresetOrientation(point) { this.pose = { ...point }; calls.push(['reset', point.name]); return true; },
        getCamera() { return camera; },
        animate(callback) { this.frame = callback; calls.push(['animate']); },
        destroy() { calls.push(['scene-destroy']); },
    };
    const roomRenderer = {
        async render(data) { calls.push(['render', data]); return { contentFailures: 0 }; },
        setCeilingsVisible(value) { calls.push(['ceilings', value]); return value; },
        dispose() { calls.push(['room-dispose']); },
    };
    const windowRef = {
        location: { search: '?planId=test-plan&version=v1', hash: '#debug' },
        listeners: new Map(),
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (this.listeners.get(type) === listener) this.listeners.delete(type);
        },
        confirm: () => true,
        prompt: (_message, value) => value,
    };
    const app = new PanoramaApp({
        documentRef,
        windowRef,
        dataSourceId: 'data/Drawing2.json',
        dataLoader: loader ?? (async () => {
            calls.push(['load']);
            return sceneData(cameraList);
        }),
        sceneManagerFactory: () => sceneManager,
        roomRendererFactory: () => roomRenderer,
        repository: null,
        logger: { error() {} },
    });
    return { app, calls, documentRef, windowRef, sceneManager, roomRenderer };
}
