import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { cameraRecord, createHarness } from './helpers/panorama-app-harness.js';
import { collectContentObstacleBounds } from '../src/PanoramaApp.js';

test('collects fixed content roots as planar movement obstacles', () => {
    const sceneGroup = new THREE.Group();
    const furnitureRoot = new THREE.Group();
    furnitureRoot.userData.contentModelRoot = true;
    furnitureRoot.userData.instanceId = 'chair-1';
    const chair = new THREE.Mesh(new THREE.BoxGeometry(200, 300, 800));
    chair.position.set(1000, 1200, 400);
    furnitureRoot.add(chair);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4000, 200, 3000));
    wall.userData.type = 'wall';
    sceneGroup.add(furnitureRoot, wall);
    sceneGroup.updateMatrixWorld(true);

    assert.deepEqual(collectContentObstacleBounds(sceneGroup), [{
        id: 'chair-1',
        minX: 900,
        minY: 1050,
        minZ: 0,
        maxX: 1100,
        maxY: 1350,
        maxZ: 800,
    }]);
});

test('switching points saves the live view of the previous point before entering the next', async () => {
    const { app, sceneManager, calls } = createHarness({
        cameraList: [
            cameraRecord(1000, 1000, '点位 A'),
            cameraRecord(2500, 1500, '点位 B'),
        ],
    });
    await app.init();
    const [first, second] = app.getState().points;
    await app.store.updateView(second.id, { yaw: 120, pitch: 5, fov: 80 });
    sceneManager.pose = { x: 1000, y: 1000, z: 1500, yaw: 42, pitch: -3, fov: 105 };

    assert.equal(await app.selectPoint(second.id), true);

    const state = app.getState();
    assert.equal(state.activePointId, second.id);
    assert.deepEqual(state.views[first.id], { yaw: 42, pitch: -3, fov: 105 });
    assert.deepEqual(
        { yaw: sceneManager.pose.yaw, pitch: sceneManager.pose.pitch, fov: sceneManager.pose.fov },
        { yaw: 120, pitch: 5, fov: 80 },
    );
    assert.deepEqual(calls.filter(call => call[0] === 'camera'), [
        ['camera', first.name],
    ]);
    assert.deepEqual(calls.filter(call => call[0] === 'camera-transition'), [
        ['camera-transition', second.name, { duration: 0.8 }],
    ]);
});

test('browse WASD selects a point in the live camera direction', async () => {
    const { app, sceneManager, windowRef, calls } = createHarness({
        cameraList: [
            cameraRecord(1000, 1000, 'Point A'),
            cameraRecord(2500, 1000, 'Point B'),
            cameraRecord(1000, 2200, 'Point C'),
        ],
    });
    await app.init();
    const [, forward] = app.getState().points;
    const destinationView = { yaw: 150, pitch: 8, fov: 72 };
    const sourceView = { yaw: 37, pitch: -6, fov: 104 };
    await app.store.updateView(forward.id, destinationView);
    sceneManager.pose = { ...sceneManager.pose, ...sourceView };
    const event = {
        code: 'KeyW',
        repeat: false,
        prevented: false,
        preventDefault() { this.prevented = true; },
    };

    await windowRef.listeners.get('keydown')(event);

    assert.equal(event.prevented, true);
    assert.equal(app.getState().activePointId, forward.id);
    assert.deepEqual(
        { yaw: sceneManager.pose.yaw, pitch: sceneManager.pose.pitch, fov: sceneManager.pose.fov },
        sourceView,
    );
    assert.deepEqual(app.getState().views[forward.id], destinationView);
    assert.equal(calls.filter(call => call[0] === 'camera-transition').at(-1)[1], forward.name);
});

test('browse directional navigation is disabled while editing or outside ready phase', async () => {
    const { app, sceneManager, windowRef } = createHarness({
        cameraList: [
            cameraRecord(1000, 1000, 'Point A'),
            cameraRecord(2500, 1000, 'Point B'),
        ],
    });
    await app.init();
    const initialId = app.getState().activePointId;
    sceneManager.pose = { ...sceneManager.pose, yaw: 0 };
    const keydown = windowRef.listeners.get('keydown');

    app.enterEditMode();
    await keydown({ code: 'KeyW', repeat: false, preventDefault() {} });
    assert.equal(app.getState().activePointId, initialId);
    app.cancelEdit();

    app.phase = 'loading';
    const loadingEvent = {
        code: 'KeyW',
        repeat: false,
        prevented: false,
        preventDefault() { this.prevented = true; },
    };
    await keydown(loadingEvent);
    assert.equal(app.getState().activePointId, initialId);
    assert.equal(loadingEvent.prevented, false);
});

test('edit cancel restores its entry snapshot and save commits a valid preview', async () => {
    const { app, documentRef } = createHarness();
    await app.init();
    const activeId = app.getState().activePointId;

    assert.equal(app.enterEditMode(), true);
    assert.equal(documentRef.body.classList.contains('panorama-editing'), true);
    app.editController.applyMovement({ forward: 1, right: 0 }, 0.5);
    assert.equal(app.cancelEdit(), true);
    assert.equal(app.getState().points[0].x, 1000);

    assert.equal(app.enterEditMode(), true);
    app.editController.applyMovement({ forward: 1, right: 0 }, 0.5);
    assert.equal(await app.saveEdit(), true);
    assert.equal(app.getState().points.find(point => point.id === activeId).x, 1060);
    assert.equal(documentRef.body.classList.contains('panorama-editing'), false);
});

test('position previews preserve the live camera orientation', async () => {
    const { app, sceneManager } = createHarness();
    await app.init();
    assert.equal(app.enterEditMode(), true);
    sceneManager.pose = {
        ...sceneManager.pose,
        yaw: 75,
        pitch: -7,
        fov: 110,
    };

    app._previewEdit({
        point: { ...app.editController.getState().workingPoint, x: 1010 },
        view: { yaw: 0, pitch: 0, fov: 90 },
    });

    assert.equal(sceneManager.pose.x, 1010);
    assert.deepEqual(
        { yaw: sceneManager.pose.yaw, pitch: sceneManager.pose.pitch, fov: sceneManager.pose.fov },
        { yaw: 75, pitch: -7, fov: 110 },
    );
});

test('edit render loop moves relative to the camera view rotated after entering edit mode', async () => {
    const { app, sceneManager } = createHarness();
    await app.init();
    assert.equal(app.enterEditMode(), true);
    sceneManager.pose = { ...sceneManager.pose, yaw: 90, pitch: -4, fov: 100 };
    app.inputPolicy.pressed.add('forward');
    app.lastFrameTime = (globalThis.performance?.now?.() ?? Date.now()) - 50;

    sceneManager.frame();

    const working = app.editController.getState();
    assert.equal(Math.abs(working.workingPoint.x - 1000) < 1e-8, true);
    assert.equal(working.workingPoint.y > 1000, true);
    assert.equal(working.workingView.yaw, 90);
});

test('dispose releases subscriptions, components, keyboard handlers, and scene resources once', async () => {
    const { app, calls, windowRef } = createHarness();
    await app.init();

    app.dispose();
    app.dispose();

    assert.equal(calls.filter(call => call[0] === 'scene-destroy').length, 1);
    assert.equal(calls.filter(call => call[0] === 'room-dispose').length, 1);
    assert.equal(windowRef.listeners.size, 0);
});
