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

function makeCornerWindowPrototype() {
    const prototype = new THREE.Group();
    const geometry = new THREE.BoxGeometry(700, 1500, 1380);
    geometry.translate(350, 750, 690);
    prototype.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const origin = new THREE.Object3D();
    origin.name = 'cornerOrigin';
    prototype.add(origin);

    const xAxis = new THREE.Object3D();
    xAxis.name = 'cornerXAxis';
    xAxis.position.x = 100;
    prototype.add(xAxis);

    const yAxis = new THREE.Object3D();
    yAxis.name = 'cornerYAxis';
    // Source OBJ is Y-up. Source +Z becomes plan -Y after Y-up -> Z-up conversion.
    yAxis.position.z = 100;
    prototype.add(yAxis);
    return prototype;
}

const cornerWindowSelection = {
    ...selection,
    typeId: '1407',
    typeName: '转角窗',
    resId: '2406314',
    referenceSize: { x: 0, y: 0, z: 120 },
    xMirror: false,
};

const cornerWindowResource = {
    kind: 'parametric-obj',
    resourceType: 8,
    modelType: 0,
    contentHash: 'corner-window',
};

function makeCornerDoorPrototype() {
    const prototype = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1500, 2200, 1200);
    geometry.translate(750, 1100, 600);
    prototype.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const origin = new THREE.Object3D();
    origin.name = 'cornerDoorOrigin';
    prototype.add(origin);

    const xAxis = new THREE.Object3D();
    xAxis.name = 'cornerDoorXAxis';
    xAxis.position.x = 100;
    prototype.add(xAxis);
    return prototype;
}

const cornerDoorSelection = {
    ...selection,
    typeId: '1313',
    typeName: 'L型推拉门',
    resId: '2412393',
    referenceSize: { x: 0, y: 0, z: 220 },
    xMirror: false,
};

const cornerDoorResource = {
    kind: 'parametric-obj',
    resourceType: 8,
    modelType: 0,
    contentHash: 'corner-door',
};

function cornerDoorInstance(overrides = {}) {
    return {
        ...instance,
        instanceId: 'door_list:fixture-1313',
        sourceList: 'door_list',
        category: 'door',
        typeId: '1313',
        basePoint: { x: 1000, y: 2000, z: 0 },
        footprint: [
            { x: 1000, y: 2000 },
            { x: 1000, y: 3200 },
            { x: 760, y: 3200 },
            { x: 760, y: 1820 },
            { x: 2500, y: 1820 },
            { x: 2500, y: 2000 },
        ],
        size: { x: 1500, y: 1200, z: 2200 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        groundHeight: 0,
        ...overrides,
    };
}

function makeUWindowPrototype() {
    const prototype = new THREE.Group();
    const geometry = new THREE.BoxGeometry(3350, 1600, 1270);
    // Source OBJ is Y-up. After axis conversion, this occupies
    // plan X [-1675, 1675], plan Y [-240, 1030], world Z [0, 1600].
    geometry.translate(0, 800, -395);
    prototype.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));

    const origin = new THREE.Object3D();
    origin.name = 'uWindowOrigin';
    prototype.add(origin);

    const xAxis = new THREE.Object3D();
    xAxis.name = 'uWindowXAxis';
    xAxis.position.x = 100;
    prototype.add(xAxis);

    const yAxis = new THREE.Object3D();
    yAxis.name = 'uWindowYAxis';
    yAxis.position.z = -100;
    prototype.add(yAxis);
    return prototype;
}

const uWindowSelection = {
    ...selection,
    typeId: '1408',
    typeName: 'U形窗',
    resId: '2406318',
    referenceSize: { x: 0, y: 0, z: 120 },
    xMirror: false,
};

const uWindowResource = {
    kind: 'parametric-obj',
    resourceType: 8,
    modelType: 0,
    contentHash: 'u-window',
};

