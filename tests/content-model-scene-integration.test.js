import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import geometryService from '../src/core/GeometryService.js';
import ParseJson from '../src/utils/json_parse.js';
import { DoorWindowFactory } from '../src/components/DoorWindowFactory.js';
import { ContentModelLoader } from '../src/components/ContentModelLoader.js';
import * as RoomRendererModule from '../src/components/RoomRenderer.js';

const {
    filterNonSoftContentModels,
    handlePlacedContentModel,
    hidePlacedFallback,
    indexDoorWindowFallbacks,
    startSceneContentModelLoads,
} = RoomRendererModule;

const openingPoints = [
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 900, y: 120 },
    { x: 0, y: 120 },
];

function cadDoor(overrides = {}) {
    return {
        TypeId: '1302',
        BasePoint: 'X=450 Y=60 Z=0',
        Size: 'X=900 Y=120 Z=2100',
        OutRotateRadian: 0,
        OutXScale: 1,
        OutYScale: 1,
        OutZScale: 1,
        BlockInnerInfo: { 高度: 2100, 旋转角度: 0 },
        ...overrides,
    };
}

function doorInstance(sourceIndex = 1) {
    return {
        instanceId: `door_list:${sourceIndex}`,
        sourceList: 'door_list',
        sourceIndex,
        category: 'door',
        typeId: '1302',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: openingPoints,
        size: { x: 900, y: 120, z: 2100 },
        modelParams: [],
    };
}

function controlledDoorLoader(failurePhase = null) {
    return new ContentModelLoader({
        templateResolver: {
            async load() {},
            select() {
                if (failurePhase === 'selection') {
                    return { errorCode: 'TEMPLATE_RESOURCE_MISSING', message: 'missing template resource' };
                }
                return {
                    typeId: '1302', typeName: 'door', resId: 'door-resource',
                    referenceSize: { x: 90, y: 12, z: 210 }, selection: 'nearest-area',
                };
            },
        },
        apiClient: {
            async getGoodsDetails() {
                if (failurePhase === 'resource') return { items: [] };
                return { items: [{
                    id: 'door-resource', modelType: 1,
                    resourceList: [{ type: 1, data: {
                        webV2Url: 'https://model.test/door.kb', webV2Md5: 'door-hash',
                    } }],
                }] };
            },
        },
        async loadGltf() {
            if (failurePhase === 'load') throw new Error('controlled load failure');
            const prototype = new THREE.Group();
            prototype.add(new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial(),
            ));
            return prototype;
        },
        placeModel(_prototype, instance) {
            if (failurePhase === 'placement') throw new Error('controlled placement failure');
            const root = new THREE.Group();
            root.userData.instanceId = instance.instanceId;
            return root;
        },
        logger: { log() {}, warn() {} },
    });
}

test('soft-list records never enter the unified content-model loader', () => {
    const soft = { instanceId: 'soft_list:0', sourceList: 'soft_list' };
    const door = { instanceId: 'door_list:0', sourceList: 'door_list' };
    const radiator = { instanceId: 'radiator_list:0', sourceList: 'radiator_list' };

    assert.deepEqual(filterNonSoftContentModels([soft, door, radiator]), [door, radiator]);
    assert.deepEqual(filterNonSoftContentModels(null), []);
});

test('scene orchestration starts isolated legacy-soft and unified non-soft pipelines', async () => {
    const scene = new THREE.Group();
    const legacySoftlists = [{ id: 'legacy-soft', kind: 'softlist' }];
    const normalizedSoft = { instanceId: 'soft_list:0', sourceList: 'soft_list' };
    const door = { instanceId: 'door_list:0', sourceList: 'door_list' };
    const calls = [];

    const loads = startSceneContentModelLoads({
        softlists: { softlists: legacySoftlists },
        contentModels: { contentModels: [normalizedSoft, door] },
    }, scene, new Map(), {
        async loadSoft(instances, sceneGroup) {
            calls.push(['soft', instances, sceneGroup]);
            throw Object.assign(new Error('controlled soft failure'), { code: 'SOFT_FAILED' });
        },
        async loadContent(instances, sceneGroup) {
            calls.push(['content', instances, sceneGroup]);
            return { summary: { loaded: 1 }, failures: [] };
        },
        diagnostic() {},
        logger: { log() {}, warn() {} },
    });
    await Promise.all([loads.softLoad, loads.contentLoad]);

    assert.deepEqual(calls, [
        ['soft', legacySoftlists, scene],
        ['content', [door], scene],
    ]);
});

