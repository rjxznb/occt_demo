import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ParametricApiClient,
    indexGoodsDetails,
    normalizeGoodsItems,
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

test('Demo batch transport reuses the existing per-ID Node endpoint', async () => {
    const urls = [];
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async url => {
            urls.push(url);
            return { ok: true, status: 200, json: async () => ({ data: { id: url.split('=').at(-1) } }) };
        },
    });
    const result = await client.getGoodsDetails(['7', '8']);
    assert.equal(urls.length, 2);
    assert.deepEqual(result.items.map(item => item.id), ['7', '8']);
});

test('Demo goods transport caps per-ID requests at concurrency three', async () => {
    let active = 0;
    let maximum = 0;
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async url => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return {
                ok: true,
                status: 200,
                json: async () => ({ data: { id: url.split('=').at(-1) } }),
            };
        },
    });

    const result = await client.getGoodsDetails(['1', '2', '3', '4', '5', '6', '7']);

    assert.equal(maximum, 3);
    assert.deepEqual(result.items.map(item => item.id), ['1', '2', '3', '4', '5', '6', '7']);
});

test('one failed Demo goods request does not discard successful details', async () => {
    const client = new ParametricApiClient({
        hostClient: null,
        fetchImpl: async url => {
            const id = url.split('=').at(-1);
            return id === '8'
                ? { ok: false, status: 503 }
                : { ok: true, status: 200, json: async () => ({ data: { id } }) };
        },
    });

    const result = await client.getGoodsDetails(['7', '8', '9']);

    assert.deepEqual(result.items.map(item => item.id), ['7', '9']);
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
