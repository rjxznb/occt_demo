import { decompress } from 'fzstd';
import { rendererHostClient } from '../core/RendererHostClient.js';

const DEFAULT_BACKEND_URL = 'http://localhost:3100';
const GOODS_TIMEOUT_MS = 35_000;
const MODEL_TIMEOUT_MS = 130_000;
const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;
const GOODS_CONCURRENCY = 3;

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

    async getGoodsDetails(resIds) {
        const ids = [...new Set((resIds || []).map(value => String(value).trim())
            .filter(value => /^\d+$/.test(value)))];
        if (ids.length === 0) return { items: [] };

        const batches = [];
        for (let index = 0; index < ids.length; index += 50) {
            batches.push(ids.slice(index, index + 50));
        }
        const responses = await mapSettledWithConcurrency(
            batches,
            GOODS_CONCURRENCY,
            batch => this.transport === 'cad'
                ? this.hostClient.invoke(
                    'getContentGoodsDetails', { resIds: batch }, { timeoutMs: GOODS_TIMEOUT_MS },
                )
                : this.postJson(
                    `${this.backendUrl}/api/getContentGoodsDetails`,
                    { resIds: batch },
                ),
        );
        const errors = responses.filter(result => result.status === 'rejected')
            .map(result => result.reason);
        const items = [];
        let validResponseCount = 0;
        for (const response of responses) {
            if (response.status !== 'fulfilled') continue;
            try {
                items.push(...normalizeGoodsItems(response.value));
                validResponseCount += 1;
            } catch (error) {
                errors.push(error);
            }
        }
        if (validResponseCount === 0 && errors.length > 0) throw errors[0];
        const detailById = indexGoodsDetails({ items });
        return { items: ids.flatMap(id => detailById.has(id) ? [detailById.get(id)] : []) };
    }

    async getMaterialDetails(materialCodes) {
        const codes = [...new Set((materialCodes || [])
            .map(value => String(value).trim())
            .filter(value => /^PT\d+$/.test(value)))];
        if (codes.length === 0) return { items: [] };

        const batches = [];
        for (let index = 0; index < codes.length; index += 50) {
            batches.push(codes.slice(index, index + 50));
        }
        const responses = await mapSettledWithConcurrency(
            batches,
            GOODS_CONCURRENCY,
            batch => this.transport === 'cad'
                ? this.hostClient.invoke(
                    'getContentMaterialDetails',
                    { materialCodes: batch },
                    { timeoutMs: GOODS_TIMEOUT_MS },
                )
                : this.postJson(
                    `${this.backendUrl}/api/getContentMaterialDetails`,
                    { materialCodes: batch },
                ),
        );
        const errors = responses.filter(result => result.status === 'rejected')
            .map(result => result.reason);
        const items = [];
        let validResponseCount = 0;
        for (const response of responses) {
            if (response.status !== 'fulfilled') continue;
            try {
                items.push(...normalizeMaterialItems(response.value));
                validResponseCount += 1;
            } catch (error) {
                errors.push(error);
            }
        }
        if (validResponseCount === 0 && errors.length > 0) throw errors[0];
        const detailByCode = indexMaterialDetails({ items });
        return { items: codes.flatMap(code => detailByCode.has(code)
            ? [detailByCode.get(code)] : []) };
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

async function mapSettledWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = { status: 'fulfilled', value: await mapper(values[index], index) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    });
    await Promise.all(workers);
    return results;
}

export const parametricApiClient = new ParametricApiClient();

export function normalizeGoodsItems(raw) {
    const response = parsePossibleJson(raw);
    if (!response || typeof response !== 'object') return [];

    if (Object.hasOwn(response, 'code')) {
        const businessCode = response.code;
        const isAllowedCode = businessCode === 1 || businessCode === 2000
            || businessCode === '1' || businessCode === '2000';
        if (!isAllowedCode) {
            const numericCode = typeof businessCode === 'number' && Number.isFinite(businessCode)
                ? businessCode
                : undefined;
            throw createError('INVALID_RESPONSE', numericCode === undefined
                ? 'Invalid business response code'
                : `Invalid business response code: ${numericCode}`, { businessCode: numericCode });
        }
    }

    if (Array.isArray(response.items)) return response.items;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data?.list)) return response.data.list;
    if (response.data?.modelDTO && typeof response.data.modelDTO === 'object') {
        return [response.data.modelDTO];
    }
    if (response.modelDTO && typeof response.modelDTO === 'object') return [response.modelDTO];
    if (response.data && typeof response.data === 'object') return [response.data];
    return [];
}

export function indexGoodsDetails(raw) {
    const items = Array.isArray(raw) ? raw : normalizeGoodsItems(raw);
    const details = new Map();
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const model = item.modelDTO ?? item.data?.modelDTO;
        const ids = [item.id, item.resGoodsId, model?.id, model?.resGoodsId];
        for (const id of ids) {
            if (id !== undefined && id !== null) details.set(String(id), item);
        }
    }
    return details;
}

export function normalizeMaterialItems(raw) {
    const response = parsePossibleJson(raw);
    if (!response || typeof response !== 'object') return [];
    if (Object.hasOwn(response, 'code')) {
        const code = response.code;
        if (code !== 1 && code !== 2000 && code !== '1' && code !== '2000') {
            const businessCode = typeof code === 'number' && Number.isFinite(code)
                ? code : undefined;
            throw createError('INVALID_RESPONSE', businessCode === undefined
                ? 'Invalid business response code'
                : `Invalid business response code: ${businessCode}`, { businessCode });
        }
    }
    if (Array.isArray(response.items)) return response.items;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data?.list)) return response.data.list;
    return [];
}

export function indexMaterialDetails(raw) {
    const items = Array.isArray(raw) ? raw : normalizeMaterialItems(raw);
    const details = new Map();
    for (const item of items) {
        const code = String(item?.code ?? item?.resCode ?? '').trim();
        if (/^PT\d+$/.test(code)) details.set(code, item);
    }
    return details;
}

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