function uWindowInstance(overrides = {}) {
    return {
        ...instance,
        instanceId: 'window_list:fixture-1408',
        sourceList: 'window_list',
        sourceIndex: 9,
        category: 'window',
        typeId: '1408',
        basePoint: { x: 3631.313676, y: -4728.045438, z: 0 },
        footprint: [
            { x: 3631.313676, y: -4728.045438 },
            { x: 281.313676, y: -4728.045438 },
            { x: 281.313676, y: -5998.045438 },
            { x: 461.313676, y: -5998.045438 },
            { x: 461.313676, y: -4968.045438 },
            { x: 3411.313676, y: -4968.045438 },
            { x: 3411.313676, y: -5778.045438 },
            { x: 3631.313676, y: -5778.045438 },
        ],
        size: { x: 2870, y: 1030, z: 1600 },
        rotationDegrees: 180,
        horizontalFlip: false,
        verticalFlip: false,
        groundHeight: 900,
        externalWallThickness: 240,
        ...overrides,
    };
}

const cornerWindowFixtures = [
    {
        instance: {
            ...instance,
            instanceId: 'window_list:6',
            sourceList: 'window_list',
            sourceIndex: 6,
            category: 'window',
            typeId: '1407',
            basePoint: { x: -6638.686324, y: 2561.954562, z: 0 },
            footprint: [
                { x: -6638.686324, y: 2561.954562 },
                { x: -6638.686756, y: 3641.954562 },
                { x: -6878.686756, y: 3641.954466 },
                { x: -6878.686228, y: 2321.954466 },
                { x: -6203.686228, y: 2321.954736 },
                { x: -6203.686324, y: 2561.954736 },
            ],
            size: { x: 435, y: 1080, z: 1500 },
            rotationDegrees: 0.000022918312048469448,
            horizontalFlip: false,
            verticalFlip: false,
            groundHeight: 900,
            externalWallThickness: 240,
        },
        expectedPivot: { x: -6878.686227999973, y: 2321.9544660000515 },
    },
    {
        instance: {
            ...instance,
            instanceId: 'window_list:7',
            sourceList: 'window_list',
            sourceIndex: 7,
            category: 'window',
            typeId: '1407',
            basePoint: { x: -5768.686324, y: 2561.95491, z: 0 },
            footprint: [
                { x: -5768.686324, y: 2561.95491 },
                { x: -6203.686324, y: 2561.954736 },
                { x: -6203.686228, y: 2321.954736 },
                { x: -5528.686228, y: 2321.955006 },
                { x: -5528.686356, y: 2641.955006 },
                { x: -5768.686356, y: 2641.95491 },
            ],
            size: { x: 80, y: 435, z: 1500 },
            rotationDegrees: 90.00002445354664,
            horizontalFlip: false,
            verticalFlip: false,
            groundHeight: 900,
            externalWallThickness: 240,
        },
        expectedPivot: { x: -5528.686223712844, y: 2321.9550092154036 },
    },
];

function worldBox(root) {
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
}

function assertNear(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < EPSILON,
        `${message}: expected ${expected}, got ${actual}`);
}

test('1407 models anchor their source origin at the UE L-corner pivot', () => {
    for (const { instance: current, expectedPivot } of cornerWindowFixtures) {
        const root = placeContentModel(
            makeCornerWindowPrototype(),
            current,
            cornerWindowSelection,
            cornerWindowResource,
        );
        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('cornerOrigin')
            .getWorldPosition(new THREE.Vector3());
        const box = worldBox(root);

        assertNear(origin.x, expectedPivot.x, `${current.instanceId} pivot x`);
        assertNear(origin.y, expectedPivot.y, `${current.instanceId} pivot y`);
        assertNear(origin.z, 900, `${current.instanceId} pivot z`);
        assertNear(box.min.z, 900, `${current.instanceId} sill height`);
    }
});

test('1407 placement maps the parameterized OBJ axes to UE local positive X and Y', () => {
    const expectedDirections = [
        { x: { x: 1, y: 0 }, y: { x: 0, y: 1 } },
        { x: { x: 0, y: 1 }, y: { x: -1, y: 0 } },
    ];

    cornerWindowFixtures.forEach(({ instance: current }, index) => {
        const root = placeContentModel(
            makeCornerWindowPrototype(),
            current,
            cornerWindowSelection,
            cornerWindowResource,
        );
        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('cornerOrigin')
            .getWorldPosition(new THREE.Vector3());
        const xDirection = root.getObjectByName('cornerXAxis')
            .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const yDirection = root.getObjectByName('cornerYAxis')
            .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

        assertNear(xDirection.x, expectedDirections[index].x.x,
            `${current.instanceId} local X world x`);
        assertNear(xDirection.y, expectedDirections[index].x.y,
            `${current.instanceId} local X world y`);
        assertNear(yDirection.x, expectedDirections[index].y.x,
            `${current.instanceId} local Y world x`);
        assertNear(yDirection.y, expectedDirections[index].y.y,
            `${current.instanceId} local Y world y`);
        assert.equal(root.userData.debugInfo.transform.verticalFlip, true);
    });
});

