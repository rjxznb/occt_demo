import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

import {
    ContentModelLoader,
    normalizeParameters,
    parametricCacheKey,
    staticCacheKey,
} from '../src/components/ContentModelLoader.js';

const validObj = [
    'o content-model',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'f 1 2 3',
].join('\n');

function instance(typeId, id, modelParams = []) {
    return {
        instanceId: `soft_list:${id}`,
        sourceList: 'soft_list',
        sourceIndex: Number(id),
        category: 'soft',
        typeId,
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 100 }, { x: 0, y: 100 },
        ],
        size: { x: 100, y: 100, z: 100 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        modelParams,
    };
}

function selection(resId, typeId) {
    return {
        typeId,
        typeName: `type-${typeId}`,
        resId,
        referenceSize: { x: 10, y: 10, z: 10 },
        selection: 'nearest-area',
        xMirror: false,
        groundDist: 0,
    };
}

function staticDetail(resId, hash = `hash-${resId}`, sourceUrl = `https://file.test/${resId}.kb`) {
    return {
        id: resId,
        modelType: 1,
        resourceList: [{ type: 1, data: { webV2Url: sourceUrl, webV2Md5: hash } }],
    };
}

function parametricDetail(resId, hash = `hash-${resId}`, sourceUrl = `https://file.test/${resId}.json`) {
    return {
        id: resId,
        modelType: 0,
        resourceList: [{ type: 8, data: {
            parameterizedJsonUrl: sourceUrl,
            parameterizedJsonMd5: hash,
        } }],
    };
}

function prototype(material = new THREE.MeshBasicMaterial({ color: 0x123456 })) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return group;
}

function skinnedPrototype() {
    const geometry = new THREE.BoxGeometry(20, 80, 20);
    const vertexCount = geometry.getAttribute('position').count;
    const skinIndices = new Uint16Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);
    for (let index = 0; index < vertexCount; index += 1) skinWeights[index * 4] = 1;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

    const rootBone = new THREE.Bone();
    rootBone.name = 'rootBone';
    const tipBone = new THREE.Bone();
    tipBone.name = 'tipBone';
    tipBone.position.y = 80;
    rootBone.add(tipBone);

    const mesh = new THREE.SkinnedMesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0x123456 }),
    );
    mesh.name = 'skinnedMesh';
    mesh.add(rootBone);
    mesh.bind(new THREE.Skeleton([rootBone, tipBone]));

    const group = new THREE.Group();
    group.add(mesh);
    return group;
}

function placeClone(model, currentInstance) {
    const root = model.clone(true);
    root.name = `placed-${currentInstance.instanceId}`;
    root.userData = { instanceId: currentInstance.instanceId };
    return root;
}

function makeHarness({
    selections, details, loadGltf, parseObj, convertModel, getGoodsDetails, logger,
    getMaterialDetails, prototypeCacheLimit, resolveParameters,
} = {}) {
    const calls = {
        sequence: [], goods: [], materials: [], gltf: [], convert: [], place: [],
        resolveParameters: [],
    };
    const templateResolver = {
        async load() {
            calls.sequence.push('template-load');
        },
        select(currentInstance) {
            calls.sequence.push(`select:${currentInstance.instanceId}`);
            const selected = selections?.get(currentInstance.typeId);
            return typeof selected === 'function' ? selected(currentInstance) : selected;
        },
    };
    const apiClient = {
        async getGoodsDetails(resIds) {
            calls.sequence.push('goods-details');
            calls.goods.push([...resIds]);
            if (getGoodsDetails) return getGoodsDetails(resIds);
            return { items: details ?? [] };
        },
        async convertModel(url, parameters) {
            calls.convert.push({ url, parameters });
            if (convertModel) return convertModel(url, parameters);
            return { obj: validObj };
        },
        async getMaterialDetails(codes) {
            calls.materials.push([...codes]);
            return getMaterialDetails ? getMaterialDetails(codes) : { items: [] };
        },
    };
    const loader = new ContentModelLoader({
        templateResolver,
        apiClient,
        async loadGltf(url) {
            calls.gltf.push(url);
            return loadGltf ? loadGltf(url) : prototype();
        },
        parseObj: parseObj ?? (() => prototype()),
        placeModel(model, currentInstance, selected, resource) {
            calls.place.push({ model, currentInstance, selected, resource });
            return placeClone(model, currentInstance);
        },
        resolveParameters(currentInstance, selected) {
            calls.resolveParameters.push({ currentInstance, selected });
            return resolveParameters
                ? resolveParameters(currentInstance, selected)
                : (currentInstance.modelParams ?? []);
        },
        logger: logger ?? { log() {}, warn() {} },
        prototypeCacheLimit,
    });
    return { loader, calls };
}

