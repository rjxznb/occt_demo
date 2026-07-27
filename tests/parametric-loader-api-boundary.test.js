import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import { loadParametricModels } from '../src/components/ParametricModelLoader.js';

const templateResponse = {
    AllItemInfo: [
        { TypeId: '1001', TypeName: 'Client seam', ResList: [{ ResId: 'res-1001', X: 1, Y: 1, Z: 1 }] },
        { TypeId: '1002', TypeName: 'Fails conversion', ResList: [{ ResId: 'res-1002', X: 1, Y: 1, Z: 1 }] },
        { TypeId: '1003', TypeName: 'Continues conversion', ResList: [{ ResId: 'res-1003', X: 1, Y: 1, Z: 1 }] },
        { TypeId: '1004', TypeName: 'Fails URL lookup', ResList: [{ ResId: 'res-1004', X: 1, Y: 1, Z: 1 }] },
    ],
};

const validObj = [
    'o parametric-model',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'v 0 0 1',
    'v 1 1 0',
    'v 1 0 1',
    'v 0 1 1',
    'f 1 2 3',
    'f 1 4 2',
    'f 1 3 4',
    'f 2 4 3',
    '# parameterized model fixture',
].join('\n');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    assert.equal(url, '/data/template.json');
    return { ok: true, json: async () => templateResponse };
};

test.after(() => {
    globalThis.fetch = originalFetch;
});

test('ParametricModelLoader keeps local template loading separate from parameter-service transport', async () => {
    const source = await readFile(
        new URL('../src/components/ParametricModelLoader.js', import.meta.url),
        'utf8',
    );
    assert.match(source, /parametricApiClient/);
    assert.match(source, /apiClient\.getGoodsDetail/);
    assert.match(source, /apiClient\.convertModel/);
    assert.match(source, /globalThis\.fetch\(templatePath\)/);
    assert.doesNotMatch(source, /localhost:3100/);
    assert.doesNotMatch(source, /\/api\/(?:getGoodsDetail|modelUrlToObj)/);
    assert.doesNotMatch(source, /(?:globalThis\.)?fetch\s*\([^)]*(?:getGoodsDetail|modelUrlToObj)/);
    assert.doesNotMatch(source, /(?:fetchGoodsDetail|fetchModelObj)/);
});

test('loadParametricModels uses the injected client for URL resolution and conversion', async () => {
    const goodsCalls = [];
    const conversionCalls = [];
    const apiClient = {
        async getGoodsDetail(resId) {
            goodsCalls.push(resId);
            return { data: { modelDTO: { parameterizedJsonUrl: 'https://models.test/1001.json' } } };
        },
        async convertModel(url, parameters) {
            conversionCalls.push({ url, parameters });
            return { obj: validObj };
        },
    };

    const groups = await loadParametricModels([
        softlist('1001', 'client-seam', [{ name: 'width', value: 300 }]),
    ], new THREE.Group(), { apiClient });

    assert.equal(groups.length, 1);
    assert.deepEqual(goodsCalls, ['res-1001']);
    assert.deepEqual(conversionCalls, [{
        url: 'https://models.test/1001.json',
        parameters: [{ name: 'width', value: 300 }],
    }]);
});

test('a failed model conversion does not prevent subsequent injected-client work', async () => {
    const conversionCalls = [];
    const apiClient = {
        async getGoodsDetail(resId) {
            return { data: { modelDTO: { parameterizedJsonUrl: `https://models.test/${resId}.json` } } };
        },
        async convertModel(url) {
            conversionCalls.push(url);
            if (url.endsWith('res-1002.json')) {
                throw Object.assign(new Error('conversion unavailable'), { code: 'HTTP_ERROR', status: 502 });
            }
            return { obj: validObj };
        },
    };

    const groups = await loadParametricModels([
        softlist('1002', 'bad-model'),
        softlist('1003', 'good-model'),
    ], new THREE.Group(), { apiClient });

    assert.equal(groups.length, 1);
    assert.deepEqual(conversionCalls, [
        'https://models.test/res-1002.json',
        'https://models.test/res-1003.json',
    ]);
});

test('URL resolution failures log type, resource, and structured client error details', async () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        await loadParametricModels([
            softlist('1004', 'lookup-failure'),
        ], new THREE.Group(), {
            apiClient: {
                async getGoodsDetail() {
                    throw Object.assign(new Error('goods lookup unavailable'), {
                        code: 'UPSTREAM_UNAVAILABLE',
                        status: 503,
                    });
                },
                async convertModel() {
                    throw new Error('convertModel must not run when URL resolution fails');
                },
            },
        });
    } finally {
        console.warn = originalWarn;
    }

    const failure = warnings.find(([message]) => message.includes('TypeId=1004'));
    assert.ok(failure);
    assert.match(failure[0], /ResId=res-1004/);
    assert.deepEqual(failure[1], {
        code: 'UPSTREAM_UNAVAILABLE',
        status: 503,
        message: 'goods lookup unavailable',
    });
});

function softlist(typeId, id, modelParams = []) {
    return {
        id,
        kind: 'softlist',
        typeId,
        basepoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ],
        modelParams,
    };
}
