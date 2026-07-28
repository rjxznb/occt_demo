import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    classifySceneClick,
    decideRoomPanelAction,
    findContentModelRoot,
    findParametricSoftlistRoot,
    isSceneRaycastTarget,
    isSceneDebugEnabled,
    logContentModelDebug,
    logParametricSoftlistDebug,
} from '../src/components/SceneClickInteraction.js';

test('the nearest model hit is classified before an underlying room target', () => {
    const modelRoot = new THREE.Group();
    modelRoot.userData = {
        type: 'content-model',
        contentModelRoot: true,
        debugInfo: {
            instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0,
            category: 'soft', typeId: '225903', mappedTypeId: '225903',
            resId: '1316568', resourceKind: 'static-glb',
        },
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

test('a child mesh resolves to its content model root through both API names', () => {
    const root = new THREE.Group();
    root.userData = {
        type: 'content-model',
        contentModelRoot: true,
        debugInfo: { typeId: '101', instanceId: 'soft_list:1' },
    };
    const nested = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(nested);
    nested.add(mesh);

    assert.equal(findContentModelRoot(mesh), root);
    assert.equal(findParametricSoftlistRoot(mesh), root);
    assert.equal(findContentModelRoot(new THREE.Mesh()), null);
});

test('model debug logging is gated by the exact #debug hash', () => {
    const root = new THREE.Group();
    root.userData.debugInfo = {
        instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0,
        category: 'soft', typeId: '225903', mappedTypeId: '225903',
        resId: '1316568', resourceKind: 'static-glb',
    };
    const calls = [];
    const logger = {
        groupCollapsed: (...args) => calls.push(['groupCollapsed', ...args]),
        log: (...args) => calls.push(['log', ...args]),
        groupEnd: () => calls.push(['groupEnd']),
    };

    assert.equal(isSceneDebugEnabled(''), false);
    assert.equal(isSceneDebugEnabled('#debug-extra'), false);
    assert.equal(logContentModelDebug(root, '', logger), false);
    assert.equal(calls.length, 0);

    assert.equal(isSceneDebugEnabled('#debug'), true);
    assert.equal(logContentModelDebug(root, '#debug', logger), true);
    assert.equal(logParametricSoftlistDebug, logContentModelDebug);
    assert.equal(calls.filter(call => call[0] === 'log').length, 1);
    assert.deepEqual(calls.find(call => call[0] === 'log')[2], root.userData.debugInfo);

    const serialized = JSON.stringify(root.userData.debugInfo);
    for (const forbidden of ['http', 'sourceUrl', 'webV2Url', 'parameterizedJsonUrl']) {
        assert.equal(serialized.includes(forbidden), false);
    }
});

test('raycast targets include only visible Mesh descendants of content roots plus room targets', () => {
    const root = new THREE.Group();
    root.userData = { contentModelRoot: true, debugInfo: { instanceId: 'soft_list:0' } };
    const visibleMesh = new THREE.Mesh();
    const hiddenMesh = new THREE.Mesh();
    hiddenMesh.visible = false;
    root.add(visibleMesh, hiddenMesh);

    const unmarkedMesh = new THREE.Mesh();
    unmarkedMesh.userData.type = 'content-model';
    const floor = new THREE.Mesh();
    floor.userData.type = 'floor';

    assert.equal(isSceneRaycastTarget(root), false);
    assert.equal(isSceneRaycastTarget(visibleMesh), true);
    assert.equal(isSceneRaycastTarget(hiddenMesh), false);
    assert.equal(isSceneRaycastTarget(unmarkedMesh), false);
    assert.equal(isSceneRaycastTarget(floor), true);
});
