import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAiConceptApiHandler } from '../server/ai-concept/AiConceptApiHandler.mjs';
import { AiGenerationRepository } from '../server/ai-concept/AiGenerationRepository.mjs';

const dataUrl = `data:image/webp;base64,${Buffer.from('white-model').toString('base64')}`;

function validRequest(overrides = {}) {
    return {
        requestId: 'request-api-1', planId: 'plan-api', planVersion: 'v1', whiteModelVersion: 'white-v1',
        styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'],
        views: [{
            id: 'view-1', roomId: 'room-1', roomName: '客厅', name: '入口视角',
            x: 100, y: 200, z: 1500, yaw: 0, pitch: 0, fov: 80, dataUrl,
        }],
        ...overrides,
    };
}

async function withApi({ apiConfigured = true, bodyLimitBytes, queueFactory } = {}, run) {
    const rootDir = await mkdtemp(join(tmpdir(), 'occt-ai-api-'));
    const repository = new AiGenerationRepository({ rootDir });
    const calls = { enqueue: [], retry: [], cancel: [] };
    const queue = queueFactory?.({ repository, calls }) ?? {
        enqueue(jobId) { calls.enqueue.push(jobId); return Promise.resolve(); },
        async retry(jobId, itemId) { calls.retry.push([jobId, itemId]); return repository.loadJob(jobId); },
        async cancel(jobId) { calls.cancel.push(jobId); return repository.loadJob(jobId); },
    };
    const handler = createAiConceptApiHandler({
        repository, queue, apiConfigured, bodyLimitBytes,
        idFactory: prefix => `${prefix}-fixed`,
        now: () => '2026-08-14T02:00:00.000Z',
    });
    const server = createServer(async (req, res) => {
        try {
            const handled = await handler(req, res);
            if (!handled && !res.writableEnded) {
                res.writeHead(418).end('outside');
            }
        } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ code: 'TEST_SERVER_ERROR', message: error?.message }));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        await run({ baseUrl: `http://127.0.0.1:${port}`, repository, queue, calls, rootDir });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
    }
}

test('catalog returns public entries, maximum, and configured state without server prompts', async () => {
    await withApi({}, async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/ai-concept/catalog`);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(body.configured, true);
        assert.equal(body.maxImages, 24);
        assert.equal(body.styles.length, 12);
        assert.equal(body.environments.length, 4);
        assert.ok(body.styles.every(item => !Object.hasOwn(item, 'prompt')));
        assert.ok(body.environments.every(item => !Object.hasOwn(item, 'prompt')));
    });
});

test('create returns 503 before persistence when OpenAI is not configured', async () => {
    await withApi({ apiConfigured: false }, async ({ baseUrl, repository }) => {
        const response = await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest()),
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, 'OPENAI_NOT_CONFIGURED');
        assert.equal(await repository.findJobByRequestId('request-api-1'), null);
    });
});

test('valid create persists controlled inputs, queues work, and deduplicates requestId', async () => {
    await withApi({}, async ({ baseUrl, repository, calls }) => {
        const first = await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest()),
        });
        const created = await first.json();
        assert.equal(first.status, 202);
        assert.equal(created.id, 'job-fixed');
        assert.equal(created.items.length, 1);
        assert.equal(Object.hasOwn(created.items[0].input, 'bytes'), false);
        assert.equal((await repository.readAsset(created.id, created.items[0].input.assetId)).bytes.toString(), 'white-model');
        assert.deepEqual(calls.enqueue, ['job-fixed']);

        const duplicate = await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest()),
        });
        assert.equal(duplicate.status, 200);
        assert.equal((await duplicate.json()).id, created.id);
        assert.deepEqual(calls.enqueue, ['job-fixed']);
    });
});

test('get, retry, cancel, and controlled asset routes expose only safe task data', async () => {
    await withApi({}, async ({ baseUrl, repository, calls }) => {
        const created = await (await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest()),
        })).json();
        const itemId = created.items[0].id;
        const output = await repository.writeOutput(created.id, `output-${itemId}`, Buffer.from('png-result'));
        const job = await repository.loadJob(created.id);
        job.items[0].status = 'failed';
        job.items[0].error = { code: 'RATE_LIMITED', retryable: true };
        await repository.saveJob(job);

        const getResponse = await fetch(`${baseUrl}/api/ai-concept/jobs/${created.id}`);
        assert.equal(getResponse.status, 200);
        assert.equal((await getResponse.json()).id, created.id);

        const retryResponse = await fetch(`${baseUrl}/api/ai-concept/jobs/${created.id}/retry`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId }),
        });
        assert.equal(retryResponse.status, 202);
        assert.deepEqual(calls.retry, [[created.id, itemId]]);

        const cancelResponse = await fetch(`${baseUrl}/api/ai-concept/jobs/${created.id}/cancel`, { method: 'POST' });
        assert.equal(cancelResponse.status, 200);
        assert.deepEqual(calls.cancel, [created.id]);

        const assetResponse = await fetch(`${baseUrl}${output.url}`);
        assert.equal(assetResponse.status, 200);
        assert.equal(assetResponse.headers.get('content-type'), 'image/png');
        assert.equal(Buffer.from(await assetResponse.arrayBuffer()).toString(), 'png-result');
    });
});

test('API returns fixed 404, malformed 400, oversized 413, and sanitized errors', async () => {
    await withApi({ bodyLimitBytes: 300 }, async ({ baseUrl, rootDir }) => {
        const missing = await fetch(`${baseUrl}/api/ai-concept/not-a-route`);
        assert.equal(missing.status, 404);
        assert.equal((await missing.json()).code, 'NOT_FOUND');

        const malformed = await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad',
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).code, 'MALFORMED_JSON');

        const oversized = await fetch(`${baseUrl}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(400) }),
        });
        assert.equal(oversized.status, 413);
        const text = await oversized.text();
        assert.match(text, /BODY_TOO_LARGE/);
        assert.doesNotMatch(text, /sk-|private upstream|AppData|occt-ai-api/);
        assert.equal(text.includes(rootDir), false);
    });
});