test('invalid 1407 geometry keeps generic placement without OBJ axis compensation', () => {
    const malformed = {
        ...cornerWindowFixtures[0].instance,
        footprint: [],
        externalWallThickness: null,
    };
    const root = placeContentModel(
        makeCornerWindowPrototype(),
        malformed,
        cornerWindowSelection,
        cornerWindowResource,
    );

    assert.equal(root.userData.debugInfo.transform.verticalFlip, false);
});

test('1313 aligns the UE artificial L-box center after subtracting 90 degrees', () => {
    const root = placeContentModel(
        makeCornerDoorPrototype(),
        cornerDoorInstance(),
        cornerDoorSelection,
        cornerDoorResource,
    );
    root.updateMatrixWorld(true);

    const origin = root.getObjectByName('cornerDoorOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('cornerDoorXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

    assertNear(origin.x, 1030, '1313 model-origin world x');
    assertNear(origin.y, 3260, '1313 model-origin world y');
    assertNear(origin.z, 0, '1313 model-origin world z');
    assertNear(xDirection.x, 0, '1313 local X world x');
    assertNear(xDirection.y, -1, '1313 local X world y');
    assertNear(root.userData.debugInfo.transform.rotationDegrees, -90,
        '1313 effective rotation');
});

test('1313 keeps its artificial L-box center aligned after a horizontal flip', () => {
    const root = placeContentModel(
        makeCornerDoorPrototype(),
        cornerDoorInstance({
            instanceId: 'door_list:fixture-1313-flipped',
            horizontalFlip: true,
        }),
        cornerDoorSelection,
        cornerDoorResource,
    );
    root.updateMatrixWorld(true);

    const origin = root.getObjectByName('cornerDoorOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('cornerDoorXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

    assertNear(origin.x, 1030, 'flipped 1313 model-origin world x');
    assertNear(origin.y, 1760, 'flipped 1313 model-origin world y');
    assertNear(xDirection.x, 0, 'flipped 1313 local X world x');
    assertNear(xDirection.y, 1, 'flipped 1313 local X world y');
});

test('1408 aligns the UE artificial U-box center without extra rotation', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance(),
        uWindowSelection,
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('uWindowXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const yDirection = root.getObjectByName('uWindowYAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const box = worldBox(root);

    assertNear(origin.x, 1956.313676, '1408 model-origin world x');
    assertNear(origin.y, -4968.045438, '1408 model-origin world y');
    assertNear(origin.z, 900, '1408 model-origin world z');
    assertNear(xDirection.x, -1, '1408 local X world x');
    assertNear(xDirection.y, 0, '1408 local X world y');
    assertNear(yDirection.x, 0, '1408 local Y world x');
    assertNear(yDirection.y, -1, '1408 local Y world y');
    assertNear(box.min.z, 900, '1408 sill height');
    assertNear(root.userData.debugInfo.transform.rotationDegrees, 180,
        '1408 keeps CAD rotation');
});

test('1408 placement compensates the artificial center after both plan flips', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance({ verticalFlip: true }),
        { ...uWindowSelection, xMirror: true },
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());
    const xDirection = root.getObjectByName('uWindowXAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const yDirection = root.getObjectByName('uWindowYAxis')
        .getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

    assertNear(origin.x, 1956.313676, 'flipped 1408 model-origin world x');
    assertNear(origin.y, -5758.045438, 'flipped 1408 model-origin world y');
    assertNear(xDirection.x, 1, 'flipped 1408 local X world x');
    assertNear(xDirection.y, 0, 'flipped 1408 local X world y');
    assertNear(yDirection.x, 0, 'flipped 1408 local Y world x');
    assertNear(yDirection.y, 1, 'flipped 1408 local Y world y');
    assert.equal(root.userData.debugInfo.transform.horizontalFlip, true);
    assert.equal(root.userData.debugInfo.transform.verticalFlip, true);
});

test('1403, 140302, 140303, and 1404 align the UE bay-window artificial center', () => {
    for (const typeId of ['1403', '140302', '140303', '1404']) {
        const bayInstance = {
            ...instance,
            instanceId: `window_list:fixture-${typeId}`,
            sourceList: 'window_list',
            sourceIndex: 8,
            category: 'window',
            typeId,
            basePoint: { x: 0, y: 0, z: 0 },
            footprint: [
                { x: 0, y: 200 }, { x: 2000, y: 200 },
                { x: 2000, y: 800 }, { x: 0, y: 800 },
            ],
            size: { x: 2000, y: 600, z: 1200 },
            rotationDegrees: 0,
            horizontalFlip: false,
            verticalFlip: false,
            groundHeight: 900,
        };
        const root = placeContentModel(
            makeCornerWindowPrototype(),
            bayInstance,
            { ...cornerWindowSelection, typeId, xMirror: false },
            cornerWindowResource,
        );
        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('cornerOrigin')
            .getWorldPosition(new THREE.Vector3());

        assertNear(origin.x, 1000, `${typeId} model-origin world x`);
        assertNear(origin.y, 200, `${typeId} model-origin world y`);
        assertNear(origin.z, 900, `${typeId} model-origin world z`);
        assert.equal(root.userData.debugInfo.ruleFamily, 'bay-window');
    }
});

test('140302 compensates the bay-window artificial center after vertical flip', () => {
    const root = placeContentModel(
        makeCornerWindowPrototype(),
        {
            ...instance,
            instanceId: 'window_list:fixture-140302-flipped',
            sourceList: 'window_list',
            category: 'window',
            typeId: '140302',
            basePoint: { x: 0, y: 0, z: 0 },
            footprint: [
                { x: 0, y: 200 }, { x: 2000, y: 200 },
                { x: 2000, y: 800 }, { x: 0, y: 800 },
            ],
            size: { x: 2000, y: 600, z: 1200 },
            rotationDegrees: 0,
            horizontalFlip: false,
            verticalFlip: true,
            groundHeight: 900,
        },
        { ...cornerWindowSelection, typeId: '140302', xMirror: false },
        cornerWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('cornerOrigin')
        .getWorldPosition(new THREE.Vector3());

    assertNear(origin.x, 1000, 'flipped bay model-origin world x');
    assertNear(origin.y, 800, 'flipped bay model-origin world y');
});

test('1406 aligns winding-aware left and right artificial spans after plan flips', () => {
    const cornerBayInstance = overrides => ({
        ...instance,
        instanceId: 'window_list:fixture-1406',
        sourceList: 'window_list',
        category: 'window',
        typeId: '1406',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 0, y: 1200 },
            { x: -240, y: 1200 }, { x: -240, y: -180 },
            { x: 900, y: -180 }, { x: 900, y: 0 },
        ],
        size: { x: 900, y: 1200, z: 1500 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        groundHeight: 900,
        rawBlockInnerInfo: {
            ['\u957f']: 900,
            ['\u5bbd']: 1200,
            ['\u5916\u8fb9\u957f']: 180,
            ['\u5916\u8fb9\u5bbd']: 240,
            ['\u9ad8\u5ea6']: 1500,
        },
        ...overrides,
    });
    const place = overrides => placeContentModel(
        makeCornerWindowPrototype(),
        cornerBayInstance(overrides),
        { ...cornerWindowSelection, typeId: '1406', xMirror: false },
        cornerWindowResource,
    );
    const normal = place({});
    const flipped = place({ horizontalFlip: true, verticalFlip: true });
    normal.updateMatrixWorld(true);
    flipped.updateMatrixWorld(true);
    const normalOrigin = normal.getObjectByName('cornerOrigin')
        .getWorldPosition(new THREE.Vector3());
    const flippedOrigin = flipped.getObjectByName('cornerOrigin')
        .getWorldPosition(new THREE.Vector3());

    assertNear(normalOrigin.x, -390, '1406 model-origin world x');
    assertNear(normalOrigin.y, -30, '1406 model-origin world y');
    assertNear(flippedOrigin.x, 1050, 'flipped 1406 model-origin world x');
    assertNear(flippedOrigin.y, 1050, 'flipped 1406 model-origin world y');
});

test('invalid 1408 geometry keeps the generic bounds-center fallback visible', () => {
    const root = placeContentModel(
        makeUWindowPrototype(),
        uWindowInstance({ footprint: [], externalWallThickness: null }),
        uWindowSelection,
        uWindowResource,
    );
    root.updateMatrixWorld(true);
    const origin = root.getObjectByName('uWindowOrigin')
        .getWorldPosition(new THREE.Vector3());

    assertNear(origin.x, 3631.313676, 'fallback model-origin world x');
    assertNear(origin.y, -4333.045438, 'fallback model-origin world y');
    assertNear(origin.z, 900, 'fallback model-origin world z');
    assert.equal(root.userData.debugInfo.transform.verticalFlip, false);
});

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

test('1405 keeps parametric unit normalization and shifts to the UE arc-bay center', () => {
    const arcBayInstance = {
        ...instance,
        instanceId: 'window_list:fixture-1405',
        sourceList: 'window_list',
        category: 'window',
        typeId: '1405',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: -800, y: -300 }, { x: 800, y: -300 },
            { x: 800, y: 300 }, { x: -800, y: 300 },
        ],
        size: { x: 1600, y: 600, z: 1200 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        outScale: { x: 1, y: 1, z: 1 },
        groundHeight: 900,
    };
    const root = placeContentModel(makePrototype(), arcBayInstance, {
        ...selection,
        typeId: '1405',
        referenceSize: { x: 20, y: 20, z: 80 },
    }, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0,
        contentHash: 'arc-bay',
    });
    const box = worldBox(root);
    const center = box.getCenter(new THREE.Vector3());

    assert.deepEqual(root.userData.debugInfo.placement.targetScale, { x: 10, y: 10, z: 10 });
    assertNear(center.x, 0, '1405 center x');
    assertNear(center.y, 400, '1405 UE local-right center offset');
    assertNear(box.min.z, 900, '1405 ground height');
});

