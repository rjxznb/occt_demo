import assert from 'node:assert/strict';
import test from 'node:test';

import { AiGenerationClient, AiGenerationClientError } from '../src/ai-concept/AiGenerationClient.js';

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return structuredClone(body); },
    };
}

test('AI generation client uses only fixed same-origin routes and forwards abort signals', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push([url, options]);
        if (url === '/api/ai-concept/catalog') return response(200, { configured: true, styles: [], environments: [] });
        if (url === '/api/ai-concept/jobs') return response(202, { id: 'job-1', status: 'queued', items: [] });
        if (url === '/api/ai-concept/jobs/job-1') return response(200, { id: 'job-1', status: 'running', items: [] });
        if (url === '/api/ai-concept/jobs/job-1/retry') return response(202, { accepted: true });
        if (url === '/api/ai-concept/jobs/job-1/cancel') return response(200, { id: 'job-1', status: 'cancelled', items: [] });
        return response(404, { code: 'NOT_FOUND' });
    };
    const signal = new AbortController().signal;
    const client = new AiGenerationClient({ fetchImpl });

    assert.equal((await client.getCatalog({ signal })).configured, true);
    assert.equal((await client.createJob({ requestId: 'request-1' }, { signal })).id, 'job-1');
    assert.equal((await client.getJob('job-1', { signal })).status, 'running');
    assert.equal((await client.retryItem('job-1', 'item-1', { signal })).accepted, true);
    assert.equal((await client.cancelJob('job-1', { signal })).status, 'cancelled');

    assert.deepEqual(calls.map(([url]) => url), [
        '/api/ai-concept/catalog',
        '/api/ai-concept/jobs',
        '/api/ai-concept/jobs/job-1',
        '/api/ai-concept/jobs/job-1/retry',
        '/api/ai-concept/jobs/job-1/cancel',
    ]);
    assert.ok(calls.every(([, options]) => options.signal === signal));
    assert.deepEqual(JSON.parse(calls[1][1].body), { requestId: 'request-1' });
    assert.deepEqual(JSON.parse(calls[3][1].body), { itemId: 'item-1' });
});

test('AI generation client exposes only safe structured server errors and never retries', async () => {
    let attempts = 0;
    const client = new AiGenerationClient({
        fetchImpl: async () => {
            attempts += 1;
            return response(503, { code: 'OPENAI_NOT_CONFIGURED', detail: 'secret upstream body' });
        },
    });

    await assert.rejects(
        () => client.createJob({ requestId: 'request-1' }),
        error => error instanceof AiGenerationClientError
            && error.code === 'OPENAI_NOT_CONFIGURED'
            && error.status === 503
            && !error.message.includes('secret upstream body'),
    );
    assert.equal(attempts, 1);
});

test('AI generation client rejects unsafe identifiers before fetch', async () => {
    let called = false;
    const client = new AiGenerationClient({ fetchImpl: async () => { called = true; } });
    await assert.rejects(() => client.getJob('../secret'), { code: 'INVALID_JOB_ID' });
    await assert.rejects(() => client.retryItem('job-1', ''), { code: 'INVALID_ITEM_ID' });
    assert.equal(called, false);
});