test('parameterized OBJ consumes BimRenderMat without requesting material details', async () => {
    const materialName = '237e983c-f392-434a-be5c-7c695c60b00d';
    const materialCode = 'PT527545889554403328';
    const parsedMaterial = new THREE.MeshStandardMaterial();
    parsedMaterial.name = materialName;
    const root = prototype(parsedMaterial);
    const { loader, calls } = makeHarness({
        selections: new Map([['1401', selection('2406313', '1401')]]),
        details: [parametricDetail('2406313')],
        parseObj: () => root,
        convertModel: async () => ({
            obj: validObj,
            material: {
                [materialName]: {
                    ID: materialCode,
                    IsModel: false,
                    MatName: materialName,
                    BimRenderMat: 3,
                },
            },
        }),
    });

    await loader.load([instance('1401', 0)], new THREE.Group());

    assert.deepEqual(calls.materials, []);
    assert.equal(parsedMaterial.userData.contentMaterialIsGlass, true);
});

test('default GLTF loading configures the bundled Draco decoder', () => {
    const configured = [];
    const original = GLTFLoader.prototype.setDRACOLoader;
    GLTFLoader.prototype.setDRACOLoader = function setDRACOLoader(loader) {
        configured.push(loader);
        return original.call(this, loader);
    };
    try {
        new ContentModelLoader({
            templateResolver: { async load() {}, select() {} },
            apiClient: {},
            logger: { log() {}, warn() {} },
        });
    } finally {
        GLTFLoader.prototype.setDRACOLoader = original;
    }

    assert.equal(configured.length, 1);
    assert.ok(configured[0] instanceof DRACOLoader);
    assert.equal(configured[0].decoderPath, 'data/draco/gltf/');
    assert.equal(configured[0].workerLimit, 3);
});

test('dispatches same-list static and parametric resources and resolves parameters only for type 8', async () => {
    const selections = new Map([
        ['static', selection('100', 'static')],
        ['parametric', selection('200', 'parametric')],
    ]);
    const resolvedParameters = [{ name: '宽度', value: 800 }];
    const warnings = [];
    const { loader, calls } = makeHarness({
        selections,
        details: [
            staticDetail('100', 'static-hash', 'https://file.test/static.kb'),
            parametricDetail('200', 'param-hash', 'https://file.test/param.json'),
        ],
        resolveParameters: () => resolvedParameters,
        logger: { log() {}, warn(...args) { warnings.push(args); } },
    });

    const result = await loader.load([
        instance('static', 0),
        instance('parametric', 1, [{ name: 'wrong-legacy-value', value: -1 }]),
    ], new THREE.Group());

    assert.deepEqual(calls.sequence, [
        'template-load', 'select:soft_list:0', 'select:soft_list:1', 'goods-details',
    ]);
    assert.deepEqual(calls.goods, [['100', '200']]);
    assert.deepEqual(calls.gltf, ['https://file.test/static.kb']);
    assert.deepEqual(calls.convert, [{
        url: 'https://file.test/param.json', parameters: resolvedParameters,
    }]);
    assert.equal(calls.resolveParameters.length, 1);
    assert.equal(calls.resolveParameters[0].currentInstance.typeId, 'parametric');
    assert.deepEqual(
        calls.place.find(call => call.currentInstance.typeId === 'parametric')
            .currentInstance.modelParams,
        resolvedParameters,
    );
    assert.deepEqual(result.summary, {
        discovered: 2,
        localGeometry: 0,
        staticSelected: 1,
        parametricSelected: 1,
        placed: 2,
        fallbackVisible: 0,
        openingOnly: 0,
        failed: 0,
    });
    assert.equal(result.groups.length, 2);
    assert.equal(result.selections.length, 2);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(warnings, []);
});

