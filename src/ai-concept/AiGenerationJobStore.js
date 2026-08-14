const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

function copy(value) {
    return value == null ? value : structuredClone(value);
}

function messageOf(error) {
    return typeof error?.code === 'string' ? error.code : 'JOB_REQUEST_FAILED';
}

export class AiGenerationJobStore {
    constructor({
        client,
        pollInterval = 2000,
        schedule = (callback, delay) => setTimeout(callback, delay),
        cancelSchedule = token => clearTimeout(token),
    } = {}) {
        if (!client || typeof client.getJob !== 'function') throw new Error('INVALID_JOB_STORE_CLIENT');
        this.client = client;
        this.pollInterval = Math.max(250, Number(pollInterval) || 2000);
        this.schedule = schedule;
        this.cancelSchedule = cancelSchedule;
        this.listeners = new Set();
        this.timer = null;
        this.generation = 0;
        this.state = { status: 'idle', jobId: null, job: null, error: null };
    }

    getState() {
        return copy(this.state);
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _emit() {
        const snapshot = this.getState();
        for (const listener of this.listeners) listener(snapshot);
    }

    _set(patch) {
        this.state = { ...this.state, ...patch };
        this._emit();
    }

    _clearTimer() {
        if (this.timer == null) return;
        this.cancelSchedule(this.timer);
        this.timer = null;
    }

    _schedulePoll(token) {
        this._clearTimer();
        this.timer = this.schedule(async () => {
            this.timer = null;
            await this._fetch(token);
        }, this.pollInterval);
    }

    async _fetch(token) {
        const jobId = this.state.jobId;
        if (!jobId || token !== this.generation) return false;
        try {
            const job = await this.client.getJob(jobId);
            if (token !== this.generation || this.state.jobId !== jobId) return false;
            this._set({ status: 'ready', job, error: null });
            if (!TERMINAL_STATUSES.has(job.status)) this._schedulePoll(token);
            return true;
        } catch (error) {
            if (token !== this.generation || this.state.jobId !== jobId) return false;
            this._set({ status: 'error', error: messageOf(error) });
            return false;
        }
    }

    async start(jobId) {
        const normalized = typeof jobId === 'string' ? jobId.trim() : '';
        if (!normalized) return false;
        this.stop({ clear: false });
        const token = this.generation;
        this._set({ status: 'loading', jobId: normalized, job: null, error: null });
        return this._fetch(token);
    }

    stop({ clear = false } = {}) {
        this.generation += 1;
        this._clearTimer();
        if (clear) this._set({ status: 'idle', jobId: null, job: null, error: null });
    }

    async retry(itemId) {
        if (!this.state.jobId) return false;
        await this.client.retryItem(this.state.jobId, itemId);
        this.generation += 1;
        const token = this.generation;
        return this._fetch(token);
    }

    async cancel() {
        if (!this.state.jobId) return false;
        this._clearTimer();
        const job = await this.client.cancelJob(this.state.jobId);
        this.generation += 1;
        this._set({ status: 'ready', job, error: null });
        return true;
    }
}
