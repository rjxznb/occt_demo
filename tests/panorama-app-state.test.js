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
        maxX: 1100,
        maxY: 1350,
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
    sceneManager.pose = { x: 1000, y: 1000, z: 1500, yaw: 42, pitch: -3, fov: 105 };

    assert.equal(await app.selectPoint(second.id), true);

    const state = app.getState();
    assert.equal(state.activePointId, second.id);
    assert.deepEqual(state.views[first.id], { yaw: 42, pitch: -3, fov: 105 });
    assert.deepEqual(calls.filter(call => call[0] === 'camera'), [
        ['camera', first.name],
    ]);
    assert.deepEqual(calls.filter(call => call[0] === 'camera-transition'), [
        ['camera-transition', second.name, { duration: 0.8 }],
    ]);
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

test('dispose releases subscriptions, components, keyboard handlers, and scene resources once', async () => {
    const { app, calls, windowRef } = createHarness();
    await app.init();

    app.dispose();
    app.dispose();

    assert.equal(calls.filter(call => call[0] === 'scene-destroy').length, 1);
    assert.equal(calls.filter(call => call[0] === 'room-dispose').length, 1);
    assert.equal(windowRef.listeners.size, 0);
});
