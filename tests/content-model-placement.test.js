import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    createContentDebugInfo,
    createYUpToZUpTransform,
    computeTargetScale,
    placeContentModel,
} from '../src/components/ContentModelPlacement.js';

const EPSILON = 1e-6;

const instance = {
    instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0,
    category: 'soft', typeId: 'chair',
    basePoint: { x: 1000, y: 2000, z: 0 },
    footprint: [
        { x: 900, y: 1900 }, { x: 1100, y: 1900 },
        { x: 1100, y: 2100 }, { x: 900, y: 2100 },
    ],
    size: { x: 200, y: 200, z: 800 }, rotationDegrees: 90,
    horizontalFlip: true, verticalFlip: false,
    outScale: { x: 1, y: 1, z: 1 }, groundHeight: 0, modelParams: [],
};

const selection = {
    typeId: 'chair', typeName: 'chair', resId: '1',
    referenceSize: { x: 20, y: 20, z: 80 }, selection: 'nearest-area',
};

const staticResource = {
    kind: 'static-glb', resourceType: 1, modelType: 1, contentHash: 'model-hash',
};

function makePrototype() {
    return new THREE.Mesh(
        new THREE.BoxGeometry(20, 80, 20),
        new THREE.MeshBasicMaterial(),
    );
}

function worldBox(root) {
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
}

function assertNear(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < EPSILON,
        `${message}: expected ${expected}, got ${actual}`);
}

test('Y-up model height becomes positive world Z', () => {
    const vector = new THREE.Vector3(0, 1, 0).applyMatrix4(createYUpToZUpTransform());
    assert.ok(Math.abs(vector.z - 1) < 1e-9);
});

test('static scaling falls back from template centimeters to scene millimeters', () => {
    const scale = computeTargetScale({
        ...instance,
        footprint: [],
        size: { x: 0, y: 0, z: 0 },
        outScale: { x: 7, y: 8, z: 9 },
    }, {
        ...selection,
        referenceSize: { x: 20, y: 30, z: 80 },
    }, new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 30, 80)),
    'static-glb');
    assert.deepEqual(scale.toArray(), [10, 10, 10]);
});

test('footprint dimensions do not receive CAD outScale twice', () => {
    const scale = computeTargetScale({
        ...instance,
        outScale: { x: 4, y: 5, z: 6 },
    }, selection,
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 20, 80)),
    'static-glb');

    assert.deepEqual(scale.toArray(), [10, 10, 10]);
});

test('a non-square footprint starting along local Y preserves world span and direction', () => {
    const yFirstInstance = {
        ...instance,
        footprint: [
            { x: 1200, y: 1750 }, { x: 800, y: 1750 },
            { x: 800, y: 2250 }, { x: 1200, y: 2250 },
        ],
        size: { x: 999, y: 999, z: 800 },
        outScale: { x: 3, y: 4, z: 5 },
        rotationDegrees: 90,
        horizontalFlip: false,
    };
    const prototype = new THREE.Mesh(
        new THREE.BoxGeometry(50, 80, 40),
        new THREE.MeshBasicMaterial(),
    );
    const box = worldBox(placeContentModel(prototype, yFirstInstance, {
        ...selection,
        referenceSize: { x: 50, y: 40, z: 80 },
    }, staticResource));
    const size = box.getSize(new THREE.Vector3());

    assertNear(size.x, 400, 'rotated footprint world X span');
    assertNear(size.y, 500, 'rotated footprint world Y span');
    assertNear(size.z, 800, 'footprint-backed height without repeated outScale');
});

test('diagonal collinear footprint falls back to local CAD size and absolute outScale', () => {
    const scale = computeTargetScale({
        ...instance,
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            { x: 200, y: 200 },
        ],
        size: { x: 300, y: 400, z: 800 },
        outScale: { x: -2, y: 3, z: 0.5 },
        rotationDegrees: 0,
    }, selection,
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 40, 80)),
    'static-glb');

    assert.deepEqual(scale.toArray(), [20, 30, 5]);
});

test('scale-relative near-collinear footprint falls back instead of creating a thin target', () => {
    const scale = computeTargetScale({
        ...instance,
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 },
            { x: 1000, y: 1000 },
            { x: 1000, y: 1000.000001 },
            { x: 0, y: 0.000001 },
        ],
        size: { x: 300, y: 400, z: 800 },
        outScale: { x: 2, y: -3, z: 0.5 },
        rotationDegrees: 0,
    }, selection,
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 40, 80)),
    'static-glb');

    assert.deepEqual(scale.toArray(), [20, 30, 5]);
});

