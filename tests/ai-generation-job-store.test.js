import assert from 'node:assert/strict';
import test from 'node:test';

import { AiGenerationJobStore } from '../src/ai-concept/AiGenerationJobStore.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function schedulerHarness() {
    const pending = [];
    return {
        pending,
        schedule(callback, delay) {
            const token = { callback, delay, cancelled: false };
            pending.push(token);
            return token;
        },
        cancel(token) { token.cancelled = true; },
        async runNext() {
            const token = pending.shift();
            assert.ok(token, 'expected one scheduled poll');
            assert.equal(token.cancelled, false);
            await token.callback();
            return token;
        },
    };
}

test('job store fetches immediately, emits partial results, and polls every two seconds until terminal', async () => {
    const scheduler = schedulerHarness();
    const jobs = [
        { id: 'job-1', status: 'queued', items: [{ id: 'a', status: 'queued' }] },
        { id: 'job-1', status: 'running', items: [{ id: 'a', status: 'completed', output: { url: '/a.png' } }, { id: 'b', status: 'running' }] },
        { id: 'job-1', status: 'partial', items: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }] },
    ];
    const calls = [];
    const store = new AiGenerationJobStore({
        client: { async getJob(id) { calls.push(id); return structuredClone(jobs.shift()); } },
        schedule: scheduler.schedule,
        cancelSchedule: scheduler.cancel,
    });
    const states = [];
    store.subscribe(state => states.push(state));

    await store.start('job-1');
    assert.equal(calls.length, 1);
    assert.equal(scheduler.pending[0].delay, 2000);
    await scheduler.runNext();
    assert.equal(store.getState().job.items[0].output.url, '/a.png');
    assert.equal(scheduler.pending[0].delay, 2000);
    await scheduler.runNext();
    assert.equal(store.getState().job.status, 'partial');
    assert.equal(scheduler.pending.length, 0);
    assert.ok(states.some(state => state.job?.items?.some(item => item.output?.url === '/a.png')));
});

test('job store discards stale responses after switching jobs', async () => {
    const first = deferred();
    const client = {
        getJob(id) {
            if (id === 'job-1') return first.promise;
            return Promise.resolve({ id: 'job-2', status: 'completed', items: [] });
        },
    };
    const store = new AiGenerationJobStore({ client });
    const firstStart = store.start('job-1');
    await store.start('job-2');
    first.resolve({ id: 'job-1', status: 'completed', items: [] });
    await firstStart;
    assert.equal(store.getState().job.id, 'job-2');
});

test('job store retries one failed item, cancels active work, and stops scheduled polling', async () => {
    const scheduler = schedulerHarness();
    const calls = [];
    let job = { id: 'job-1', status: 'running', items: [{ id: 'item-1', status: 'failed', error: { retryable: true } }] };
    const client = {
        async getJob() { return structuredClone(job); },
        async retryItem(jobId, itemId) { calls.push(['retry', jobId, itemId]); job = { ...job, status: 'queued' }; return { accepted: true }; },
        async cancelJob(jobId) { calls.push(['cancel', jobId]); job = { ...job, status: 'cancelled' }; return structuredClone(job); },
    };
    const store = new AiGenerationJobStore({
        client,
        schedule: scheduler.schedule,
        cancelSchedule: scheduler.cancel,
    });

    await store.start('job-1');
    await store.retry('item-1');
    assert.deepEqual(calls[0], ['retry', 'job-1', 'item-1']);
    await store.cancel();
    assert.deepEqual(calls[1], ['cancel', 'job-1']);
    assert.equal(store.getState().job.status, 'cancelled');
    assert.ok(scheduler.pending.every(token => token.cancelled));
});
