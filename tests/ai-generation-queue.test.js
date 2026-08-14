import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiGenerationQueue } from '../server/ai-concept/AiGenerationQueue.mjs';
import { AiGenerationRepository } from '../server/ai-concept/AiGenerationRepository.mjs';
import { OpenAiImageError } from '../server/ai-concept/OpenAiImageClient.mjs';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function waitUntil(predicate, message = 'condition') {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${message}`);
}

function queueItem(index, overrides = {}) {
    return {
        id: `item-${index}`,
        view: {
            id: `view-${index}`, roomId: 'room-1', roomName: '客厅', name: `视角 ${index}`,
            x: index * 100, y: 200, z: 1500, yaw: 0, pitch: 0, fov: 80,
        },
        styleId: 'modern-minimalist',
        environmentId: 'sunny-day',
        input: { assetId: `input-${index}`, mimeType: 'image/webp', digest: `digest-${index}` },
        status: 'queued', attemptCount: 0,
        createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
        ...overrides,
    };
}

function queueJob(id, items) {
    return {
        id, requestId: `request-${id}`, planId: 'plan-a', planVersion: 'v1',
        whiteModelVersion: 'white-v1', status: 'queued',
        createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
        items,
    };
}

async function withQueueFixture({ items, imageClient, queueOptions = {}, jobId = 'job-queue' }, run) {
    const rootDir = await mkdtemp(join(tmpdir(), 'occt-ai-queue-'));
    const repository = new AiGenerationRepository({ rootDir });
    try {
        const job = queueJob(jobId, items);
        await repository.createJob(job);
        for (const item of items) {
            if (item.input?.assetId) {
                await repository.writeInput(jobId, item.input.assetId, Buffer.from(`image-${item.id}`));
            }
        }
        const queue = new AiGenerationQueue({
            repository,
            imageClient,
            now: () => '2026-08-14T01:00:00.000Z',
            jitter: () => 0,
            ...queueOptions,
        });
        await run({ queue, repository, job });
    } finally {
        await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
    }
}

test('queue runs at most two image edits and persists running state before each call', async () => {
    const calls = [];
    const imageClient = {
        edit(input) {
            const gate = deferred();
            calls.push({ input, gate });
            return gate.promise;
        },
    };
    await withQueueFixture({ items: [queueItem(1), queueItem(2), queueItem(3)], imageClient }, async ({ queue, repository, job }) => {
        const completion = queue.enqueue(job.id);
        await waitUntil(() => calls.length === 2, 'two concurrent edits');
        assert.equal(calls.length, 2);
        const running = await repository.loadJob(job.id);
        assert.deepEqual(running.items.map(item => item.status), ['running', 'running', 'queued']);

        calls[0].gate.resolve({ bytes: Buffer.from('one'), mimeType: 'image/png', usage: null, requestId: 'req-1' });
        calls[1].gate.resolve({ bytes: Buffer.from('two'), mimeType: 'image/png', usage: null, requestId: 'req-2' });
        await waitUntil(() => calls.length === 3, 'third edit after capacity is free');
        calls[2].gate.resolve({ bytes: Buffer.from('three'), mimeType: 'image/png', usage: null, requestId: 'req-3' });
        const completed = await completion;

        assert.equal(completed.status, 'completed');
        assert.deepEqual(completed.items.map(item => item.status), ['completed', 'completed', 'completed']);
        assert.ok(completed.items.every(item => item.output?.url.startsWith('/api/ai-concept/jobs/')));
    });
});

test('queue retries retryable failures with injected exponential backoff', async () => {
    const delays = [];
    let calls = 0;
    const imageClient = {
        async edit() {
            calls += 1;
            if (calls === 1) {
                throw new OpenAiImageError('RATE_LIMITED', 'safe', { status: 429, retryable: true });
            }
            return { bytes: Buffer.from('result'), mimeType: 'image/png', usage: null, requestId: 'req-ok' };
        },
    };
    await withQueueFixture({
        items: [queueItem(1)], imageClient,
        queueOptions: { delayImpl: async milliseconds => { delays.push(milliseconds); } },
    }, async ({ queue, job }) => {
        const completed = await queue.enqueue(job.id);
        assert.equal(calls, 2);
        assert.deepEqual(delays, [1000]);
        assert.equal(completed.items[0].attemptCount, 2);
        assert.equal(completed.items[0].status, 'completed');
    });
});

test('queue fails non-retryable errors once and persists only safe fields', async () => {
    let calls = 0;
    const imageClient = {
        async edit() {
            calls += 1;
            throw new OpenAiImageError('CONTENT_POLICY_VIOLATION', 'private unsafe prompt', {
                status: 400, retryable: false, requestId: 'req-policy',
            });
        },
    };
    await withQueueFixture({ items: [queueItem(1)], imageClient }, async ({ queue, job }) => {
        const failed = await queue.enqueue(job.id);
        assert.equal(calls, 1);
        assert.equal(failed.status, 'failed');
        assert.deepEqual(failed.items[0].error, {
            code: 'CONTENT_POLICY_VIOLATION', status: 400, retryable: false, requestId: 'req-policy',
        });
        assert.doesNotMatch(JSON.stringify(failed), /private unsafe prompt/);
    });
});

test('cancel aborts active work and prevents queued items from starting', async () => {
    const calls = [];
    const imageClient = {
        edit({ signal }) {
            calls.push(signal);
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new OpenAiImageError('CANCELLED', 'safe')), { once: true });
            });
        },
    };
    await withQueueFixture({
        items: [queueItem(1), queueItem(2)], imageClient,
        queueOptions: { concurrency: 1 },
    }, async ({ queue, job }) => {
        const completion = queue.enqueue(job.id);
        await waitUntil(() => calls.length === 1, 'first active edit');
        await queue.cancel(job.id);
        const cancelled = await completion;
        assert.equal(calls.length, 1);
        assert.deepEqual(cancelled.items.map(item => item.status), ['cancelled', 'cancelled']);
        assert.equal(cancelled.status, 'cancelled');
    });
});

test('retry resets and runs only an eligible failed item', async () => {
    const imageClient = {
        async edit() {
            return { bytes: Buffer.from('retry-result'), mimeType: 'image/png', usage: null, requestId: 'req-retry' };
        },
    };
    const items = [
        queueItem(1, { status: 'failed', attemptCount: 3, error: { code: 'RATE_LIMITED', retryable: true } }),
        queueItem(2, { status: 'completed', attemptCount: 1, output: { assetId: 'existing', url: '/existing' } }),
        queueItem(3, { status: 'failed', attemptCount: 1, error: { code: 'INVALID_REQUEST', retryable: false } }),
    ];
    await withQueueFixture({ items, imageClient }, async ({ queue, job }) => {
        const retried = await queue.retry(job.id, 'item-1');
        assert.deepEqual(retried.items.map(item => item.status), ['completed', 'completed', 'failed']);
        assert.equal(retried.items[0].attemptCount, 1);
        await assert.rejects(queue.retry(job.id, 'item-2'), /ITEM_NOT_RETRYABLE/);
        await assert.rejects(queue.retry(job.id, 'item-3'), /ITEM_NOT_RETRYABLE/);
    });
});

test('recovery reports interrupted work without running it until explicitly enqueued', async () => {
    let calls = 0;
    const imageClient = {
        async edit() {
            calls += 1;
            return { bytes: Buffer.from('recovered'), mimeType: 'image/png', usage: null, requestId: 'req-recovered' };
        },
    };
    await withQueueFixture({
        items: [queueItem(1, { status: 'running' })], imageClient,
        jobId: 'job-recover',
    }, async ({ queue, repository, job }) => {
        const recoverable = await queue.recover();
        assert.deepEqual(recoverable.map(value => value.id), [job.id]);
        assert.equal(calls, 0);
        assert.equal((await repository.loadJob(job.id)).items[0].status, 'interrupted');

        const completed = await queue.enqueue(job.id);
        assert.equal(calls, 1);
        assert.equal(completed.items[0].status, 'completed');
    });
});
