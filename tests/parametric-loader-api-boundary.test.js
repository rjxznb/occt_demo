import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { loadParametricModels, loadTemplate } from '../src/components/ParametricModelLoader.js';
import {
    findParametricSoftlistRoot,
    isSceneRaycastTarget,
    logParametricSoftlistDebug,
} from '../src/components/SceneClickInteraction.js';

const templateResponse = {
    AllItemInfo: [{
        TypeId: '1001',
        TypeName: 'Compatibility template',
        StyleItemType: 0,
        ResList: [{ ResId: 'res-1001', X: 1, Y: 2, Z: 3 }],
    }],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    assert.equal(url, 'data/template.json');
    return { ok: true, json: async () => templateResponse };
};

test.after(() => {
    globalThis.fetch = originalFetch;
});

test('loadTemplate keeps the compatibility template API backed by the shared resolver', async () => {
    const template = await loadTemplate();
    assert.deepEqual(template.get('1001'), {
        resId: 'res-1001',
        defaultSize: { x: 1, y: 2, z: 3 },
        typeName: 'Compatibility template',
    });
});

test('loadParametricModels uses the independent per-resource detail and conversion path', async () => {
    const scene = new THREE.Group();
    const calls = [];
    const templateResolver = {
        async load() {},
        select() {
            return {
                typeId: '1001', typeName: 'Compatibility template', resId: 'res-1001',
                referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
            };
        },
    };
    const apiClient = {
        async getGoodsDetail(resId) {
            calls.push(['detail', resId]);
            return { data: { modelDTO: {
                parameterizedJsonUrl: 'https://file.test/model.json',
            } } };
        },
        async convertModel(url, parameters) {
            calls.push(['convert', url, parameters]);
            return { obj: 'parameterized model fixture' };
        },
    };
    const modelParams = [{ name: 'width', value: 100 }];

    const result = await loadParametricModels([
        {
            id: 'legacy-7',
            kind: 'softlist',
            typeId: 1001,
            basepoint: { x: 10, y: 20, z: 30 },
            footprint: [
                { x: 0, y: 0 }, { x: 100, y: 0 },
                { x: 100, y: 200 }, { x: 0, y: 200 },
            ],
            size: { x: 100, y: 200, z: 300 },
            rotate: 75,
            horizontalFlip: true,
            verticalFlip: false,
            groundHeight: 25,
            modelParams,
            rawBlockInnerInfo: { style: 'legacy' },
        },
        { id: 'not-softlist', kind: 'door', typeId: '1001' },
    ], scene, {
        templateResolver,
        apiClient,
        parseObj(content) {
            assert.equal(content, 'parameterized model fixture');
            const root = new THREE.Group();
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                null,
            );
            root.add(mesh);
            return root;
        },
        logger: { log() {}, warn() {} },
    });

    assert.equal(result.length, 1);
    assert.equal(scene.children.includes(result[0]), true);
    assert.deepEqual(calls, [
        ['detail', 'res-1001'],
        ['convert', 'https://file.test/model.json', modelParams],
    ]);
    assert.equal(result[0].userData.type, 'parametric-softlist');
    assert.equal(result[0].userData.softlistId, 'legacy-7');
    const placedMesh = result[0].getObjectByProperty('isMesh', true);
    assert.equal(isSceneRaycastTarget(placedMesh), true);
    assert.equal(placedMesh.castShadow, true);
    assert.equal(placedMesh.receiveShadow, true);
    assert.equal(placedMesh.material?.isMeshStandardMaterial, true);
});

