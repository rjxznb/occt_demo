import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ParametricApiClient,
    indexGoodsDetails,
    indexMaterialDetails,
    normalizeGoodsItems,
    normalizeMaterialItems,
} from '../src/services/ParametricApiClient.js';

test('top-level mode uses the Node goods endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ data: { id: 7 } }) };
    };
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl,
        backendUrl: 'http://localhost:3100',
    });
    assert.deepEqual(await client.getGoodsDetail('7'), { data: { id: 7 } });
    assert.equal(calls[0].url, 'http://localhost:3100/api/getGoodsDetail?id=7');
});

test('embedded mode uses the host and never calls fetch', async () => {
    const hostCalls = [];
    const hostClient = {
        isAvailable: () => true,
        invoke: async (method, payload, options) => {
            hostCalls.push({ method, payload, options });
            return { data: { id: 8 } };
        },
    };
    const client = new ParametricApiClient({
        hostClient,
        fetchImpl: async () => { throw new Error('fetch must not run'); },
    });
    assert.deepEqual(await client.getGoodsDetail('8'), { data: { id: 8 } });
    assert.equal(hostCalls[0].method, 'getParametricGoodsDetail');
    assert.deepEqual(hostCalls[0].payload, { resId: '8' });
});

test('CAD failure is returned without falling back to Node', async () => {
    let fetchCount = 0;
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => { throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }); },
        },
        fetchImpl: async () => { fetchCount += 1; },
    });
    await assert.rejects(client.getGoodsDetail('9'), { code: 'NETWORK_ERROR' });
    assert.equal(fetchCount, 0);
});

test('zstd-base64 envelope is decoded before JSON parsing', async () => {
    const expected = { obj: 'v 0 0 0\n'.repeat(20) };
    const encoded = Buffer.from([1, 2, 3, 4]).toString('base64');
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => ({ encoding: 'zstd-base64', body: encoded }),
        },
        decompressImpl: bytes => {
            assert.deepEqual([...bytes], [1, 2, 3, 4]);
            return new TextEncoder().encode(JSON.stringify(expected));
        },
    });
    assert.deepEqual(await client.convertModel('https://model.test/a.json'), expected);
});

test('non-2xx Node response becomes HTTP_ERROR with status', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(
        client.getGoodsDetail('10'),
        error => error.code === 'HTTP_ERROR' && error.status === 503,
    );
});

test('malformed Node JSON becomes INVALID_RESPONSE', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError('Unexpected token'); },
        }),
    });
    await assert.rejects(
        client.getGoodsDetail('10'),
        error => error.code === 'INVALID_RESPONSE',
    );
});

test('malformed Node POST JSON becomes INVALID_RESPONSE', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError('Unexpected token'); },
        }),
    });
    await assert.rejects(
        client.convertModel('https://model.test/a.json'),
        error => error.code === 'INVALID_RESPONSE',
    );
});

test('malformed host JSON becomes INVALID_RESPONSE', async () => {
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => '{broken-json',
        },
    });
    await assert.rejects(
        client.getGoodsDetail('10'),
        error => error.code === 'INVALID_RESPONSE',
    );
});

test('decoder failure becomes DECOMPRESSION_ERROR', async () => {
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async () => ({
                encoding: 'zstd-base64',
                body: Buffer.from([1, 2, 3]).toString('base64'),
            }),
        },
        decompressImpl: () => { throw new Error('invalid frame'); },
    });
    await assert.rejects(
        client.convertModel('https://model.test/a.json'),
        error => error.code === 'DECOMPRESSION_ERROR',
    );
});

test('CAD goods detail calls are deduplicated and split into batches of 50', async () => {
    const calls = [];
    const hostClient = {
        isAvailable: () => true,
        invoke: async (method, payload) => {
            calls.push({ method, payload });
            return { code: 2000, data: payload.resIds.map(id => ({ id })) };
        },
    };
    const client = new ParametricApiClient({ hostClient });
    const ids = [...Array.from({ length: 51 }, (_, i) => String(i + 1)), '1'];
    const result = await client.getGoodsDetails(ids);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'getContentGoodsDetails');
    assert.equal(calls[0].payload.resIds.length, 50);
    assert.deepEqual(result.items.map(item => String(item.id)),
        Array.from({ length: 51 }, (_, i) => String(i + 1)));
});