test('GeometryService exposes every normalized content model without removing legacy softlists', async () => {
    const previousParseData = geometryService.parseData;
    const contentModels = [
        { instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0, category: 'soft' },
        { instanceId: 'door_list:0', sourceList: 'door_list', sourceIndex: 0, category: 'door' },
        { instanceId: 'window_list:0', sourceList: 'window_list', sourceIndex: 0, category: 'window' },
        { instanceId: 'radiator_list:0', sourceList: 'radiator_list', sourceIndex: 0, category: 'radiator' },
    ];
    const softlists = [{ id: 'legacy-softlist' }];
    geometryService.parseData = { content_models: contentModels, SoftLists: softlists };

    try {
        assert.deepEqual(await geometryService.getContentModels(), {
            success: true,
            contentModels,
        });
        assert.deepEqual(await geometryService.getSoftlists(), {
            success: true,
            softlists,
        });
    } finally {
        geometryService.parseData = previousParseData;
    }
});

test('visible door and window fallbacks retain their source identity', () => {
    const { doors, windows } = DoorWindowFactory.createDoorWindowBatch(
        [{ points: openingPoints, height: 2100, typeId: 'door-type' }],
        [{ points: openingPoints, height: 1400, groundHeight: 800, typeId: 'window-type' }],
    );

    assert.equal(doors[0].userData.sourceList, 'door_list');
    assert.equal(doors[0].userData.sourceIndex, 0);
    assert.equal(windows[0].userData.sourceList, 'window_list');
    assert.equal(windows[0].userData.sourceIndex, 0);
});

test('parser and factory retain original source indexes after filtered door and window records', async () => {
    const drawing = {
        final_room_list: [],
        final_space_dim_list: [],
        soft_list: [],
        window_list: [
            cadDoor({ TypeId: '1401', BlockInnerInfo: {
                高度: 1400, 离地高度: 800, 旋转角度: 0,
            } }),
            cadDoor({
                TypeId: '1401',
                BasePoint: 'X=1450 Y=1060 Z=0',
                BlockInnerInfo: { 高度: 1400, 离地高度: 800, 旋转角度: 0 },
                Points: [
                    'X=1000 Y=1000 Z=0', 'X=1900 Y=1000 Z=0',
                    'X=1900 Y=1120 Z=0', 'X=1000 Y=1120 Z=0',
                ],
            }),
        ],
        door_list: [
            cadDoor(),
            cadDoor({
                BasePoint: 'X=1450 Y=60 Z=0',
                Points: [
                    'X=1000 Y=0 Z=0', 'X=1900 Y=0 Z=0',
                    'X=1900 Y=120 Z=0', 'X=1000 Y=120 Z=0',
                ],
            }),
        ],
    };
    const parsed = ParseJson(drawing);
    const previousParseData = geometryService.parseData;
    geometryService.parseData = parsed;

    try {
        assert.deepEqual(parsed.content_models.map(model => [model.sourceList, model.sourceIndex]), [
            ['door_list', 0], ['door_list', 1],
            ['window_list', 0], ['window_list', 1],
        ]);
        assert.equal(parsed.door_list.length, 1);
        assert.equal(parsed.door_list[0].sourceIndex, 1);
        assert.equal(parsed.window_list.length, 1);
        assert.equal(parsed.window_list[0].sourceIndex, 1);

        const doorWindows = await geometryService.getDoorsAndWindows();
        assert.equal(doorWindows.doors[0].sourceIndex, 1);
        assert.equal(doorWindows.processed_doors[0].sourceIndex, 1);
        assert.equal(doorWindows.windows[0].sourceIndex, 1);
        assert.equal(doorWindows.processed_windows[0].sourceIndex, 1);

        const { doors, windows } = DoorWindowFactory.createDoorWindowBatch(
            doorWindows.doors, doorWindows.windows,
        );
        assert.equal(doors[0].userData.sourceIndex, 1);
        assert.equal(windows[0].userData.sourceIndex, 1);
        const fallbackMap = indexDoorWindowFallbacks({ doors, windows });
        const laterDoor = parsed.content_models.find(model =>
            model.sourceList === 'door_list' && model.sourceIndex === 1);
        const laterWindow = parsed.content_models.find(model =>
            model.sourceList === 'window_list' && model.sourceIndex === 1);
        handlePlacedContentModel(fallbackMap, laterDoor, new THREE.Group());
        assert.equal(doors[0].visible, false);
        assert.equal(windows[0].visible, true);
        handlePlacedContentModel(fallbackMap, laterWindow, new THREE.Group());
        assert.equal(windows[0].visible, false);
    } finally {
        geometryService.parseData = previousParseData;
    }
});

