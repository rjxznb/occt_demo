import test from 'node:test';
import assert from 'node:assert/strict';
import { ParametricApiClient } from '../src/services/ParametricApiClient.js';

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