test('standalone goods details are deduplicated and POSTed in batches of 50', async () => {
    const calls = [];
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            const ids = JSON.parse(init.body).resIds;
            return { ok: true, status: 200, json: async () => ({ code: 2000, data: ids.map(id => ({ id })) }) };
        },
    });
    const ids = [...Array.from({ length: 51 }, (_, index) => String(index + 1)), '1'];
    const result = await client.getGoodsDetails(ids);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'http://localhost:3100/api/getContentGoodsDetails');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body).resIds, ids.slice(0, 50));
    assert.deepEqual(JSON.parse(calls[1].init.body).resIds, ['51']);
    assert.deepEqual(result.items.map(item => String(item.id)), ids.slice(0, 51));
});

test('standalone goods transport caps batch requests at concurrency three', async () => {
    let active = 0;
    let maximum = 0;
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async (url, init) => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            const ids = JSON.parse(init.body).resIds;
            return {
                ok: true,
                status: 200,
                json: async () => ({ code: 2000, data: ids.map(id => ({ id })) }),
            };
        },
    });
    const ids = Array.from({ length: 151 }, (_, index) => String(index + 1));

    const result = await client.getGoodsDetails(ids);

    assert.equal(maximum, 3);
    assert.deepEqual(result.items.map(item => String(item.id)), ids);
});

test('one failed standalone batch does not discard successful details', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async (url, init) => {
            const ids = JSON.parse(init.body).resIds;
            return ids.includes('51')
                ? { ok: false, status: 503 }
                : { ok: true, status: 200, json: async () => ({ code: 2000, data: ids.map(id => ({ id })) }) };
        },
    });
    const ids = Array.from({ length: 51 }, (_, index) => String(index + 1));

    const result = await client.getGoodsDetails(ids);

    assert.deepEqual(result.items.map(item => String(item.id)), ids.slice(0, 50));
});

test('all failed standalone batches surface the first transport error', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async () => ({ ok: false, status: 503 }),
    });

    await assert.rejects(
        client.getGoodsDetails(['7', '8']),
        error => error.code === 'HTTP_ERROR' && error.status === 503,
    );
});

test('goods item normalization accepts supported batch and single payload shapes', () => {
    assert.deepEqual(normalizeGoodsItems({ code: 1, data: { list: [{ id: 1 }] } }), [{ id: 1 }]);
    assert.deepEqual(normalizeGoodsItems({ code: 2000, data: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(normalizeGoodsItems({ data: { modelDTO: { id: 3 } } }), [{ id: 3 }]);
    assert.deepEqual(normalizeGoodsItems({ items: [{ id: 4 }] }), [{ id: 4 }]);
});

test('goods item normalization rejects unsupported business codes without raw response data', () => {
    assert.throws(
        () => normalizeGoodsItems({ code: 500, data: { url: 'https://file.test/a?signature=secret' } }),
        error => error.code === 'INVALID_RESPONSE' && error.businessCode === 500
            && !Object.values(error).includes('https://file.test/a?signature=secret'),
    );
});

test('goods item normalization rejects coercible non-numeric business codes', () => {
    for (const code of [true, false, [], [1], {}, '', ' ', ' 1 ', '02000']) {
        assert.throws(
            () => normalizeGoodsItems({ code, data: [] }),
            error => error.code === 'INVALID_RESPONSE',
            `code ${JSON.stringify(code)} must be rejected`,
        );
    }
    assert.deepEqual(normalizeGoodsItems({ code: '1', data: [] }), []);
    assert.deepEqual(normalizeGoodsItems({ code: '2000', data: [] }), []);
});

test('goods detail index finds IDs at the top level and inside modelDTO', () => {
    const result = indexGoodsDetails({ items: [{ id: 1 }, { modelDTO: { resGoodsId: 2 } }] });
    assert.equal(result.get('1').id, 1);
    assert.equal(result.get('2').modelDTO.resGoodsId, 2);
});

test('goods detail index retains every available ID alias', () => {
    const detail = { id: 1, resGoodsId: 2, data: { modelDTO: { id: 3, resGoodsId: 4 } } };
    const result = indexGoodsDetails({ items: [detail] });
    assert.equal(result.get('1'), detail);
    assert.equal(result.get('2'), detail);
    assert.equal(result.get('3'), detail);
    assert.equal(result.get('4'), detail);
});

test('standalone material details validate, deduplicate and batch PT codes', async () => {
    const calls = [];
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            const codes = JSON.parse(init.body).materialCodes;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    code: 2000,
                    data: codes.map(code => ({ code, name: `material-${code}` })),
                }),
            };
        },
    });
    const codes = [
        ...Array.from({ length: 51 }, (_, index) => `PT${index + 1}`),
        'PT1',
        'MX2',
        '',
    ];

    const result = await client.getMaterialDetails(codes);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'http://localhost:3100/api/getContentMaterialDetails');
    assert.deepEqual(JSON.parse(calls[0].init.body).materialCodes,
        Array.from({ length: 50 }, (_, index) => `PT${index + 1}`));
    assert.deepEqual(JSON.parse(calls[1].init.body).materialCodes, ['PT51']);
    assert.deepEqual(result.items.map(item => item.code),
        Array.from({ length: 51 }, (_, index) => `PT${index + 1}`));
});

