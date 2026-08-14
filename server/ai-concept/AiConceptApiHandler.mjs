import { randomUUID } from 'node:crypto';

import {
    ENVIRONMENT_CATALOG,
    MAX_IMAGES_PER_JOB,
    STYLE_CATALOG,
} from '../../src/ai-concept/AiGenerationCatalog.js';
import {
    AiApiError,
    aggregateJobStatus,
    expandGenerationItems,
    validateCreateJobRequest,
} from './AiGenerationJobModel.mjs';

const JSON_HEADERS = Object.freeze({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
});

function sendJson(res, status, body) {
    if (res.writableEnded) return;
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(body));
}

function publicCatalog(items) {
    return items.map(({ prompt: _prompt, ...item }) => item);
}

function apiError(code, status = 400) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    return error;
}

async function readJson(req, limit) {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
            exceeded = true;
            continue;
        }
        chunks.push(chunk);
    }
    if (exceeded) throw apiError('BODY_TOO_LARGE', 413);
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw apiError('MALFORMED_JSON', 400);
    }
}

function safeJob(job) {
    return structuredClone(job);
}

function errorStatus(error) {
    if (Number.isInteger(error?.status)) return error.status;
    if (['JOB_NOT_FOUND', 'ASSET_NOT_FOUND', 'ITEM_NOT_FOUND'].includes(error?.code)) return 404;
    if (['INVALID_JOB_ID', 'INVALID_ASSET_ID', 'ITEM_NOT_RETRYABLE'].includes(error?.code)) return 400;
    return error instanceof AiApiError ? 400 : 500;
}

function safeCode(error) {
    if (typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
    return 'INTERNAL_ERROR';
}

export function createAiConceptApiHandler({
    repository,
    queue,
    apiConfigured = false,
    bodyLimitBytes = 32 * 1024 * 1024,
    idFactory = prefix => `${prefix}-${randomUUID()}`,
    now = () => new Date().toISOString(),
} = {}) {
    if (!repository || !queue) throw apiError('INVALID_API_CONFIG', 500);
    const limit = Math.max(1, Math.floor(Number(bodyLimitBytes) || 32 * 1024 * 1024));

    return async function handleAiConceptApi(req, res) {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/api/ai-concept')) return false;

        try {
            if (req.method === 'GET' && url.pathname === '/api/ai-concept/catalog') {
                sendJson(res, 200, {
                    configured: apiConfigured === true,
                    maxImages: MAX_IMAGES_PER_JOB,
                    styles: publicCatalog(STYLE_CATALOG),
                    environments: publicCatalog(ENVIRONMENT_CATALOG),
                });
                return true;
            }

            if (req.method === 'POST' && url.pathname === '/api/ai-concept/jobs') {
                if (!apiConfigured) {
                    req.resume?.();
                    sendJson(res, 503, { code: 'OPENAI_NOT_CONFIGURED' });
                    return true;
                }
                const request = validateCreateJobRequest(await readJson(req, limit));
                const duplicate = await repository.findJobByRequestId(request.requestId);
                if (duplicate) {
                    sendJson(res, 200, safeJob(duplicate));
                    return true;
                }

                const createdAt = now();
                const jobId = idFactory('job');
                const inputByView = new Map();
                request.views.forEach((view, index) => {
                    inputByView.set(view.id, {
                        assetId: `input-${index + 1}`,
                        mimeType: view.input.mimeType,
                        digest: view.input.digest,
                        url: `/api/ai-concept/jobs/${jobId}/assets/input-${index + 1}`,
                        bytes: view.input.bytes,
                    });
                });
                const items = expandGenerationItems(request, {
                    idFactory: index => idFactory(`item-${index + 1}`),
                    now: () => createdAt,
                }).map(item => {
                    const input = inputByView.get(item.view.id);
                    return {
                        ...item,
                        attemptCount: 0,
                        input: {
                            assetId: input.assetId,
                            mimeType: input.mimeType,
                            digest: input.digest,
                            url: input.url,
                        },
                    };
                });
                const job = {
                    id: jobId,
                    requestId: request.requestId,
                    planId: request.planId,
                    planVersion: request.planVersion,
                    whiteModelVersion: request.whiteModelVersion,
                    status: aggregateJobStatus(items),
                    createdAt,
                    updatedAt: createdAt,
                    items,
                };
                await repository.createJob(job);
                for (const input of inputByView.values()) {
                    await repository.writeInput(jobId, input.assetId, input.bytes, input.mimeType);
                }
                Promise.resolve(queue.enqueue(jobId)).catch(() => {});
                sendJson(res, 202, safeJob(job));
                return true;
            }

            const asset = /^\/api\/ai-concept\/jobs\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
            if (req.method === 'GET' && asset) {
                const result = await repository.readAsset(decodeURIComponent(asset[1]), decodeURIComponent(asset[2]));
                res.writeHead(200, {
                    'content-type': result.mimeType,
                    'content-length': result.bytes.length,
                    'cache-control': 'private, max-age=31536000, immutable',
                });
                res.end(result.bytes);
                return true;
            }

            const getJob = /^\/api\/ai-concept\/jobs\/([^/]+)$/.exec(url.pathname);
            if (req.method === 'GET' && getJob) {
                const job = await repository.loadJob(decodeURIComponent(getJob[1]));
                if (!job) throw apiError('JOB_NOT_FOUND', 404);
                sendJson(res, 200, safeJob(job));
                return true;
            }

            const retry = /^\/api\/ai-concept\/jobs\/([^/]+)\/retry$/.exec(url.pathname);
            if (req.method === 'POST' && retry) {
                const jobId = decodeURIComponent(retry[1]);
                const body = await readJson(req, limit);
                const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
                const job = await repository.loadJob(jobId);
                const item = job?.items?.find(value => value.id === itemId);
                if (!job) throw apiError('JOB_NOT_FOUND', 404);
                if (!item) throw apiError('ITEM_NOT_FOUND', 404);
                if (!['failed', 'interrupted'].includes(item.status) || item.error?.retryable !== true) {
                    throw apiError('ITEM_NOT_RETRYABLE', 400);
                }
                Promise.resolve(queue.retry(jobId, itemId)).catch(() => {});
                sendJson(res, 202, { accepted: true, jobId, itemId });
                return true;
            }

            const cancel = /^\/api\/ai-concept\/jobs\/([^/]+)\/cancel$/.exec(url.pathname);
            if (req.method === 'POST' && cancel) {
                const jobId = decodeURIComponent(cancel[1]);
                const job = await queue.cancel(jobId);
                sendJson(res, 200, safeJob(job));
                return true;
            }

            sendJson(res, 404, { code: 'NOT_FOUND' });
            return true;
        } catch (error) {
            sendJson(res, errorStatus(error), { code: safeCode(error) });
            return true;
        }
    };
}