test('1305 ports the UE barn-door tuned size and wall-side offset', () => {
    const barnDoor = {
        ...instance,
        instanceId: 'door_list:fixture-1305',
        sourceList: 'door_list',
        category: 'door',
        typeId: '1305',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: -400, y: -50 }, { x: 400, y: -50 },
            { x: 400, y: 50 }, { x: -400, y: 50 },
        ],
        size: { x: 800, y: 100, z: 2100 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        outScale: { x: 1, y: 1, z: 1 },
        groundHeight: 0,
    };
    const root = placeContentModel(makePrototype(), barnDoor, {
        ...selection,
        typeId: '7319',
        referenceSize: { x: 82.3, y: 8.4, z: 209.7 },
    }, staticResource);
    const box = worldBox(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    assertNear(size.x, 2100, '1305 tuned world width');
    assertNear(size.y, 150, '1305 tuned world depth');
    assertNear(size.z, 2250, '1305 tuned world height');
    assertNear(center.x, 400, '1305 wall-side center x');
    assertNear(center.y, -50, '1305 wall-side center y');
});

test('1311 subtracts outer edge length and adds the UE 100mm clearance', () => {
    const pocketDoor = {
        ...instance,
        instanceId: 'door_list:fixture-1311',
        sourceList: 'door_list',
        category: 'door',
        typeId: '1311',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: -450, y: -60 }, { x: 450, y: -60 },
            { x: 450, y: 60 }, { x: -450, y: 60 },
        ],
        size: { x: 900, y: 120, z: 2100 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        outScale: { x: 1, y: 1, z: 1 },
        groundHeight: 0,
        rawBlockInnerInfo: { ['\u5916\u8fb9\u957f']: 200 },
    };
    const root = placeContentModel(makePrototype(), pocketDoor, {
        ...selection,
        typeId: '7323',
        referenceSize: { x: 90.4, y: 3, z: 203.1 },
    }, staticResource);
    const box = worldBox(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    assertNear(size.x, 800, '1311 adjusted opening width');
    assertNear(size.y, 120, '1311 world depth');
    assertNear(size.z, 2100, '1311 world height');
    assertNear(center.x, 50, '1311 UE center adjustment');
});

