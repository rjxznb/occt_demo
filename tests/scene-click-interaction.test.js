import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    classifySceneClick,
    decideRoomPanelAction,
    findParametricSoftlistRoot,
    isSceneDebugEnabled,
    logParametricSoftlistDebug,
} from '../src/components/SceneClickInteraction.js';

test('the nearest model hit is classified before an underlying room target', () => {
    const modelRoot = new THREE.Group();
    modelRoot.userData = {
        type: 'parametric-softlist',
        debugInfo: { typeId: '9', softlistId: 'soft-9' },
    };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    modelRoot.add(mesh);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry());
    floor.userData = { type: 'floor', roomIndex: 3, roomInfo: { name: '客厅' } };

    assert.deepEqual(classifySceneClick(mesh), { kind: 'model', modelRoot });
    assert.deepEqual(classifySceneClick(floor), {
        kind: 'room', roomIndex: 3, roomInfo: floor.userData.roomInfo,
    });
    assert.deepEqual(classifySceneClick(new THREE.Object3D()), { kind: 'none' });
});

test('room panel opens, toggles off, and switches rooms', () => {
    assert.deepEqual(decideRoomPanelAction(null, false, 2), {
        action: 'show', roomIndex: 2,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, 2), {
        action: 'hide', roomIndex: null,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, 5), {
        action: 'show', roomIndex: 5,
    });
    assert.deepEqual(decideRoomPanelAction(2, true, null), {
        action: 'hide', roomIndex: null,
    });
});

test('a child mesh resolves to its parametric softlist instance root', () => {
    const root = new THREE.Group();
    root.userData = {
        type: 'parametric-softlist',
        debugInfo: { typeId: '101', softlistId: 'soft-1' },
    };
    const nested = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(nested);
    nested.add(mesh);

    assert.equal(findParametricSoftlistRoot(mesh), root);
    assert.equal(findParametricSoftlistRoot(new THREE.Mesh()), null);
});

test('model debug logging is gated by the exact #debug hash', () => {
    const root = new THREE.Group();
    root.userData.debugInfo = { typeId: '101', softlistId: 'soft-1' };
    const calls = [];
    const logger = {
        groupCollapsed: (...args) => calls.push(['groupCollapsed', ...args]),
        log: (...args) => calls.push(['log', ...args]),
        groupEnd: () => calls.push(['groupEnd']),
    };

    assert.equal(isSceneDebugEnabled(''), false);
    assert.equal(logParametricSoftlistDebug(root, '', logger), false);
    assert.equal(calls.length, 0);

    assert.equal(isSceneDebugEnabled('#debug'), true);
    assert.equal(logParametricSoftlistDebug(root, '#debug', logger), true);
    assert.equal(calls.filter(call => call[0] === 'log').length, 1);
    assert.deepEqual(calls.find(call => call[0] === 'log')[2], root.userData.debugInfo);
});