test('local CAD size uses absolute outScale only when footprint dimensions are unavailable', () => {
    const scale = computeTargetScale({
        ...instance,
        footprint: [],
        size: { x: 200, y: 300, z: 800 },
        outScale: { x: -2, y: 3, z: 0.5 },
    }, {
        ...selection,
        referenceSize: { x: 20, y: 30, z: 80 },
    }, new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 30, 80)),
    'static-glb');

    assert.deepEqual(scale.toArray(), [20, 30, 5]);
});

test('parameterized OBJ uses a uniform unit normalization instead of forcing the footprint', () => {
    const scale = computeTargetScale({
        ...instance,
        footprint: [
            { x: 0, y: 0 }, { x: 900, y: 0 },
            { x: 900, y: 700 }, { x: 0, y: 700 },
        ],
        size: { x: 900, y: 700, z: 1200 },
    }, selection,
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 20, 80)),
    'parametric-obj');

    assert.deepEqual(scale.toArray(), [10, 10, 10]);
});

test('template XMirror composes with CAD horizontal flip using XOR', () => {
    const prototype = makePrototype();
    const root = placeContentModel(prototype, instance, {
        ...selection,
        xMirror: true,
    }, staticResource);

    assert.equal(root.userData.debugInfo.transform.horizontalFlip, false);
    assert.equal(root.children[0].children[0].scale.x, 1);
});

test('template XMirror enables horizontal flip when CAD horizontal flip is false', () => {
    const root = placeContentModel(makePrototype(), {
        ...instance,
        horizontalFlip: false,
    }, {
        ...selection,
        xMirror: true,
    }, staticResource);

    assert.equal(root.userData.debugInfo.transform.horizontalFlip, true);
    assert.equal(root.children[0].children[0].scale.x, -1);
});

test('placement keeps the required translation, rotation, flip, scale, axis wrapper order', () => {
    const root = placeContentModel(makePrototype(), instance, selection, staticResource);

    assert.equal(root.name, 'contentRoot');
    assert.equal(root.children[0].name, 'planRotation');
    assert.equal(root.children[0].children[0].name, 'planFlip');
    assert.equal(root.children[0].children[0].children[0].name, 'sizeScale');
    assert.equal(root.children[0].children[0].children[0].children[0].name,
        'axisConvertedPrototype');
});

test('asymmetric marker follows T * Rz * Sflip * Ssize * axis with the required signs', () => {
    const prototype = new THREE.Group();
    prototype.add(new THREE.Mesh(
        new THREE.BoxGeometry(20, 80, 40),
        new THREE.MeshBasicMaterial(),
    ));
    const marker = new THREE.Object3D();
    marker.name = 'directionMarker';
    marker.position.set(10, 0, 20);
    prototype.add(marker);

    const transformed = {
        ...instance,
        basePoint: { x: 100, y: 200, z: 0 },
        footprint: [
            { x: 300, y: 100 }, { x: 300, y: 300 },
            { x: -100, y: 300 }, { x: -100, y: 100 },
        ],
        size: { x: 200, y: 400, z: 800 },
        rotationDegrees: 90,
        horizontalFlip: true,
        verticalFlip: false,
    };
    const root = placeContentModel(prototype, transformed, {
        ...selection,
        referenceSize: { x: 20, y: 40, z: 80 },
        xMirror: false,
    }, staticResource);
    const worldMarker = root.getObjectByName('directionMarker')
        .getWorldPosition(new THREE.Vector3());

    assertNear(worldMarker.x, 300, 'marker world x');
    assertNear(worldMarker.y, 100, 'marker world y');
    assertNear(worldMarker.z, 400, 'marker world z');
});

test('placed models stay upright and align footprint center and bottom', () => {
    const box = worldBox(placeContentModel(makePrototype(), instance, selection, staticResource));
    const center = box.getCenter(new THREE.Vector3());

    assertNear(center.x, 1000, 'world center x');
    assertNear(center.y, 2000, 'world center y');
    assertNear(box.min.z, 0, 'world bottom');
    assert.ok(box.getSize(new THREE.Vector3()).z > 700);
});

test('BasePoint at a footprint corner still anchors the model at the footprint center', () => {
    const cornerInstance = {
        ...instance,
        basePoint: { x: 100, y: 200, z: 0 },
        footprint: [
            { x: 100, y: 200 }, { x: 500, y: 200 },
            { x: 500, y: 800 }, { x: 100, y: 800 },
        ],
        size: { x: 400, y: 600, z: 800 },
        rotationDegrees: 0,
        horizontalFlip: false,
    };
    const box = worldBox(placeContentModel(makePrototype(), cornerInstance, selection,
        staticResource));
    const center = box.getCenter(new THREE.Vector3());

    assertNear(center.x, 300, 'corner-anchored center x');
    assertNear(center.y, 500, 'corner-anchored center y');
});