test('deduplicates static prototypes in flight and in cache while returning independent roots', async () => {
    const selections = new Map([['chair', selection('100', 'chair')]]);
    const { loader, calls } = makeHarness({ selections, details: [staticDetail('100')] });
    const scene = new THREE.Group();

    const first = await loader.load([instance('chair', 0), instance('chair', 1)], scene);
    const second = await loader.load([instance('chair', 2)], scene);

    assert.equal(calls.gltf.length, 1);
    assert.equal(first.groups.length, 2);
    assert.notEqual(first.groups[0], first.groups[1]);
    assert.notEqual(first.groups[0], second.groups[0]);
    assert.equal(scene.children.length, 3);
});

test('cached skinned prototypes place independent skeletons, bones, geometry, and materials', async () => {
    const cachedPrototype = skinnedPrototype();
    let prototypeLoads = 0;
    const selected = selection('100', 'chair');
    const loader = new ContentModelLoader({
        templateResolver: {
            async load() {},
            select() { return selected; },
        },
        apiClient: {
            async getGoodsDetails() { return { items: [staticDetail('100')] }; },
        },
        async loadGltf() {
            prototypeLoads += 1;
            return cachedPrototype;
        },
        logger: { log() {}, warn() {} },
    });
    const firstInstance = { ...instance('chair', 0), horizontalFlip: true };
    const secondInstance = instance('chair', 1);

    const result = await loader.load([firstInstance, secondInstance], new THREE.Group());
    const firstRoot = result.groups.find(root => root.userData.instanceId === firstInstance.instanceId);
    const secondRoot = result.groups.find(root => root.userData.instanceId === secondInstance.instanceId);
    const firstMesh = firstRoot.getObjectByName('skinnedMesh');
    const secondMesh = secondRoot.getObjectByName('skinnedMesh');
    const prototypeMesh = cachedPrototype.getObjectByName('skinnedMesh');
    const firstHierarchy = new Set();
    const secondHierarchy = new Set();
    firstRoot.traverse(node => firstHierarchy.add(node));
    secondRoot.traverse(node => secondHierarchy.add(node));

    assert.equal(prototypeLoads, 1);
    assert.notEqual(firstRoot, secondRoot);
    assert.notEqual(firstMesh.geometry, secondMesh.geometry);
    assert.notEqual(firstMesh.geometry, prototypeMesh.geometry);
    assert.notEqual(secondMesh.geometry, prototypeMesh.geometry);
    assert.notEqual(firstMesh.material, secondMesh.material);
    assert.notEqual(firstMesh.material, prototypeMesh.material);
    assert.notEqual(secondMesh.material, prototypeMesh.material);
    assert.notEqual(firstMesh.skeleton, secondMesh.skeleton);
    assert.notEqual(firstMesh.skeleton, prototypeMesh.skeleton);
    assert.notEqual(secondMesh.skeleton, prototypeMesh.skeleton);
    assert.equal(firstMesh.skeleton.bones.length, 2);
    assert.equal(secondMesh.skeleton.bones.length, 2);
    firstMesh.skeleton.bones.forEach(bone => assert.equal(firstHierarchy.has(bone), true));
    secondMesh.skeleton.bones.forEach(bone => assert.equal(secondHierarchy.has(bone), true));
    assert.notEqual(firstMesh.skeleton.bones[0], secondMesh.skeleton.bones[0]);
    assert.notEqual(firstMesh.skeleton.bones[1], secondMesh.skeleton.bones[1]);
    assert.equal(firstRoot.children[0].children[0].scale.x, -1);
    assert.equal(secondRoot.children[0].children[0].scale.x, 1);
    assert.equal(firstMesh.material.side, THREE.DoubleSide);
    assert.equal(secondMesh.material.side, THREE.FrontSide);
    assert.equal(prototypeMesh.material.side, THREE.FrontSide);
});