test('1311 rejects a non-positive adjusted opening width', () => {
    assert.throws(() => computeTargetScale({
        ...instance,
        typeId: '1311',
        footprint: [],
        size: { x: 500, y: 120, z: 2100 },
        rawBlockInnerInfo: { ['\u5916\u8fb9\u957f']: 700 },
    }, selection, new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(20, 20, 80),
    ), 'static-glb'), error => error?.code === 'MODEL_SIZE_UNRESOLVED');
});

test('140f static fallback uses the derived UE total height', () => {
    const doorWindow = {
        ...instance,
        instanceId: 'window_list:fixture-140f',
        sourceList: 'window_list',
        category: 'window',
        typeId: '140f',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: -1200, y: -120 }, { x: 1200, y: -120 },
            { x: 1200, y: 120 }, { x: -1200, y: 120 },
        ],
        size: { x: 2400, y: 240, z: 0 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        outScale: { x: 1, y: 1, z: 1 },
        groundHeight: 0,
        rawBlockInnerInfo: {
            ['\u7c7b\u578b']: '\u843d\u5730\u7a97\u6709\u526f\u7a97',
            ['\u95e8\u9ad8']: 2100,
            ['\u7a97\u9ad8']: 600,
        },
    };
    const root = placeContentModel(makePrototype(), doorWindow, {
        ...selection,
        typeId: '140f',
        referenceSize: { x: 0, y: 0, z: 10 },
    }, staticResource);
    const size = worldBox(root).getSize(new THREE.Vector3());

    assertNear(size.x, 2400, '140f world width');
    assertNear(size.y, 240, '140f world depth');
    assertNear(size.z, 2700, '140f derived total height');
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

test('a generated 1401 window stays upright without applying CAD dimensions twice', () => {
    const windowInstance = {
        ...instance,
        instanceId: 'window_list:3',
        sourceList: 'window_list',
        sourceIndex: 3,
        category: 'window',
        typeId: '1401',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 0, y: -240 },
            { x: 1100, y: -240 }, { x: 1100, y: 0 },
        ],
        size: { x: 1100, y: 240, z: 1380 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        groundHeight: 890,
    };
    const generatedWindow = new THREE.Mesh(
        new THREE.BoxGeometry(1160, 1400, 300),
        new THREE.MeshBasicMaterial(),
    );
    const box = worldBox(placeContentModel(generatedWindow, windowInstance, {
        ...selection,
        typeId: '1401',
        resId: '2406313',
        referenceSize: { x: 0, y: 0, z: 160 },
    }, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0, contentHash: 'window-hash',
    }));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    assertNear(size.x, 1160, 'generated window world width');
    assertNear(size.y, 300, 'generated window world wall depth');
    assertNear(size.z, 1400, 'generated window world height');
    assertNear(center.x, 550, 'generated window footprint center x');
    assertNear(center.y, -120, 'generated window footprint center y');
    assertNear(box.min.z, 890, 'generated window sill height');
});