test('vertical flip happens in local plan space and keeps an offset footprint centered', () => {
    const flipped = {
        ...instance,
        basePoint: { x: 100, y: 200, z: 0 },
        footprint: [
            { x: 100, y: 200 }, { x: 500, y: 200 },
            { x: 500, y: 800 }, { x: 100, y: 800 },
        ],
        size: { x: 400, y: 600, z: 800 },
        rotationDegrees: 90,
        horizontalFlip: false,
        verticalFlip: true,
    };
    const prototype = makePrototype();
    const root = placeContentModel(prototype, flipped, selection, staticResource);
    const box = worldBox(root);
    const center = box.getCenter(new THREE.Vector3());

    assert.equal(root.children[0].children[0].scale.y, -1);
    assert.equal(root.userData.debugInfo.transform.verticalFlip, true);
    assert.equal(prototype.material.side, THREE.FrontSide);
    assert.equal(root.children[0].children[0].children[0]
        .children[0].children[0].material.side, THREE.DoubleSide);
    assertNear(center.x, 300, 'vertically flipped center x');
    assertNear(center.y, 500, 'vertically flipped center y');
});

test('nonzero BasePoint Z and explicit ground height set the model bottom', () => {
    const elevated = {
        ...instance,
        basePoint: { ...instance.basePoint, z: 125 },
        groundHeight: 75,
    };
    const box = worldBox(placeContentModel(makePrototype(), elevated, {
        ...selection,
        groundDist: 999,
    }, staticResource));

    assertNear(box.min.z, 200, 'elevated world bottom');
});

test('template ground distance is used when CAD ground height is absent', () => {
    const elevated = { ...instance };
    delete elevated.groundHeight;
    const box = worldBox(placeContentModel(makePrototype(), elevated, {
        ...selection,
        groundDist: 45,
    }, staticResource));

    assertNear(box.min.z, 45, 'template-grounded world bottom');
});

test('explicit zero CAD ground height overrides nonzero template ground distance', () => {
    const grounded = {
        ...instance,
        basePoint: { ...instance.basePoint, z: 125 },
        groundHeight: 0,
    };
    const box = worldBox(placeContentModel(makePrototype(), grounded, {
        ...selection,
        groundDist: 45,
    }, staticResource));

    assertNear(box.min.z, 125, 'explicit-zero grounded world bottom');
});

test('empty and zero model bounds reject placement with MODEL_SIZE_UNRESOLVED', () => {
    for (const modelBox of [
        new THREE.Box3(),
        new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 20, 80)),
    ]) {
        assert.throws(
            () => computeTargetScale(instance, selection, modelBox, 'static-glb'),
            error => error?.code === 'MODEL_SIZE_UNRESOLVED',
        );
    }

    assert.throws(
        () => placeContentModel(new THREE.Group(), instance, selection, staticResource),
        error => error?.code === 'MODEL_SIZE_UNRESOLVED',
    );
});

test('NaN and Infinity model bounds reject scaling with MODEL_SIZE_UNRESOLVED', () => {
    for (const modelBox of [
        new THREE.Box3(
            new THREE.Vector3(Number.NaN, 0, 0),
            new THREE.Vector3(20, 20, 80),
        ),
        new THREE.Box3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Number.POSITIVE_INFINITY, 20, 80),
        ),
    ]) {
        assert.throws(
            () => computeTargetScale(instance, selection, modelBox, 'static-glb'),
            error => error?.code === 'MODEL_SIZE_UNRESOLVED',
        );
    }
});

test('content debug info omits resource URLs while retaining safe resource identity', () => {
    const info = createContentDebugInfo(instance, selection, {
        ...staticResource,
        sourceUrl: 'https://example.invalid/private/model.glb?token=secret',
    }, {
        rawSize: new THREE.Vector3(20, 20, 80),
        targetScale: new THREE.Vector3(10, 10, 10),
        modelOffset: new THREE.Vector3(),
        worldPosition: new THREE.Vector3(1000, 2000, 0),
        worldBox: new THREE.Box3(
            new THREE.Vector3(900, 1900, 0),
            new THREE.Vector3(1100, 2100, 800),
        ),
        effectiveHorizontalFlip: true,
    });

    assert.equal(info.resource.kind, 'static-glb');
    assert.equal(info.resource.contentHash, 'model-hash');
    assert.equal('sourceUrl' in info.resource, false);
    assert.equal(JSON.stringify(info).includes('example.invalid'), false);
});