test('fallback visibility helper hides only the matching source identity', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const window = new THREE.Mesh();
    window.userData = { sourceList: 'window_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [window] });

    assert.equal(hidePlacedFallback(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }), true);
    assert.equal(door.visible, false);
    assert.equal(window.visible, true);
});

test('a placed door model marks its root and hides only its matching visible fallback', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const window = new THREE.Mesh();
    window.userData = { sourceList: 'window_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [window] });
    const root = new THREE.Group();

    assert.equal(handlePlacedContentModel(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }, root), true);
    assert.equal(root.userData.contentModelRoot, true);
    assert.equal(door.visible, false);
    assert.equal(window.visible, true);
});

test('the post-placement hook marks the real root and leaves unmatched fallbacks visible', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [] });
    const root = new THREE.Group();

    handlePlacedContentModel(fallbackMap, {
        sourceList: 'window_list', sourceIndex: 4,
    }, root);

    assert.equal(root.userData.contentModelRoot, true);
    assert.equal(door.visible, true);
});

test('real loader hides the visible fallback only after scene insertion and never touches cutters', async () => {
    assert.equal(typeof RoomRendererModule.createContentModelPlacementHandler, 'function');
    const scene = new THREE.Group();
    const fallback = new THREE.Mesh();
    fallback.userData = { sourceList: 'door_list', sourceIndex: 1 };
    const cutter = new THREE.Mesh();
    cutter.userData = { sourceList: 'door_list', sourceIndex: 1 };
    let fallbackVisible = true;
    let insertedBeforeHide = false;
    Object.defineProperty(fallback, 'visible', {
        configurable: true,
        get() { return fallbackVisible; },
        set(value) {
            if (value === false) {
                insertedBeforeHide = scene.children.some(child =>
                    child.userData.instanceId === 'door_list:1');
            }
            fallbackVisible = value;
        },
    });
    const fallbackMap = indexDoorWindowFallbacks({ doors: [fallback], windows: [] });
    const loader = controlledDoorLoader();

    const result = await loader.load([doorInstance()], scene, {
        onInstancePlaced: RoomRendererModule.createContentModelPlacementHandler(fallbackMap),
    });

    assert.equal(result.groups.length, 1);
    assert.equal(scene.children.includes(result.groups[0]), true);
    assert.equal(insertedBeforeHide, true);
    assert.equal(fallback.visible, false);
    assert.equal(cutter.visible, true);
});

test('selection, resource, load, and placement failures retain matching fallbacks and cutters', async () => {
    assert.equal(typeof RoomRendererModule.createContentModelPlacementHandler, 'function');
    for (const failurePhase of ['selection', 'resource', 'load', 'placement']) {
        const scene = new THREE.Group();
        const fallback = new THREE.Mesh();
        fallback.userData = { sourceList: 'door_list', sourceIndex: 1 };
        const cutter = new THREE.Mesh();
        cutter.userData = { sourceList: 'door_list', sourceIndex: 1 };
        const fallbackMap = indexDoorWindowFallbacks({ doors: [fallback], windows: [] });

        const result = await controlledDoorLoader(failurePhase).load([doorInstance()], scene, {
            onInstancePlaced: RoomRendererModule.createContentModelPlacementHandler(fallbackMap),
        });

        assert.equal(result.groups.length, 0, failurePhase);
        assert.equal(result.failures.length, 1, failurePhase);
        assert.equal(fallback.visible, true, failurePhase);
        assert.equal(cutter.visible, true, failurePhase);
    }
});
