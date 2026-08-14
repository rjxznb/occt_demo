const DEFAULT_BASE_PATH = '/api/ai-concept';

export class AiGenerationClientError extends Error {
    constructor(code, status = 0) {
        super(code);
        this.name = 'AiGenerationClientError';
        this.code = code;
        this.status = status;
    }
}

function identifier(value, code) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
        throw new AiGenerationClientError(code);
    }
    return encodeURIComponent(normalized);
}

function safeCode(value, fallback) {
    return typeof value === 'string' && /^[A-Z0-9_]+$/.test(value) ? value : fallback;
}

export class AiGenerationClient {
    constructor({ fetchImpl = globalThis.fetch, basePath = DEFAULT_BASE_PATH } = {}) {
        if (typeof fetchImpl !== 'function') throw new AiGenerationClientError('FETCH_UNAVAILABLE');
        if (basePath !== DEFAULT_BASE_PATH) throw new AiGenerationClientError('INVALID_BASE_PATH');
        this.fetchImpl = fetchImpl;
        this.basePath = basePath;
    }

    async _request(path, { method = 'GET', body, signal } = {}) {
        let response;
        try {
            response = await this.fetchImpl(`${this.basePath}${path}`, {
                method,
                signal,
                headers: body === undefined ? undefined : { 'content-type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new AiGenerationClientError('NETWORK_ERROR');
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new AiGenerationClientError('INVALID_RESPONSE', Number(response?.status) || 0);
        }
        if (!response.ok) {
            throw new AiGenerationClientError(
                safeCode(payload?.code, 'REQUEST_FAILED'),
                Number(response.status) || 0,
            );
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new AiGenerationClientError('INVALID_RESPONSE', Number(response.status) || 0);
        }
        return payload;
    }

    getCatalog(options = {}) {
        return this._request('/catalog', options);
    }

    createJob(payload, options = {}) {
        return this._request('/jobs', { ...options, method: 'POST', body: payload });
    }

    async getJob(jobId, options = {}) {
        return this._request(`/jobs/${identifier(jobId, 'INVALID_JOB_ID')}`, options);
    }

    async retryItem(jobId, itemId, options = {}) {
        const job = identifier(jobId, 'INVALID_JOB_ID');
        const item = decodeURIComponent(identifier(itemId, 'INVALID_ITEM_ID'));
        return this._request(`/jobs/${job}/retry`, {
            ...options,
            method: 'POST',
            body: { itemId: item },
        });
    }

    async cancelJob(jobId, options = {}) {
        return this._request(`/jobs/${identifier(jobId, 'INVALID_JOB_ID')}/cancel`, {
            ...options,
            method: 'POST',
            body: {},
        });
    }
}
