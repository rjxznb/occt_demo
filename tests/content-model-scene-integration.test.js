import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import geometryService from '../src/core/GeometryService.js';
import ParseJson from '../src/utils/json_parse.js';
import { DoorWindowFactory } from '../src/components/DoorWindowFactory.js';
import { ContentModelLoader } from '../src/components/ContentModelLoader.js';
import * as RoomRendererModule from '../src/components/RoomRenderer.js';

const {
    createDoorWindowSceneBindings,
    handlePlacedContentModel,
    hasIndexedFallback,
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

function compositeWindowChild(index, count = 2) {
    return {
        instanceId: `window_list:1#segment:${index}`,
        sourceList: 'window_list',
        sourceIndex: 1,
        category: 'window',
        typeId: index === 1 ? '140c' : '1401',
        parentInstanceId: 'window_list:1',
        compositeSegmentIndex: index,
        compositeSegmentCount: count,
        generatedFromTypeId: '140d02',
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

test('door scene bindings omit door Boxes from results, scene inputs, and fallbacks', () => {
    const doorBox = new THREE.Mesh();
    doorBox.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const windowBox = new THREE.Mesh();
    windowBox.userData = { sourceList: 'window_list', sourceIndex: 0 };
    const doorCutter = new THREE.Mesh();
    const windowCutter = new THREE.Mesh();

    const result = createDoorWindowSceneBindings(
        { doors: [doorBox], windows: [windowBox] },
        { doors: [doorCutter], windows: [windowCutter] },
    );

    assert.deepEqual(result.doorMeshes, []);
    assert.deepEqual(result.windowMeshes, [windowBox]);
    assert.deepEqual(result.visibleMeshes, [windowBox]);
    assert.deepEqual(result.cutters.doors, [doorCutter]);
    assert.deepEqual(result.cutters.windows, [windowCutter]);
    assert.equal(result.fallbackMap.has('door_list:0'), false);
    assert.equal(result.fallbackMap.get('window_list:0'), windowBox);
});

test('scene orchestration routes soft and non-soft records through one content pipeline', async () => {
    const scene = new THREE.Group();
    const legacySoftlists = [{ id: 'legacy-soft', kind: 'softlist' }];
    const normalizedSoft = { instanceId: 'soft_list:0', sourceList: 'soft_list' };
    const door = { instanceId: 'door_list:0', sourceList: 'door_list' };
    const calls = [];
    let legacySoftCalls = 0;

    const loads = startSceneContentModelLoads({
        softlists: { softlists: legacySoftlists },
        contentModels: { contentModels: [normalizedSoft, door] },
    }, scene, new Map(), {
        async loadSoft() {
            legacySoftCalls += 1;
            return [];
        },
        async loadContent(instances, sceneGroup) {
            calls.push(['content', instances, sceneGroup]);
            return { summary: { placed: 2 }, failures: [] };
        },
        diagnostic() {},
        logger: { log() {}, warn() {} },
    });
    await loads.contentLoad;

    assert.deepEqual(calls, [
        ['content', [normalizedSoft, door], scene],
    ]);
    assert.equal(legacySoftCalls, 0);
    assert.deepEqual(Object.keys(loads), ['contentLoad']);
});

test('scene orchestration receives free-window children once instead of the parent', async () => {
    const parsed = ParseJson({
        window_list: [{
            TypeId: '140d02',
            BasePoint: 'X=0 Y=0 Z=0',
            Points: [
                'X=0 Y=0 Z=0 B=0',
                'X=1000 Y=0 Z=0 B=0.25',
                'X=1000 Y=1000 Z=0 B=0',
                'X=1200 Y=1000 Z=0 B=-0.25',
                'X=1200 Y=-200 Z=0 B=0',
                'X=0 Y=-200 Z=0 B=0',
            ],
            Size: 'X=0 Y=0',
            OutXScale: -1,
            OutYScale: -1,
            OutZScale: -1,
            OutRotateRadian: 0,
            BlockInnerInfo: { 高度: 1500, 离地高度: 900 },
        }],
    });
    const received = [];
    const loads = startSceneContentModelLoads({
        contentModels: { contentModels: parsed.content_models },
    }, new THREE.Group(), new Map(), {
        async loadContent(instances) {
            received.push(...instances);
            return { groups: [], summary: {}, failures: [] };
        },
        diagnostic() {},
        logger: { log() {}, warn() {} },
    });

    await loads.contentLoad;

    assert.deepEqual(received.map(instance => instance.instanceId), [
        'window_list:0#segment:0',
        'window_list:0#segment:1',
    ]);
    assert.deepEqual(received.map(instance => instance.typeId), ['1401', '140c']);
    assert.equal(received.some(instance => instance.typeId === '140d02'), false);
});

test('scene orchestration commits a free-window stage only after all children place', async () => {
    const scene = new THREE.Group();
    const fallback = new THREE.Mesh();
    fallback.visible = true;
    const fallbackMap = new Map([['window_list:1', fallback]]);
    const instances = [compositeWindowChild(0), compositeWindowChild(1)];
    const loads = startSceneContentModelLoads({
        contentModels: { contentModels: instances },
    }, scene, fallbackMap, {
        async loadContent(received, sceneGroup, options) {
            const groups = [];
            for (const current of received) {
                const root = new THREE.Group();
                root.userData.instanceId = current.instanceId;
                options.getPlacementTarget(current).add(root);
                groups.push(root);
                await options.onInstancePlaced(current, root);
                assert.equal(fallback.visible, true);
            }
            assert.equal(sceneGroup.children.length, 0);
            return {
                groups,
                summary: {
                    discovered: 1, localGeometry: 0, staticSelected: 0,
                    parametricSelected: 2, placed: 2, fallbackVisible: 0,
                    openingOnly: 0, failed: 0,
                },
                failures: [],
            };
        },
        diagnostic() {},
        logger: { log() {}, warn() {} },
    });

    const result = await loads.contentLoad;

    assert.equal(scene.children.length, 1);
    assert.equal(scene.children[0].userData.parentInstanceId, 'window_list:1');
    assert.equal(scene.children[0].children.length, 2);
    assert.equal(fallback.visible, false);
    assert.equal(result.groups.length, 2);
    assert.equal(result.summary.placed, 2);
    assert.equal(result.summary.fallbackVisible, 0);
});

test('scene orchestration removes partial free-window roots and retains one fallback', async () => {
    const scene = new THREE.Group();
    const fallback = new THREE.Mesh();
    fallback.visible = true;
    const fallbackMap = new Map([['window_list:1', fallback]]);
    const instances = [compositeWindowChild(0), compositeWindowChild(1)];
    const loads = startSceneContentModelLoads({
        contentModels: { contentModels: instances },
    }, scene, fallbackMap, {
        async loadContent(received, sceneGroup, options) {
            const root = new THREE.Group();
            root.userData.instanceId = received[0].instanceId;
            (options.getPlacementTarget?.(received[0]) ?? sceneGroup).add(root);
            await options.onInstancePlaced(received[0], root);
            return {
                groups: [root],
                summary: {
                    discovered: 1, localGeometry: 0, staticSelected: 0,
                    parametricSelected: 2, placed: 1, fallbackVisible: 0,
                    openingOnly: 0, failed: 1,
                },
                failures: [{
                    sourceList: 'window_list', sourceIndex: 1, typeId: '140c',
                    resId: '2423932', resourceKind: 'parametric-obj',
                    errorCode: 'PARAMETRIC_CONVERSION_FAILED',
                }],
            };
        },
        diagnostic() {},
        logger: { log() {}, warn() {} },
    });

    const result = await loads.contentLoad;

    assert.equal(scene.children.length, 0);
    assert.equal(fallback.visible, true);
    assert.deepEqual(result.groups, []);
    assert.equal(result.summary.placed, 0);
    assert.equal(result.summary.fallbackVisible, 1);
    assert.equal(result.failures.length, 1);
});

test('scene failure logs contain only the checkpoint allowlist', async () => {
    const warnings = [];
    const loads = startSceneContentModelLoads({}, new THREE.Group(), new Map(), {
        async loadContent() {
            return { summary: {}, failures: [{
                instanceId: 'door_list:4',
                sourceList: 'door_list',
                sourceIndex: 4,
                typeId: '1302',
                resId: '9001',
                errorCode: 'STATIC_MODEL_LOAD_FAILED',
                sourceUrl: 'https://secret.test/signed.glb',
            }] };
        },
        diagnostic() {},
        logger: {
            log() {},
            warn(...args) { warnings.push(args); },
        },
    });
    await loads.contentLoad;

    const failureLog = warnings.find(([label]) => label === '[ContentLoader] scene failures');
    assert.deepEqual(Object.keys(failureLog[1][0]).sort(), [
        'errorCode', 'resId', 'resourceKind', 'sourceIndex', 'sourceList', 'typeId',
    ]);
});

test('scene pipeline failures expose a safe diagnostic message in the log label', async () => {
    const warnings = [];
    const loads = startSceneContentModelLoads({}, new THREE.Group(), new Map(), {
        async loadContent() {
            throw Object.assign(
                new Error('Template load failed at https://secret.test/signed-template.json'),
                { code: 'TEMPLATE_LOAD_FAILED' },
            );
        },
        diagnostic() {},
        logger: {
            log() {},
            warn(...args) { warnings.push(args); },
        },
    });
    await loads.contentLoad;

    const pipelineLog = warnings.find(([label]) => label.startsWith(
        '[ContentLoader] scene pipeline failed',
    ));
    assert.equal(
        pipelineLog[0],
        '[ContentLoader] scene pipeline failed code=TEMPLATE_LOAD_FAILED message=Template load failed at [redacted-url]',
    );
});

test('throwing diagnostics cannot prevent the unified scene-model pipeline', async () => {
    let contentCalls = 0;
    const loads = startSceneContentModelLoads({}, new THREE.Group(), new Map(), {
        diagnostic() { throw new Error('diagnostic sink failed'); },
        async loadContent() {
            contentCalls += 1;
            return { summary: {}, failures: [] };
        },
        logger: { log() {}, warn() {} },
    });
    await loads.contentLoad;

    assert.equal(contentCalls, 1);
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

test('parser retains source-list order and factory retains indexes after filtered records', async () => {
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
            ['window_list', 0], ['window_list', 1],
            ['door_list', 0], ['door_list', 1],
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

    assert.equal(hasIndexedFallback(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }), true);
    assert.equal(hasIndexedFallback(fallbackMap, {
        sourceList: 'window_list', sourceIndex: 9,
    }), false);

    assert.equal(hidePlacedFallback(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }), true);
    assert.equal(door.visible, false);
    assert.equal(window.visible, true);
});

test('fallback lookup accepts any registered source list identity', () => {
    const fallback = new THREE.Mesh();
    const fallbackMap = new Map([['radiator_list:2', fallback]]);
    const instance = { sourceList: 'radiator_list', sourceIndex: 2 };

    assert.equal(hasIndexedFallback(fallbackMap, instance), true);
    assert.equal(hidePlacedFallback(fallbackMap, instance), true);
    assert.equal(fallback.visible, false);
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

test('local geometry and resource, load, or placement failures retain matching fallbacks and cutters', async () => {
    assert.equal(typeof RoomRendererModule.createContentModelPlacementHandler, 'function');
    for (const failurePhase of ['selection', 'resource', 'load', 'placement']) {
        const scene = new THREE.Group();
        const fallback = new THREE.Mesh();
        fallback.userData = { sourceList: 'door_list', sourceIndex: 1 };
        const cutter = new THREE.Mesh();
        cutter.userData = { sourceList: 'door_list', sourceIndex: 1 };
        const fallbackMap = indexDoorWindowFallbacks({ doors: [fallback], windows: [] });

        const result = await controlledDoorLoader(failurePhase).load([doorInstance()], scene, {
            hasFallback: instance => hasIndexedFallback(fallbackMap, instance),
            onInstancePlaced: RoomRendererModule.createContentModelPlacementHandler(fallbackMap),
        });

        assert.equal(result.groups.length, 0, failurePhase);
        assert.equal(result.failures.length, failurePhase === 'selection' ? 0 : 1, failurePhase);
        assert.equal(result.summary.localGeometry, failurePhase === 'selection' ? 1 : 0, failurePhase);
        assert.equal(result.summary.fallbackVisible, failurePhase === 'selection' ? 0 : 1,
            failurePhase);
        assert.equal(fallback.visible, true, failurePhase);
        assert.equal(cutter.visible, true, failurePhase);
    }
});
