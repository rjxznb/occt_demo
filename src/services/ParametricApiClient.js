import { decompress } from 'fzstd';
import { rendererHostClient } from '../core/RendererHostClient.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3100';
const GOODS_TIMEOUT_MS = 35_000;
const MODEL_TIMEOUT_MS = 130_000;
const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;

export class ParametricApiClient {
    constructor({
        hostClient = rendererHostClient,
        fetchImpl = globalThis.fetch?.bind(globalThis),
        backendUrl = DEFAULT_BACKEND_URL,
        decompressImpl = decompress,
    } = {}) {
        this.hostClient = hostClient;
        this.fetchImpl = fetchImpl;
        this.backendUrl = backendUrl.replace(/\/$/, '');
        this.decompressImpl = decompressImpl;
        this.transport = hostClient?.isAvailable() ? 'cad' : 'node';
    }

    async getGoodsDetail(resId) {
        const normalized = String(resId ?? '').trim();
        if (!normalized) throw createError('INVALID_ARGUMENT', 'resId is required');
        if (this.transport === 'cad') {
            return parsePossibleJson(await this.hostClient.invoke(
                'getParametricGoodsDetail',
                { resId: normalized },
                { timeoutMs: GOODS_TIMEOUT_MS },
            ));
        }
        return this.fetchJson(
            `${this.backendUrl}/api/getGoodsDetail?id=${encodeURIComponent(normalized)}`,
        );
    }

    async convertModel(url, parameters = []) {
        const payload = { url: String(url ?? '').trim() };
        if (!payload.url) throw createError('INVALID_ARGUMENT', 'model url is required');
        if (Array.isArray(parameters) && parameters.length) payload.parameters = parameters;
        const raw = this.transport === 'cad'
            ? await this.hostClient.invoke('convertParametricModel', payload, {
                timeoutMs: MODEL_TIMEOUT_MS,
            })
            : await this.postJson(`${this.backendUrl}/api/modelUrlToObj`, payload);
        return decodeModelResponse(raw, this.decompressImpl);
    }

    async fetchJson(url) {
        const response = await this.fetch(url);
        return this.parseResponseJson(response);
    }

    async postJson(url, payload) {
        const response = await this.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return this.parseResponseJson(response);
    }

    async parseResponseJson(response) {
        try {
            return await response.json();
        } catch (error) {
            throw createError('INVALID_RESPONSE', 'Response is not valid JSON', { cause: error });
        }
    }

    async fetch(url, init) {
        if (typeof this.fetchImpl !== 'function') {
            throw createError('FETCH_UNAVAILABLE', 'fetch is unavailable');
        }
        const response = await this.fetchImpl(url, init);
        if (!response?.ok) {
            throw createError('HTTP_ERROR', `HTTP request failed with status ${response?.status}`, {
                status: response?.status,
            });
        }
        return response;
    }
}

export const parametricApiClient = new ParametricApiClient();

function decodeModelResponse(raw, decompressImpl) {
    if (!raw || raw.encoding !== 'zstd-base64' || typeof raw.body !== 'string') {
        return parsePossibleJson(raw);
    }
    let decompressed;
    try {
        decompressed = decompressImpl(base64ToBytes(raw.body));
        if (decompressed.byteLength > MAX_DECOMPRESSED_BYTES) {
            throw new Error('Decompressed model exceeds the size limit');
        }
    } catch (error) {
        if (error?.code === 'DECOMPRESSION_ERROR') throw error;
        throw createError('DECOMPRESSION_ERROR', 'Unable to decompress model response', { cause: error });
    }
    const text = new TextDecoder().decode(decompressed).replace(/^\uFEFF/, '');
    return parsePossibleJson(text);
}

function base64ToBytes(value) {
    try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    } catch (error) {
        throw createError('DECOMPRESSION_ERROR', 'Invalid base64 model response', { cause: error });
    }
}

function parsePossibleJson(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        throw createError('INVALID_RESPONSE', 'Response is not valid JSON', { cause: error });
    }
}

function createError(code, message, properties = {}) {
    return Object.assign(new Error(message), { code, ...properties });
}