test('bounds the shared prototype cache and refreshes recently used entries', async () => {
    const selections = new Map([
        ['zero', selection('100', 'zero')],
        ['one', selection('101', 'one')],
        ['two', selection('102', 'two')],
    ]);
    const { loader, calls } = makeHarness({
        selections,
        details: [staticDetail('100'), staticDetail('101'), staticDetail('102')],
        prototypeCacheLimit: 2,
    });
    const scene = new THREE.Group();

    await loader.load([instance('zero', 0)], scene);
    await loader.load([instance('one', 1)], scene);
    await loader.load([instance('zero', 2)], scene);
    await loader.load([instance('two', 3)], scene);
    await loader.load([instance('one', 4)], scene);

    assert.deepEqual(calls.gltf, [
        'https://file.test/100.kb',
        'https://file.test/101.kb',
        'https://file.test/102.kb',
        'https://file.test/101.kb',
    ]);
    assert.equal(loader.prototypeCache.size, 2);
});

test('normalizes parameter object order, parameter order, and numeric values for cache deduplication', async () => {
    const firstParams = [
        { name: 'width', value: '800.0', metadata: { z: 2, a: 1 } },
        { name: 'height', value: 900 },
    ];
    const secondParams = [
        { value: '900.00', name: 'height' },
        { metadata: { a: 1, z: 2 }, value: 800, name: 'width' },
    ];
    const resource = { resId: '200', contentHash: 'param-hash' };
    assert.equal(normalizeParameters(firstParams), normalizeParameters(secondParams));
    assert.equal(parametricCacheKey(resource, firstParams), parametricCacheKey(resource, secondParams));

    const selections = new Map([['cabinet', selection('200', 'cabinet')]]);
    const { loader, calls } = makeHarness({
        selections,
        details: [parametricDetail('200', 'param-hash')],
    });
    const result = await loader.load([
        instance('cabinet', 0, firstParams),
        instance('cabinet', 1, secondParams),
    ], new THREE.Group());

    assert.equal(calls.convert.length, 1);
    assert.equal(result.groups.length, 2);
    assert.notEqual(result.groups[0], result.groups[1]);
});

test('isolates a static load failure and continues loading a parameterized model', async () => {
    const signedUrl = 'https://file.test/static.kb?signature=sentinel-secret';
    const selections = new Map([
        ['static', selection('100', 'static')],
        ['parametric', selection('200', 'parametric')],
    ]);
    const { loader } = makeHarness({
        selections,
        details: [staticDetail('100', 'bad-hash', signedUrl), parametricDetail('200')],
        loadGltf: async () => {
            throw new Error(`download failed for ${signedUrl}`);
        },
    });

    const result = await loader.load([
        instance('static', 0), instance('parametric', 1),
    ], new THREE.Group());

    assert.equal(result.groups.length, 1);
    assert.equal(result.summary.parametricSelected, 1);
    assert.equal(result.summary.staticSelected, 1);
    assert.equal(result.summary.placed, 1);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.failures[0].errorCode, 'STATIC_MODEL_LOAD_FAILED');
    assert.doesNotMatch(JSON.stringify(result.failures), /sentinel-secret|https:\/\//);
});