test('concurrent parameter variants share one in-flight goods-detail request', async () => {
    const scene = new THREE.Group();
    let detailCalls = 0;
    let conversionCalls = 0;
    const templateResolver = {
        async load() {},
        select() {
            return {
                typeId: '1001', typeName: 'Shared resource', resId: 'res-shared',
                referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
            };
        },
    };
    const apiClient = {
        async getGoodsDetail() {
            detailCalls += 1;
            await Promise.resolve();
            return { parameterizedJsonUrl: 'https://file.test/shared.json' };
        },
        async convertModel() {
            conversionCalls += 1;
            return { obj: 'parameterized model fixture' };
        },
    };
    const footprint = [
        { x: 0, y: 0 }, { x: 100, y: 0 },
        { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const groups = await loadParametricModels([
        { id: 'variant-a', kind: 'softlist', typeId: '1001', footprint,
            basepoint: { x: 0, y: 0, z: 0 }, modelParams: [{ name: 'width', value: 100 }] },
        { id: 'variant-b', kind: 'softlist', typeId: '1001', footprint,
            basepoint: { x: 200, y: 0, z: 0 }, modelParams: [{ name: 'width', value: 200 }] },
    ], scene, {
        concurrency: 2,
        templateResolver,
        apiClient,
        parseObj() {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
            return root;
        },
        logger: { log() {}, warn() {} },
    });

    assert.equal(groups.length, 2);
    assert.equal(detailCalls, 1);
    assert.equal(conversionCalls, 2);
});

test('equivalent parameter ordering shares one converted prototype', async () => {
    let conversionCalls = 0;
    const footprint = [
        { x: 0, y: 0 }, { x: 100, y: 0 },
        { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const groups = await loadParametricModels([
        { id: 'ordered-a', kind: 'softlist', typeId: '1001', footprint,
            basepoint: { x: 0, y: 0, z: 0 }, modelParams: [
                { name: 'height', value: '20' }, { name: 'width', value: 100 },
            ] },
        { id: 'ordered-b', kind: 'softlist', typeId: '1001', footprint,
            basepoint: { x: 200, y: 0, z: 0 }, modelParams: [
                { value: '100', name: 'width' }, { value: 20, name: 'height' },
            ] },
    ], new THREE.Group(), {
        concurrency: 2,
        templateResolver: {
            async load() {},
            select() {
                return {
                    typeId: '1001', typeName: 'Canonical', resId: 'res-canonical',
                    referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
                };
            },
        },
        apiClient: {
            async getGoodsDetail() {
                return { parameterizedJsonUrl: 'https://file.test/canonical.json' };
            },
            async convertModel() {
                conversionCalls += 1;
                return { obj: 'parameterized model fixture' };
            },
        },
        parseObj() {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
            return root;
        },
        logger: { log() {}, warn() {} },
    });

    assert.equal(groups.length, 2);
    assert.equal(conversionCalls, 1);
});

test('a throwing progress observer does not reject already placed soft models', async () => {
    const scene = new THREE.Group();
    const groups = await loadParametricModels([{
        id: 'progress-safe', kind: 'softlist', typeId: '1001',
        basepoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 100 }, { x: 0, y: 100 },
        ],
        modelParams: [],
    }], scene, {
        templateResolver: {
            async load() {},
            select() {
                return {
                    typeId: '1001', typeName: 'Progress safe', resId: 'res-progress',
                    referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
                };
            },
        },
        apiClient: {
            async getGoodsDetail() {
                return { parameterizedJsonUrl: 'https://file.test/progress.json' };
            },
            async convertModel() { return { obj: 'parameterized model fixture' }; },
        },
        parseObj() {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
            return root;
        },
        onProgress() { throw new Error('observer failed'); },
        logger: { log() {}, warn() {} },
    });

    assert.equal(groups.length, 1);
    assert.equal(scene.children.includes(groups[0]), true);
});

test('legacy prototype cache evicts the least recently used parameterized model', async () => {
    let conversionCalls = 0;
    const templateResolver = {
        async load() {},
        select(instance) {
            return {
                typeId: instance.typeId, typeName: instance.typeId, resId: `res-${instance.typeId}`,
                referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
            };
        },
    };
    const apiClient = {
        async getGoodsDetail(resId) {
            return { parameterizedJsonUrl: `https://file.test/${resId}.json` };
        },
        async convertModel() {
            conversionCalls += 1;
            return { obj: 'parameterized model fixture' };
        },
    };
    const footprint = [
        { x: 0, y: 0 }, { x: 100, y: 0 },
        { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const options = {
        concurrency: 1,
        prototypeCacheLimit: 2,
        urlCacheLimit: 2,
        templateResolver,
        apiClient,
        parseObj() {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
            return root;
        },
        logger: { log() {}, warn() {} },
    };
    const item = typeId => ({
        id: typeId, kind: 'softlist', typeId,
        basepoint: { x: 0, y: 0, z: 0 }, footprint, modelParams: [],
    });

    await loadParametricModels([item('one'), item('two'), item('three')], new THREE.Group(), options);
    await loadParametricModels([item('one')], new THREE.Group(), options);

    assert.equal(conversionCalls, 4);
});

test('independent legacy loader preserves current parametric click metadata', async () => {
    const scene = new THREE.Group();
    let callbackCalls = 0;
    let callbackDebugInfo;
    const groups = await loadParametricModels([{
        id: 'legacy-click',
        instanceId: 'normalized-click',
        kind: 'softlist',
        typeId: '1001',
        basepoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 100 }, { x: 0, y: 100 },
        ],
        size: { x: 100, y: 100, z: 100 },
        rotate: 75,
        modelParams: [],
    }], scene, {
        templateResolver: {
            async load() {},
            select() {
                return {
                    typeId: '1001', typeName: 'Compatibility template', resId: '100',
                    referenceSize: { x: 10, y: 10, z: 10 }, selection: 'nearest-area',
                };
            },
        },
        apiClient: {
            async getGoodsDetail() {
                return { data: { modelDTO: {
                    id: '100',
                    parameterizedJsonUrl: 'https://file.test/model.json',
                } } };
            },
            async convertModel() { return { obj: 'parameterized model fixture' }; },
        },
        parseObj() {
            const root = new THREE.Group();
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial(),
            );
            mesh.userData.type = 'source-mesh-type';
            root.add(mesh);
            return root;
        },
        async onInstancePlaced(instance, root) {
            callbackCalls += 1;
            callbackDebugInfo = root.userData.debugInfo;
            throw new Error('legacy observer failed');
        },
        logger: { log() {}, warn() {} },
    });

    assert.equal(groups.length, 1);
    const mesh = groups[0].getObjectByProperty('isMesh', true);
    assert.equal(findParametricSoftlistRoot(mesh), groups[0]);
    assert.equal(callbackCalls, 1);
    assert.equal(groups[0].userData.softlistId, 'legacy-click');
    assert.equal(mesh.userData.softlistId, 'legacy-click');
    assert.equal(mesh.userData.type, 'source-mesh-type');

    const debugInfo = groups[0].userData.debugInfo;
    assert.equal(debugInfo.softlistId, 'legacy-click');
    assert.equal(debugInfo.typeName, 'Compatibility template');
    assert.equal(debugInfo.resId, '100');
    assert.deepEqual(debugInfo.defaultSize, { x: 10, y: 10, z: 10 });
    assert.deepEqual(debugInfo.source.basepoint, { x: 0, y: 0, z: 0 });
    assert.equal(debugInfo.transform.rotate, 75);
    assert.equal(debugInfo.placement.baseScale, 10);
    assert.equal(debugInfo.selection.typeName, 'Compatibility template');
    assert.equal(debugInfo.transform.rotationDegrees, 75);
    assert.equal(callbackDebugInfo, debugInfo);

    const logged = [];
    const didLog = logParametricSoftlistDebug(groups[0], '#debug', {
        groupCollapsed(...args) { logged.push(['group', ...args]); },
        log(...args) { logged.push(['log', ...args]); },
        groupEnd() { logged.push(['end']); },
    });
    assert.equal(didLog, true);
    assert.equal(logged[1][0], 'log');
    assert.equal(logged[1][1], '模型信息');
    assert.equal(logged[1][2], debugInfo);
});
