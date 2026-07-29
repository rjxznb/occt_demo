import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createContentDebugInfo } from '../src/components/ContentModelPlacement.js';
import { RoomInfoView } from '../src/components/RoomInfoView.js';

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

test('real content debug snapshots are deeply sanitized before logging', () => {
    const sentinel = 'https://signed.test/model?sourceUrl=secret&webV2Url=secret&parameterizedJsonUrl=secret';
    const debugInfo = createContentDebugInfo({
        instanceId: `soft_list:${sentinel}`,
        sourceList: `soft_${sentinel}`,
        sourceIndex: 0,
        category: `soft-${sentinel}`,
        typeId: `type-${sentinel}`,
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [],
        size: { x: 1, y: 1, z: 1 },
        modelParams: [{ name: `plain HTTP marker-${sentinel}`, value: {
            sourceUrl: sentinel,
            webV2Url: sentinel,
            parameterizedJsonUrl: sentinel,
            nested: `value-${sentinel}`,
        } }],
    }, {
        typeId: `mapped-${sentinel}`,
        typeName: `name-${sentinel}`,
        resId: `res-${sentinel}`,
        selection: `choice-${sentinel}`,
        referenceSize: { x: 1, y: 1, z: 1 },
    }, {
        kind: `static-${sentinel}`,
        resourceType: `type-${sentinel}`,
        modelType: `model-${sentinel}`,
        contentHash: `hash-${sentinel}`,
    }, {
        rawSize: new THREE.Vector3(1, 1, 1),
        targetScale: new THREE.Vector3(1, 1, 1),
        modelOffset: new THREE.Vector3(),
        worldPosition: new THREE.Vector3(),
        worldBox: new THREE.Box3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(1, 1, 1),
        ),
    });
    const root = new THREE.Group();
    root.userData.debugInfo = debugInfo;
    let loggedInfo;

    assert.equal(logContentModelDebug(root, '#debug', {
        groupCollapsed() {},
        log(_label, info) { loggedInfo = info; },
        groupEnd() {},
    }), true);

    assert.deepEqual(Object.keys(loggedInfo), Object.keys(debugInfo));
    const containerShape = value => {
        if (Array.isArray(value)) {
            return { kind: 'array', length: value.length, children: value.map(containerShape) };
        }
        if (value && typeof value === 'object') {
            return {
                kind: 'object',
                count: Object.keys(value).length,
                children: Object.values(value).map(containerShape),
            };
        }
        return { kind: typeof value };
    };
    assert.deepEqual(containerShape(loggedInfo), containerShape(debugInfo));
    const serialized = JSON.stringify(loggedInfo).toLowerCase();
    for (const forbidden of ['http', 'sourceurl', 'webv2url', 'parameterizedjsonurl']) {
        assert.equal(serialized.includes(forbidden), false, `logged ${forbidden}`);
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

test('RoomInfoView click path honors ordered model hits, hidden ancestors, and room toggling', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { location: { hash: '' } };
    const sceneGroup = new THREE.Group();
    const modelRoot = new THREE.Group();
    modelRoot.userData = {
        contentModelRoot: true,
        debugInfo: { instanceId: 'soft_list:0', typeId: '225903' },
    };
    const modelMesh = new THREE.Mesh();
    modelRoot.add(modelMesh);
    const floorOne = new THREE.Mesh();
    floorOne.userData = { type: 'floor', roomIndex: 1, roomInfo: { name: 'room-1' } };
    const floorTwo = new THREE.Mesh();
    floorTwo.userData = { type: 'floor', roomIndex: 2, roomInfo: { name: 'room-2' } };
    sceneGroup.add(modelRoot, floorOne, floorTwo);

    let orderedHits = [];
    let lastTargets = [];
    const view = Object.create(RoomInfoView.prototype);
    view.sceneGroup = sceneGroup;
    view.sceneManager = {
        renderer: { domElement: { getBoundingClientRect: () => ({
            left: 0, top: 0, width: 100, height: 100,
        }) } },
        getCamera: () => new THREE.PerspectiveCamera(),
    };
    view.raycaster = {
        setFromCamera() {},
        intersectObjects(targets) {
            lastTargets = targets;
            return orderedHits.filter(hit => targets.includes(hit.object));
        },
    };
    view.pointer = new THREE.Vector2();
    view.panel = { style: { display: 'none' } };
    view.activeRoomIndex = null;
    const shownRooms = [];
    view._show = function(info) {
        shownRooms.push(info.name);
        this.panel.style.display = 'block';
    };
    const click = () => view._onClick({ clientX: 50, clientY: 50 });

    try {
        orderedHits = [{ object: modelMesh, distance: 1 }, { object: floorOne, distance: 2 }];
        click();
        assert.deepEqual(shownRooms, []);
        assert.equal(view.activeRoomIndex, null);

        modelRoot.visible = false;
        orderedHits = [{ object: modelMesh, distance: 1 }, { object: floorOne, distance: 2 }];
        click();
        assert.equal(lastTargets.includes(modelMesh), false);
        assert.deepEqual(shownRooms, ['room-1']);
        assert.equal(view.activeRoomIndex, 1);

        click();
        assert.equal(view.panel.style.display, 'none');
        assert.equal(view.activeRoomIndex, null);

        orderedHits = [{ object: floorOne, distance: 1 }];
        click();
        orderedHits = [{ object: floorTwo, distance: 1 }];
        click();
        assert.deepEqual(shownRooms, ['room-1', 'room-1', 'room-2']);
        assert.equal(view.activeRoomIndex, 2);
    } finally {
        globalThis.window = previousWindow;
    }
});