test('generated 140c windows anchor at the arc apex and face away from the circle center', () => {
    const fixtures = [
        {
            innerStart: { x: -6638.686234, y: 4641.953907, z: 0, bulge: -1.455308 },
            innerEnd: { x: -3828.686478, y: 6031.954413, z: 0, bulge: 0 },
            center: { x: -5500.624914148718, y: 5876.592296840282 },
            apex: { x: -6245.125784192925, y: 7381.661722452424 },
            heading: -63.68014011039734,
        },
        {
            innerStart: { x: 5591.314060, y: -4748.045378, z: 0, bulge: 0.224261 },
            innerEnd: { x: 5591.313296, y: -378.045377, z: 0, bulge: 0 },
            center: { x: 964.7629091403505, y: -2563.0461863523533 },
            apex: { x: 6081.3239631121305, y: -2563.045291832298 },
            heading: -179.99998998307197,
        },
    ];

    for (const [index, fixture] of fixtures.entries()) {
        const prototype = new THREE.Group();
        prototype.add(new THREE.Mesh(
            new THREE.BoxGeometry(100, 150, 20),
            new THREE.MeshBasicMaterial(),
        ));
        const originMarker = new THREE.Object3D();
        originMarker.name = 'arcOrigin';
        prototype.add(originMarker);
        const directionMarker = new THREE.Object3D();
        directionMarker.name = 'arcRightAxis';
        // The source model is Y-up. After its Y-up -> Z-up conversion,
        // source -Z is UE's horizontal local RightVector (+Y).
        directionMarker.position.z = -100;
        prototype.add(directionMarker);

        const arcInstance = {
            ...instance,
            instanceId: `window_list:${index + 1}#segment:1`,
            sourceList: 'window_list',
            sourceIndex: index + 1,
            category: 'window',
            typeId: '140c',
            parentInstanceId: `window_list:${index + 1}`,
            compositeSegmentIndex: 1,
            compositeSegmentCount: index === 0 ? 2 : 4,
            generatedFromTypeId: '140d02',
            basePoint: { x: -10203, y: -8656, z: 0 },
            cadPath: [
                fixture.innerEnd,
                { x: 0, y: 0, z: 0, bulge: 0 },
                { x: 0, y: 0, z: 0, bulge: 0 },
                fixture.innerStart,
            ],
            footprint: [
                { x: -50000, y: -50000 }, { x: 50000, y: -50000 },
                { x: 50000, y: 50000 }, { x: -50000, y: 50000 },
            ],
            size: { x: 100000, y: 100000, z: 1500 },
            outScale: { x: -7, y: -8, z: -9 },
            rotationDegrees: 77,
            horizontalFlip: true,
            verticalFlip: true,
            groundHeight: 900,
            rawBlockInnerInfo: { 高度: 1500, 离地高度: 900 },
        };
        const root = placeContentModel(prototype, arcInstance, {
            ...selection,
            typeId: '140c',
            resId: '2423932',
            referenceSize: { x: 10, y: 2, z: 15 },
            xMirror: false,
        }, {
            kind: 'parametric-obj', resourceType: 8, modelType: 0,
            contentHash: `arc-window-${index}`,
        });

        root.updateMatrixWorld(true);
        const origin = root.getObjectByName('arcOrigin').getWorldPosition(new THREE.Vector3());
        const rightAxis = root.getObjectByName('arcRightAxis')
            .getWorldPosition(new THREE.Vector3());
        const actualDirection = rightAxis.sub(origin).normalize();
        const expectedDirection = new THREE.Vector3(
            fixture.apex.x - fixture.center.x,
            fixture.apex.y - fixture.center.y,
            0,
        ).normalize();
        const box = worldBox(root);

        assertNear(root.position.x, fixture.apex.x, 'arc root apex x');
        assertNear(root.position.y, fixture.apex.y, 'arc root apex y');
        assertNear(root.rotation.z, 0, 'rotation remains in the plan wrapper');
        assertNear(actualDirection.x, expectedDirection.x, 'arc local right direction x');
        assertNear(actualDirection.y, expectedDirection.y, 'arc local right direction y');
        assertNear(actualDirection.z, 0, 'arc local right remains horizontal');
        assertNear(box.min.z, 900, 'arc sill height');
        assertNear(box.getSize(new THREE.Vector3()).z, 150, 'arc model stays upright');
        assert.deepEqual(root.userData.debugInfo.placement.targetScale, { x: 1, y: 1, z: 1 });
        assertNear(root.userData.debugInfo.transform.rotationDegrees,
            fixture.heading + 90, 'debug rotation');
    }
});