test('CAD material details use the host bridge and preserve successful partial batches', async () => {
    const calls = [];
    const hostClient = {
        isAvailable: () => true,
        invoke: async (method, payload) => {
            calls.push({ method, payload });
            if (payload.materialCodes.includes('PT51')) {
                throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
            }
            return JSON.stringify({
                code: 2000,
                data: payload.materialCodes.map(code => ({ code })),
            });
        },
    };
    const client = new ParametricApiClient({ hostClient });
    const codes = Array.from({ length: 51 }, (_, index) => `PT${index + 1}`);

    const result = await client.getMaterialDetails(codes);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'getContentMaterialDetails');
    assert.deepEqual(calls[0].payload.materialCodes, codes.slice(0, 50));
    assert.deepEqual(result.items.map(item => item.code), codes.slice(0, 50));
});

test('material item normalization and indexing accept the upstream response', () => {
    const detail = { code: 'PT527545889554403328', name: 'glass' };
    assert.deepEqual(normalizeMaterialItems({ code: 2000, data: [detail] }), [detail]);
    assert.equal(indexMaterialDetails({ items: [detail] }).get(detail.code), detail);
});

test('standalone Web package preparation posts ResId and resolves the local asset path', async () => {
    const calls = [];
    const client = new ParametricApiClient({
        hostClient: null,
        backendUrl: 'http://localhost:3100/',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    code: 2000,
                    data: {
                        resId: '1961113',
                        resourceKey: '1961113-deadbeefdeadbeefdeadbeefdeadbeef',
                        gltfPath: '/api/web-model-assets/key/model.gltf',
                        contentHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
                        cacheHit: false,
                    },
                }),
            };
        },
    });

    assert.deepEqual(await client.prepareWebModelPackage('1961113'), {
        resId: '1961113',
        resourceKey: '1961113-deadbeefdeadbeefdeadbeefdeadbeef',
        gltfUrl: 'http://localhost:3100/api/web-model-assets/key/model.gltf',
        contentHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
        cacheHit: false,
    });
    assert.equal(calls[0].url, 'http://localhost:3100/api/prepareWebModelPackage');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { resId: '1961113' });
});

test('CAD Web package preparation uses the host bridge absolute asset URL', async () => {
    const calls = [];
    const client = new ParametricApiClient({
        hostClient: {
            isAvailable: () => true,
            invoke: async (method, payload, options) => {
                calls.push({ method, payload, options });
                return JSON.stringify({
                    code: 2000,
                    data: {
                        resId: '1961113',
                        resourceKey: 'key',
                        gltfUrl: 'ke-resource://web-model-assets/key/model.gltf',
                        contentHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
                        cacheHit: true,
                    },
                });
            },
        },
    });

    const result = await client.prepareWebModelPackage('1961113');
    assert.equal(result.gltfUrl, 'ke-resource://web-model-assets/key/model.gltf');
    assert.deepEqual(calls, [{
        method: 'prepareWebModelPackage',
        payload: { resId: '1961113' },
        options: { timeoutMs: 130_000 },
    }]);
});

test('Web package preparation rejects invalid requests and responses', async () => {
    const invalidClient = new ParametricApiClient({ hostClient: null });
    for (const resId of ['', 'not-decimal', '1'.repeat(129)]) {
        await assert.rejects(
            invalidClient.prepareWebModelPackage(resId),
            error => error.code === 'INVALID_ARGUMENT',
        );
    }

    for (const body of [
        { code: 5000, data: {} },
        { code: 2000, data: {} },
        { code: 2000, data: { resId: '1961113', resourceKey: 'key', gltfPath: 'relative.gltf' } },
    ]) {
        const client = new ParametricApiClient({
            hostClient: null,
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => body }),
        });
        await assert.rejects(
            client.prepareWebModelPackage('1961113'),
            error => error.code === 'INVALID_RESPONSE',
        );
    }
});
