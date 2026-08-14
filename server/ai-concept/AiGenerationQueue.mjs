import { aggregateJobStatus } from './AiGenerationJobModel.mjs';
import { buildInteriorEditPrompt } from './OpenAiImageClient.mjs';

function queueError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function safeError(error) {
    const result = {
        code: typeof error?.code === 'string' ? error.code : 'IMAGE_GENERATION_FAILED',
        status: Number.isInteger(error?.status) ? error.status : undefined,
        retryable: error?.retryable === true,
        requestId: typeof error?.requestId === 'string' ? error.requestId : undefined,
    };
    return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function updateJobStatus(job, now) {
    job.status = aggregateJobStatus(job.items);
    job.updatedAt = now();
    return job;
}

export class AiGenerationQueue {
    constructor({
        repository,
        imageClient,
        concurrency = 2,
        maxAttempts = 3,
        delayImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
        jitter = () => Math.random(),
        now = () => new Date().toISOString(),
    } = {}) {
        if (!repository || typeof imageClient?.edit !== 'function') throw queueError('INVALID_QUEUE_CONFIG');
        this.repository = repository;
        this.imageClient = imageClient;
        this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 2));
        this.maxAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 3));
        this.delayImpl = delayImpl;
        this.jitter = jitter;
        this.now = now;
        this.pending = [];
        this.scheduled = new Set();
        this.active = 0;
        this.workers = new Set();
        this.controllers = new Map();
        this.cancelledJobs = new Set();
        this.runs = new Map();
        this.jobLocks = new Map();
    }

    _key(jobId, itemId) {
        return `${jobId}:${itemId}`;
    }

    _schedule(jobId, itemId) {
        const key = this._key(jobId, itemId);
        if (this.scheduled.has(key) || this.controllers.has(key)) return;
        this.scheduled.add(key);
        this.pending.push({ jobId, itemId, key });
    }

    _pump() {
        while (this.active < this.concurrency && this.pending.length) {
            const work = this.pending.shift();
            this.scheduled.delete(work.key);
            this.active += 1;
            this.workers.add(work.key);
            void this._runItem(work)
                .catch(error => this._rejectRun(work.jobId, error))
                .finally(async () => {
                    this.active -= 1;
                    this.workers.delete(work.key);
                    try {
                        await this._maybeComplete(work.jobId);
                    } catch (error) {
                        this._rejectRun(work.jobId, error);
                    }
                    this._pump();
                });
        }
    }

    _ensureRun(jobId) {
        const existing = this.runs.get(jobId);
        if (existing) return existing;
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const run = { promise, resolve, reject };
        this.runs.set(jobId, run);
        return run;
    }

    _rejectRun(jobId, error) {
        const run = this.runs.get(jobId);
        if (!run) return;
        this.runs.delete(jobId);
        run.reject(error);
    }

    async _persist(job) {
        updateJobStatus(job, this.now);
        return this.repository.saveJob(job);
    }

    async _withJobLock(jobId, operation) {
        const previous = this.jobLocks.get(jobId) ?? Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        this.jobLocks.set(jobId, current);
        try {
            return await current;
        } finally {
            if (this.jobLocks.get(jobId) === current) this.jobLocks.delete(jobId);
        }
    }

    async _maybeComplete(jobId) {
        const run = this.runs.get(jobId);
        if (!run) return;
        const hasActive = [...this.workers].some(key => key.startsWith(`${jobId}:`));
        if (hasActive) return;
        const job = await this._withJobLock(jobId, async () => {
            const loaded = await this.repository.loadJob(jobId);
            if (!loaded) throw queueError('JOB_NOT_FOUND');
            if (loaded.items.some(item => ['queued', 'running', 'interrupted'].includes(item.status))) return null;
            updateJobStatus(loaded, this.now);
            await this.repository.saveJob(loaded);
            return loaded;
        });
        if (!job) return;
        this.runs.delete(jobId);
        this.cancelledJobs.delete(jobId);
        run.resolve(job);
    }

    async enqueue(jobId) {
        this.cancelledJobs.delete(jobId);
        const job = await this._withJobLock(jobId, async () => {
            const loaded = await this.repository.loadJob(jobId);
            if (!loaded) throw queueError('JOB_NOT_FOUND');
            let changed = false;
            for (const item of loaded.items ?? []) {
                if (item.status === 'interrupted') {
                    item.status = 'queued';
                    item.error = undefined;
                    changed = true;
                }
            }
            if (changed) await this._persist(loaded);
            return loaded;
        });
        const queued = (job.items ?? []).filter(item => item.status === 'queued');
        if (!queued.length && !(job.items ?? []).some(item => item.status === 'running')) {
            return updateJobStatus(job, this.now);
        }
        const run = this._ensureRun(jobId);
        for (const item of queued) this._schedule(jobId, item.id);
        this._pump();
        return run.promise;
    }

    async _runItem({ jobId, itemId, key }) {
        const started = await this._withJobLock(jobId, async () => {
            const loaded = await this.repository.loadJob(jobId);
            const target = loaded?.items?.find(value => value.id === itemId);
            if (!loaded || !target) throw queueError('ITEM_NOT_FOUND');
            if (this.cancelledJobs.has(jobId) || target.status !== 'queued') return null;
            target.status = 'running';
            target.attemptCount = (Number(target.attemptCount) || 0) + 1;
            target.error = undefined;
            target.updatedAt = this.now();
            await this._persist(loaded);
            return structuredClone(target);
        });
        if (!started) {
            return;
        }

        const controller = new AbortController();
        this.controllers.set(key, controller);
        let retryReady = false;
        try {
            const input = await this.repository.readAsset(jobId, started.input.assetId);
            const prompt = buildInteriorEditPrompt({
                style: started.styleId,
                environment: started.environmentId,
            });
            const result = await this.imageClient.edit({
                imageBytes: input.bytes,
                mimeType: input.mimeType,
                prompt,
                signal: controller.signal,
            });
            const output = await this.repository.writeOutput(
                jobId,
                `output-${started.id}`,
                result.bytes,
                result.mimeType,
            );
            await this._withJobLock(jobId, async () => {
                const loaded = await this.repository.loadJob(jobId);
                const target = loaded.items.find(value => value.id === itemId);
                if (!this.cancelledJobs.has(jobId) && target.status !== 'cancelled') {
                    target.status = 'completed';
                    target.output = {
                        ...output,
                        usage: result.usage ?? null,
                        requestId: result.requestId,
                    };
                    target.error = undefined;
                    target.updatedAt = this.now();
                    await this._persist(loaded);
                }
            });
        } catch (error) {
            const retry = await this._withJobLock(jobId, async () => {
                const loaded = await this.repository.loadJob(jobId);
                const target = loaded.items.find(value => value.id === itemId);
                const cancelled = this.cancelledJobs.has(jobId)
                    || target.status === 'cancelled'
                    || error?.code === 'CANCELLED';
                if (cancelled) {
                    target.status = 'cancelled';
                    target.error = undefined;
                    target.updatedAt = this.now();
                    await this._persist(loaded);
                    return null;
                }
                target.error = safeError(error);
                target.updatedAt = this.now();
                const shouldRetry = target.error.retryable && target.attemptCount < this.maxAttempts;
                target.status = shouldRetry ? 'queued' : 'failed';
                await this._persist(loaded);
                return shouldRetry ? target.attemptCount : null;
            });
            if (retry !== null) {
                const base = 1000 * (2 ** (retry - 1));
                const jitter = Math.max(0, Number(this.jitter()) || 0);
                await this.delayImpl(Math.round(base + (base * 0.2 * jitter)));
                retryReady = !this.cancelledJobs.has(jobId);
            }
        } finally {
            this.controllers.delete(key);
            if (retryReady) this._schedule(jobId, itemId);
            this._pump();
        }
    }

    async cancel(jobId) {
        this.cancelledJobs.add(jobId);
        const job = await this._withJobLock(jobId, async () => {
            const loaded = await this.repository.loadJob(jobId);
            if (!loaded) throw queueError('JOB_NOT_FOUND');
            for (const item of loaded.items ?? []) {
                if (!['queued', 'running', 'interrupted'].includes(item.status)) continue;
                item.status = 'cancelled';
                item.error = undefined;
                item.updatedAt = this.now();
            }
            await this._persist(loaded);
            return loaded;
        });
        this.pending = this.pending.filter(work => {
            if (work.jobId !== jobId) return true;
            this.scheduled.delete(work.key);
            return false;
        });
        for (const [key, controller] of this.controllers) {
            if (key.startsWith(`${jobId}:`)) controller.abort();
        }
        await this._maybeComplete(jobId);
        return this.repository.loadJob(jobId);
    }

    async retry(jobId, itemId) {
        this.cancelledJobs.delete(jobId);
        await this._withJobLock(jobId, async () => {
            const job = await this.repository.loadJob(jobId);
            if (!job) throw queueError('JOB_NOT_FOUND');
            const item = job.items?.find(value => value.id === itemId);
            if (!item) throw queueError('ITEM_NOT_FOUND');
            if (!['failed', 'interrupted'].includes(item.status) || item.error?.retryable !== true) {
                throw queueError('ITEM_NOT_RETRYABLE');
            }
            item.status = 'queued';
            item.attemptCount = 0;
            item.error = undefined;
            item.output = undefined;
            item.updatedAt = this.now();
            await this._persist(job);
        });
        return this.enqueue(jobId);
    }

    recover() {
        return this.repository.listRecoverableJobs();
    }
}