test('generated 140c debug data exposes bounded parent, segment, and arc facts', () => {
    const arcInstance = {
        ...instance,
        instanceId: 'window_list:1#segment:1',
        sourceList: 'window_list',
        sourceIndex: 1,
        typeId: '140c',
        parentInstanceId: 'window_list:1',
        compositeSegmentIndex: 1,
        compositeSegmentCount: 2,
        generatedFromTypeId: '140d02',
        cadPath: [
            { x: -3828.686478, y: 6031.954413, z: 0, bulge: 0 },
            { x: 0, y: 0, z: 0, bulge: 0 },
            { x: 0, y: 0, z: 0, bulge: 0 },
            { x: -6638.686234, y: 4641.953907, z: 0, bulge: -1.455308 },
        ],
        groundHeight: 900,
    };
    const root = placeContentModel(makePrototype(), arcInstance, {
        ...selection,
        typeId: '140c',
        resId: '2423932',
    }, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0,
        contentHash: 'arc-debug',
    });
    const debug = root.userData.debugInfo;

    assert.deepEqual(debug.composite, {
        parentInstanceId: 'window_list:1',
        segmentIndex: 1,
        segmentCount: 2,
        generatedFromTypeId: '140d02',
        generatedTypeId: '140c',
    });
    assertNear(debug.placement.arc.chordLength, 3134.9960184026254, 'debug chord');
    assertNear(debug.placement.arc.sagitta, 2281.192392774744, 'debug sagitta');
    assert.equal(JSON.stringify(debug).includes('cadPath'), false);
    assert.equal(JSON.stringify(debug).includes('sourceUrl'), false);
});

