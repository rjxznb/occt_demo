import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

function placeClone(model, currentInstance) {
    const root = model.clone(true);
    root.name = `placed-${currentInstance.instanceId}`;
    root.userData = { instanceId: currentInstance.instanceId };
    return root;
}

function makeHarness({
    selections, details, loadGltf, parseObj, convertModel, getGoodsDetails, logger,
} = {}) {
    const calls = { sequence: [], goods: [], gltf: [], convert: [], place: [] };
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
        logger: logger ?? { log() {}, warn() {} },
    });
    return { loader, calls };
}

test('loads the template first, batches unique details, and dispatches type 1 and type 8 resources', async () => {
    const selections = new Map([
        ['static', selection('100', 'static')],
        ['parametric', selection('200', 'parametric')],
    ]);
    const { loader, calls } = makeHarness({
        selections,
        details: [
            staticDetail('100', 'static-hash', 'https://file.test/static.kb'),
            parametricDetail('200', 'param-hash', 'https://file.test/param.json'),
        ],
    });

    const result = await loader.load([
        instance('static', 0),
        instance('parametric', 1, [{ name: '宽度', value: 800 }]),
    ], new THREE.Group());

    assert.deepEqual(calls.sequence, [
        'template-load', 'select:soft_list:0', 'select:soft_list:1', 'goods-details',
    ]);
    assert.deepEqual(calls.goods, [['100', '200']]);
    assert.deepEqual(calls.gltf, ['https://file.test/static.kb']);
    assert.deepEqual(calls.convert, [{
        url: 'https://file.test/param.json', parameters: [{ name: '宽度', value: 800 }],
    }]);
    assert.deepEqual(result.summary, {
        instances: 2,
        selected: 2,
        detailsResolved: 2,
        staticLoaded: 1,
        parametricLoaded: 1,
        fallbackVisible: 0,
        skipped: 0,
        failed: 0,
    });
    assert.equal(result.groups.length, 2);
    assert.equal(result.selections.length, 2);
    assert.deepEqual(result.failures, []);
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
    assert.equal(result.summary.parametricLoaded, 1);
    assert.equal(result.summary.staticLoaded, 0);
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

test('aggregates selection and detail errors without requesting invalid selections', async () => {
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
        'TEMPLATE_TYPE_NOT_FOUND', 'TEMPLATE_RESOURCE_MISSING', 'RESOURCE_DETAIL_MISSING',
    ]);
    assert.deepEqual(result.summary, {
        instances: 3,
        selected: 1,
        detailsResolved: 0,
        staticLoaded: 0,
        parametricLoaded: 0,
        fallbackVisible: 0,
        skipped: 3,
        failed: 0,
    });
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

    assert.equal(result.summary.selected, 2);
    assert.equal(result.summary.skipped, 2);
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
    assert.equal(result.summary.staticLoaded, 1);
    assert.equal(result.summary.failed, 0);
    assert.deepEqual(result.failures, []);
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
        assert.equal(result.summary.staticLoaded, 1);
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

    const result = await loader.load([door], new THREE.Group());

    assert.equal(logs.length, 1);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], { STATIC_MODEL_LOAD_FAILED: 1 });
    assert.deepEqual(Object.keys(result.failures[0]).sort(), [
        'errorCode', 'instanceId', 'message', 'resId', 'sourceIndex', 'sourceList', 'typeId',
    ]);
    assert.equal(result.summary.fallbackVisible, 1);
    const serialized = JSON.stringify({ logs, warnings, result });
    assert.doesNotMatch(serialized, /sourceUrl|sentinel-secret|https:\/\//);
});

test('static cache keys include only resource identity and content hash', () => {
    assert.equal(staticCacheKey({
        resId: '44', contentHash: 'abc', sourceUrl: 'https://secret.test/file.kb',
    }), 'static:44:abc');
    assert.equal(staticCacheKey({ resId: '44' }), 'static:44:unversioned');
});