test('caps prototype work at concurrency three', async () => {
    const selections = new Map();
    const details = [];
    for (let index = 0; index < 7; index += 1) {
        selections.set(`type-${index}`, selection(String(index), `type-${index}`));
        details.push(staticDetail(String(index)));
    }
    let active = 0;
    let maximum = 0;
    const { loader } = makeHarness({
        selections,
        details,
        loadGltf: async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return prototype();
        },
    });

    const result = await loader.load(
        [...selections.keys()].map((typeId, index) => instance(typeId, index)),
        new THREE.Group(),
        { concurrency: 3 },
    );

    assert.equal(result.groups.length, 7);
    assert.equal(maximum, 3);
});

test('caps prototype work at three across simultaneous load calls', async () => {
    const selections = new Map();
    const details = [];
    for (let index = 0; index < 8; index += 1) {
        selections.set(`type-${index}`, selection(String(index), `type-${index}`));
        details.push(staticDetail(String(index)));
    }
    let active = 0;
    let maximum = 0;
    const { loader } = makeHarness({
        selections,
        details,
        loadGltf: async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return prototype();
        },
    });

    await Promise.all([
        loader.load([0, 1, 2, 3].map(index => instance(`type-${index}`, index)), new THREE.Group()),
        loader.load([4, 5, 6, 7].map(index => instance(`type-${index}`, index)), new THREE.Group()),
    ]);

    assert.equal(maximum, 3);
});

test('rejects prototypes without Mesh and applies shadows and fallback material only when needed', async () => {
    const existingMaterial = new THREE.MeshBasicMaterial({ color: 0xabcdef });
    const selections = new Map([
        ['empty', selection('1', 'empty')],
        ['missing-material', selection('2', 'missing-material')],
        ['existing-material', selection('3', 'existing-material')],
    ]);
    const { loader } = makeHarness({
        selections,
        details: [staticDetail('1'), staticDetail('2'), staticDetail('3')],
        loadGltf: async (url) => {
            if (url.endsWith('/1.kb')) return new THREE.Group();
            if (url.endsWith('/2.kb')) return prototype(null);
            return prototype(existingMaterial);
        },
    });

    const result = await loader.load([
        instance('empty', 0), instance('missing-material', 1), instance('existing-material', 2),
    ], new THREE.Group());

    assert.equal(result.groups.length, 2);
    assert.equal(result.failures[0].errorCode, 'STATIC_MODEL_LOAD_FAILED');
    const missingMesh = result.groups[0].children[0];
    const existingMesh = result.groups[1].children[0];
    assert.equal(missingMesh.castShadow, true);
    assert.equal(missingMesh.receiveShadow, true);
    assert.equal(missingMesh.material.isMeshStandardMaterial, true);
    assert.equal(existingMesh.material, existingMaterial);
});