test('generated 140c placement rejects missing inner-arc geometry', () => {
    assert.throws(() => placeContentModel(makePrototype(), {
        ...instance,
        typeId: '140c',
        cadPath: [],
    }, selection, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0,
    }), error => error?.code === 'MODEL_SIZE_UNRESOLVED');
});

test('generated 140e02 railings anchor at the chord midpoint and keep arc facing', () => {
    const innerStart = {
        x: 5591.314060, y: -4748.045378, z: 0, bulge: 0.224261,
    };
    const innerEnd = {
        x: 5591.313296, y: -378.045377, z: 0, bulge: 0,
    };
    const prototype = new THREE.Group();
    prototype.add(new THREE.Mesh(
        new THREE.BoxGeometry(100, 1050, 20),
        new THREE.MeshBasicMaterial(),
    ));
    const originMarker = new THREE.Object3D();
    originMarker.name = 'railingOrigin';
    prototype.add(originMarker);
    const railingInstance = {
        ...instance,
        instanceId: 'window_list:fixture-140e#segment:1',
        sourceList: 'window_list',
        sourceIndex: 7,
        category: 'window',
        typeId: '140e02',
        parentInstanceId: 'window_list:fixture-140e',
        compositeSegmentIndex: 1,
        compositeSegmentCount: 2,
        generatedFromTypeId: '140e',
        cadPath: [
            innerEnd,
            { x: 0, y: 0, z: 0, bulge: 0 },
            { x: 0, y: 0, z: 0, bulge: 0 },
            innerStart,
        ],
        footprint: [],
        size: { x: 4370, y: 200, z: 1050 },
        outScale: { x: 1, y: 1, z: 1 },
        rotationDegrees: 77,
        horizontalFlip: true,
        verticalFlip: true,
        groundHeight: 300,
        rawBlockInnerInfo: { ['\u9ad8\u5ea6']: 1050 },
    };

    const root = placeContentModel(prototype, railingInstance, {
        ...selection,
        typeId: '140e02',
        resId: 'arc-railing',
        referenceSize: { x: 10, y: 2, z: 105 },
        xMirror: false,
    }, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0,
        contentHash: 'arc-railing',
    });
    const box = worldBox(root);

    assertNear(root.position.x, (innerStart.x + innerEnd.x) / 2, 'railing chord midpoint x');
    assertNear(root.position.y, (innerStart.y + innerEnd.y) / 2, 'railing chord midpoint y');
    assertNear(box.min.z, 300, 'railing ground height');
    assertNear(root.userData.debugInfo.transform.rotationDegrees,
        -89.99998998307197, 'railing arc facing');
    assert.equal(root.userData.debugInfo.composite.generatedFromTypeId, '140e');
});

test('generated 140e02 placement rejects missing inner-arc geometry', () => {
    assert.throws(() => placeContentModel(makePrototype(), {
        ...instance,
        typeId: '140e02',
        cadPath: [],
    }, selection, {
        kind: 'parametric-obj', resourceType: 8, modelType: 0,
    }), error => error?.code === 'MODEL_SIZE_UNRESOLVED');
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
