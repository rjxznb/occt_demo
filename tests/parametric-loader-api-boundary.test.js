import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import { loadParametricModels, loadTemplate } from '../src/components/ParametricModelLoader.js';
import { findParametricSoftlistRoot } from '../src/components/SceneClickInteraction.js';

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

test('unified loader owns resource dispatch while the compatibility loader has no transport or prototype pipeline', async () => {
    const [contentSource, compatibilitySource] = await Promise.all([
        readFile(new URL('../src/components/ContentModelLoader.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/ParametricModelLoader.js', import.meta.url), 'utf8'),
    ]);

    assert.match(contentSource, /GLTFLoader/);
    assert.match(contentSource, /OBJLoader/);
    assert.match(contentSource, /apiClient\.getGoodsDetails/);
    assert.match(contentSource, /apiClient\.convertModel/);
    assert.match(contentSource, /resolveModelResource/);
    assert.match(contentSource, /placeContentModel/);

    assert.match(compatibilitySource, /loadContentModels/);
    assert.doesNotMatch(compatibilitySource, /OBJLoader|GLTFLoader/);
    assert.doesNotMatch(compatibilitySource, /getGoodsDetail|convertModel|resolveModelResource/);
    assert.doesNotMatch(compatibilitySource, /modelCache|pendingRequests|urlCache|parseObj/);

    for (const source of [contentSource, compatibilitySource]) {
        assert.doesNotMatch(source, /biz-gateway\.home\.ke\.com|localhost:3100/);
        assert.doesNotMatch(source, /getParametricGoodsDetail|getContentGoodsDetails|convertParametricModel/);
        assert.doesNotMatch(source, /\/api\/(?:getGoodsDetail|modelUrlToObj)/);
    }
});

test('loadTemplate keeps the compatibility template API backed by the shared resolver', async () => {
    const template = await loadTemplate();
    assert.deepEqual(template.get('1001'), {
        resId: 'res-1001',
        defaultSize: { x: 1, y: 2, z: 3 },
        typeName: 'Compatibility template',
    });
});

test('loadParametricModels is a thin adapter from legacy softlists to unified instances', async () => {
    const scene = new THREE.Group();
    const groups = [new THREE.Group()];
    let received;
    const loader = {
        async load(instances, sceneGroup, options) {
            received = { instances, sceneGroup, options };
            return { groups, summary: {}, failures: [], selections: [] };
        },
    };
    const onProgress = () => {};

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
            modelParams: [{ name: 'width', value: 100 }],
            rawBlockInnerInfo: { style: 'legacy' },
        },
        { id: 'not-softlist', kind: 'door', typeId: '1001' },
    ], scene, { loader, concurrency: 2, onProgress });

    assert.equal(result, groups);
    assert.equal(received.sceneGroup, scene);
    assert.equal(received.options.loader, loader);
    assert.equal(received.options.concurrency, 2);
    assert.equal(received.options.onProgress, onProgress);
    assert.deepEqual(received.instances, [{
        instanceId: 'legacy-7',
        sourceList: 'soft_list',
        sourceIndex: 0,
        category: 'soft',
        typeId: '1001',
        basePoint: { x: 10, y: 20, z: 30 },
        footprint: [
            { x: 0, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 200 }, { x: 0, y: 200 },
        ],
        size: { x: 100, y: 200, z: 300 },
        rotationDegrees: 75,
        horizontalFlip: true,
        verticalFlip: false,
        outScale: undefined,
        groundHeight: 25,
        modelParams: [{ name: 'width', value: 100 }],
        rawBlockInnerInfo: { style: 'legacy' },
    }]);
});

test('legacy adapter preserves current parametric click metadata through unified placement', async () => {
    const scene = new THREE.Group();
    const groups = await loadParametricModels([{
        id: 'legacy-click',
        kind: 'softlist',
        typeId: '1001',
        basepoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 100 }, { x: 0, y: 100 },
        ],
        size: { x: 100, y: 100, z: 100 },
        rotate: 0,
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
            async getGoodsDetails() {
                return { items: [{
                    id: '100', modelType: 1,
                    resourceList: [{ type: 1, data: {
                        webV2Url: 'https://file.test/static.kb', webV2Md5: 'hash',
                    } }],
                }] };
            },
        },
        async loadGltf() {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshBasicMaterial(),
            ));
            return root;
        },
        logger: { log() {}, warn() {} },
    });

    assert.equal(groups.length, 1);
    const mesh = groups[0].getObjectByProperty('isMesh', true);
    assert.equal(findParametricSoftlistRoot(mesh), groups[0]);
    assert.equal(groups[0].userData.softlistId, 'legacy-click');
    assert.equal(groups[0].userData.debugInfo.softlistId, 'legacy-click');
});