test('keeps selection misses as local geometry without requesting them', async () => {
    const selections = new Map([
        ['missing-template', { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' }],
        ['missing-resource', { errorCode: 'TEMPLATE_RESOURCE_MISSING' }],
        ['selected', selection('300', 'selected')],
    ]);
    const { loader, calls } = makeHarness({ selections, details: [] });

    const result = await loader.load([
        instance('missing-template', 0),
        instance('missing-resource', 1),
        instance('selected', 2),
    ], new THREE.Group());

    assert.deepEqual(calls.goods, [['300']]);
    assert.deepEqual(result.failures.map(failure => failure.errorCode), [
        'RESOURCE_DETAIL_MISSING',
    ]);
    assert.deepEqual(result.summary, {
        discovered: 3,
        localGeometry: 2,
        staticSelected: 0,
        parametricSelected: 0,
        placed: 0,
        fallbackVisible: 0,
        openingOnly: 0,
        failed: 1,
    });
});

test('requests goods details only for classified model-resource selections', async () => {
    const selections = new Map([
        ['static-type', selection('100', 'static-type')],
        ['parametric-type', selection('200', 'parametric-type')],
        ['no-template', { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' }],
        ['no-resource', { errorCode: 'TEMPLATE_RESOURCE_MISSING' }],
        ['1307', selection('must-not-request', '1307')],
    ]);
    const { loader, calls } = makeHarness({
        selections,
        details: [staticDetail('100'), parametricDetail('200')],
    });
    const from = (sourceList, typeId, id) => ({
        ...instance(typeId, id),
        instanceId: `${sourceList}:${id}`,
        sourceList,
        category: sourceList.slice(0, -'_list'.length),
    });

    const result = await loader.load([
        from('mixed_list', 'static-type', 0),
        from('mixed_list', 'parametric-type', 1),
        from('pillar_list', 'no-template', 0),
        from('window_list', 'no-resource', 0),
        from('door_list', '1307', 0),
    ], new THREE.Group());

    assert.deepEqual(calls.goods, [['100', '200']]);
    assert.equal(result.summary.localGeometry, 2);
    assert.equal(result.summary.openingOnly, 1);
    assert.deepEqual(result.failures, []);
});

test('reports exact terminal states and counts only real fallbacks for failures', async () => {
    const selections = new Map([
        ['local', { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' }],
        ['static', selection('100', 'static')],
        ['parametric', selection('200', 'parametric')],
        ['broken', selection('300', 'broken')],
        ['1307', selection('must-not-request', '1307')],
    ]);
    const placed = [];
    const { loader } = makeHarness({
        selections,
        details: [
            staticDetail('100'),
            parametricDetail('200'),
            parametricDetail('300', 'broken-hash', 'https://file.test/broken.json'),
        ],
        convertModel: async url => ({ obj: url.includes('broken') ? 'broken-obj' : validObj }),
        parseObj: content => {
            if (content === 'broken-obj') throw new Error('controlled parse failure');
            return prototype();
        },
    });

    const result = await loader.load([
        instance('local', 0),
        instance('1307', 1),
        instance('static', 2),
        instance('parametric', 3),
        instance('broken', 4),
    ], new THREE.Group(), {
        hasFallback: currentInstance => currentInstance.typeId === 'broken',
        onInstancePlaced: currentInstance => placed.push(currentInstance.typeId),
    });

    assert.deepEqual(result.summary, {
        discovered: 5,
        localGeometry: 1,
        staticSelected: 1,
        parametricSelected: 2,
        placed: 2,
        fallbackVisible: 1,
        openingOnly: 1,
        failed: 1,
    });
    assert.deepEqual(placed.sort(), ['parametric', 'static']);
    assert.deepEqual(result.failures, [{
        sourceList: 'soft_list',
        sourceIndex: 4,
        typeId: 'broken',
        resId: '300',
        resourceKind: 'parametric-obj',
        errorCode: 'MODEL_PARSE_FAILED',
    }]);
});

test('retains selected counts and selections when the single detail batch fails', async () => {
    const selections = new Map([
        ['first', selection('100', 'first')],
        ['second', selection('200', 'second')],
    ]);
    const { loader } = makeHarness({
        selections,
        getGoodsDetails: async () => {
            throw Object.assign(new Error('detail service unavailable'), { code: 'HTTP_ERROR' });
        },
    });

    const result = await loader.load([
        instance('first', 0), instance('second', 1),
    ], new THREE.Group());

    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.failed, 2);
    assert.equal(result.summary.placed, 0);
    assert.equal(result.selections.length, 2);
    assert.deepEqual(result.failures.map(failure => failure.errorCode), [
        'HTTP_ERROR', 'HTTP_ERROR',
    ]);
});

test('does not turn a placed model into a failure when the progress observer throws', async () => {
    const { loader } = makeHarness({
        selections: new Map([['chair', selection('100', 'chair')]]),
        details: [staticDetail('100')],
    });
    const scene = new THREE.Group();

    const result = await loader.load([instance('chair', 0)], scene, {
        onProgress() {
            throw new Error('observer failed');
        },
    });

    assert.equal(scene.children.length, 1);
    assert.equal(result.groups.length, 1);
    assert.equal(result.summary.staticSelected, 1);
    assert.equal(result.summary.placed, 1);
    assert.equal(result.summary.failed, 0);
    assert.deepEqual(result.failures, []);
});

test('inserts a placed model into its requested placement target', async () => {
    const { loader } = makeHarness({
        selections: new Map([['chair', selection('100', 'chair')]]),
        details: [staticDetail('100')],
    });
    const scene = new THREE.Group();
    const stage = new THREE.Group();

    const result = await loader.load([instance('chair', 0)], scene, {
        getPlacementTarget() { return stage; },
    });

    assert.equal(scene.children.length, 0);
    assert.equal(stage.children.length, 1);
    assert.equal(result.groups[0], stage.children[0]);
    assert.equal(result.summary.placed, 1);
});

test('reports invalid or throwing placement targets as placement failures', async () => {
    const targetFactories = [
        () => null,
        () => { throw new Error('controlled target failure'); },
    ];
    for (const getPlacementTarget of targetFactories) {
        const { loader } = makeHarness({
            selections: new Map([['chair', selection('100', 'chair')]]),
            details: [staticDetail('100')],
        });
        const scene = new THREE.Group();
        const result = await loader.load([instance('chair', 0)], scene, {
            getPlacementTarget,
        });

        assert.equal(scene.children.length, 0);
        assert.equal(result.groups.length, 0);
        assert.equal(result.summary.failed, 1);
        assert.equal(result.failures[0].errorCode, 'MODEL_SIZE_UNRESOLVED');
    }
});

test('counts generated composite children as one discovered CAD source identity', async () => {
    const { loader } = makeHarness({
        selections: new Map([['chair', selection('100', 'chair')]]),
        details: [staticDetail('100')],
    });
    const children = [0, 1].map(index => ({
        ...instance('chair', index),
        instanceId: `window_list:1#segment:${index}`,
        sourceList: 'window_list',
        sourceIndex: 1,
        parentInstanceId: 'window_list:1',
        compositeSegmentIndex: index,
        compositeSegmentCount: 2,
    }));

    const result = await loader.load(children, new THREE.Group());

    assert.equal(result.summary.discovered, 1);
    assert.equal(result.summary.placed, 2);
});

test('can defer loader logs until scene orchestration has finalized composite state', async () => {
    const logs = [];
    const warnings = [];
    const { loader } = makeHarness({
        selections: new Map([['chair', selection('100', 'chair')]]),
        details: [staticDetail('100')],
        logger: {
            log(...args) { logs.push(args); },
            warn(...args) { warnings.push(args); },
        },
    });

    const result = await loader.load([instance('chair', 0)], new THREE.Group(), {
        logSummary: false,
    });

    assert.equal(result.summary.placed, 1);
    assert.deepEqual(logs, []);
    assert.deepEqual(warnings, []);
});

test('isolates synchronous and asynchronous onInstancePlaced observer failures', async () => {
    const observers = [
        () => { throw new Error('synchronous observer failed'); },
        async () => { throw new Error('asynchronous observer failed'); },
    ];

    for (const onInstancePlaced of observers) {
        const { loader } = makeHarness({
            selections: new Map([['chair', selection('100', 'chair')]]),
            details: [staticDetail('100')],
        });
        const scene = new THREE.Group();
        const result = await loader.load([instance('chair', 0)], scene, { onInstancePlaced });

        assert.equal(scene.children.length, 1);
        assert.equal(result.groups.length, 1);
        assert.equal(result.summary.staticSelected, 1);
        assert.equal(result.summary.placed, 1);
        assert.equal(result.summary.failed, 0);
        assert.deepEqual(result.failures, []);
    }
});

test('removes signed resource URLs from successful static and parametric object metadata', async () => {
    const staticUrl = 'https://file.test/static.kb?signature=static-sentinel-secret';
    const parametricUrl = 'https://file.test/param.json?signature=param-sentinel-secret';
    const selections = new Map([
        ['static-private', selection('901', 'static-private')],
        ['parametric-private', selection('902', 'parametric-private')],
    ]);
    const makeSensitivePrototype = (url, field) => {
        const root = prototype();
        root.name = url;
        root.userData = {
            [field]: url,
            nested: { download: url },
            safeLabel: 'retained',
        };
        root.children[0].name = `mesh ${url}`;
        root.children[0].userData = { assetUrl: url };
        return root;
    };
    const loader = new ContentModelLoader({
        templateResolver: {
            async load() {},
            select(currentInstance) { return selections.get(currentInstance.typeId); },
        },
        apiClient: {
            async getGoodsDetails() {
                return { items: [
                    staticDetail('901', 'static-hash', staticUrl),
                    parametricDetail('902', 'parametric-hash', parametricUrl),
                ] };
            },
            async convertModel() { return { obj: validObj }; },
        },
        async loadGltf() {
            return makeSensitivePrototype(staticUrl, 'webV2Url');
        },
        parseObj() {
            return makeSensitivePrototype(parametricUrl, 'parameterizedJsonUrl');
        },
        logger: { log() {}, warn() {} },
    });

    const result = await loader.load([
        instance('static-private', 0),
        instance('parametric-private', 1, [{ name: 'width', value: 800 }]),
    ], new THREE.Group());

    assert.equal(result.groups.length, 2);
    for (const root of result.groups) {
        const metadata = [];
        root.traverse(child => metadata.push({ name: child.name, userData: child.userData }));
        const serialized = JSON.stringify(metadata);
        assert.doesNotMatch(serialized, /https:\/\//);
        assert.doesNotMatch(serialized, /static-sentinel-secret|param-sentinel-secret/);
        assert.doesNotMatch(serialized, /sourceUrl|webV2Url|parameterizedJsonUrl/);
        assert.match(serialized, /retained/);
    }
});

test('emits exactly one safe summary and one grouped error count with allowlisted failure fields', async () => {
    const logs = [];
    const warnings = [];
    const sourceUrl = 'https://file.test/private.kb?signature=sentinel-secret';
    const { loader } = makeHarness({
        selections: new Map([['door', selection('900', 'door')]]),
        details: [staticDetail('900', 'hash', sourceUrl)],
        loadGltf: async () => {
            throw Object.assign(new Error(`boom sourceUrl=${sourceUrl}`), { code: 'NOT_ALLOWLISTED' });
        },
        logger: {
            log(...args) { logs.push(args); },
            warn(...args) { warnings.push(args); },
        },
    });
    const door = {
        ...instance('door', 0),
        sourceList: 'door_list',
        category: 'door',
    };

    const result = await loader.load([door], new THREE.Group(), {
        hasFallback: () => true,
    });

    assert.equal(logs.length, 1);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], { STATIC_MODEL_LOAD_FAILED: 1 });
    assert.deepEqual(Object.keys(result.failures[0]).sort(), [
        'errorCode', 'resId', 'resourceKind', 'sourceIndex', 'sourceList', 'typeId',
    ]);
    assert.equal(result.summary.fallbackVisible, 1);
    assert.match(logs[0][0], /^\[ContentLoader\] discovered=1 /);
    assert.match(logs[0][0], /staticSelected=1 parametricSelected=0 placed=0/);
    const serialized = JSON.stringify({ logs, warnings, result });
    assert.doesNotMatch(serialized, /sourceUrl|sentinel-secret|https:\/\//);
});

test('static cache keys include only resource identity and content hash', () => {
    assert.equal(staticCacheKey({
        resId: '44', contentHash: 'abc', sourceUrl: 'https://secret.test/file.kb',
    }), 'static:44:abc');
    assert.equal(staticCacheKey({ resId: '44' }), 'static:44:unversioned');
});
