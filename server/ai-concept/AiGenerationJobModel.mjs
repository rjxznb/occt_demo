import { createHash, randomUUID } from 'node:crypto';

import {
    ENVIRONMENT_CATALOG,
    MAX_IMAGES_PER_JOB,
    STYLE_CATALOG,
} from '../../src/ai-concept/AiGenerationCatalog.js';

const REQUEST_FIELDS = new Set([
    'requestId', 'planId', 'planVersion', 'whiteModelVersion',
    'styleIds', 'environmentIds', 'views',
]);
const VIEW_FIELDS = new Set([
    'id', 'roomId', 'roomName', 'name', 'x', 'y', 'z', 'yaw', 'pitch', 'fov', 'dataUrl',
]);
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export class AiApiError extends Error {
    constructor(code, message = code, { status = 400, details = undefined } = {}) {
        super(message);
        this.name = 'AiApiError';
        this.code = code;
        this.status = status;
        if (details !== undefined) this.details = details;
    }
}

function fail(code, details) {
    throw new AiApiError(code, code, { details });
}

function object(value, code = 'INVALID_REQUEST') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    return value;
}

function string(value, field, { max = 200 } = {}) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > max) fail('INVALID_FIELD', { field });
    return normalized;
}

function number(value, field) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) fail('INVALID_FIELD', { field });
    return normalized;
}

function uniqueIds(values, field) {
    if (!Array.isArray(values) || !values.length) fail('INVALID_FIELD', { field });
    const result = values.map(value => string(value, field, { max: 80 }));
    if (new Set(result).size !== result.length) fail('DUPLICATE_FIELD_VALUE', { field });
    return result;
}

function decodeInputImage(dataUrl, viewId) {
    if (typeof dataUrl !== 'string') fail('INVALID_INPUT_IMAGE', { viewId });
    const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match || match[1].length % 4 !== 0) fail('INVALID_INPUT_IMAGE', { viewId });
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > MAX_INPUT_BYTES
        || bytes.toString('base64') !== match[1]) {
        fail('INVALID_INPUT_IMAGE', { viewId });
    }
    return {
        mimeType: 'image/webp',
        bytes,
        digest: createHash('sha256').update(bytes).digest('hex'),
    };
}

function normalizeView(value, index) {
    const source = object(value, 'INVALID_VIEW');
    const unknown = Object.keys(source).filter(field => !VIEW_FIELDS.has(field));
    if (unknown.length) fail('UNKNOWN_VIEW_FIELD', { index, fields: unknown });
    const id = string(source.id, `views[${index}].id`, { max: 120 });
    return {
        id,
        roomId: string(source.roomId, `views[${index}].roomId`, { max: 120 }),
        roomName: string(source.roomName, `views[${index}].roomName`),
        name: string(source.name, `views[${index}].name`),
        x: number(source.x, `views[${index}].x`),
        y: number(source.y, `views[${index}].y`),
        z: number(source.z, `views[${index}].z`),
        yaw: number(source.yaw, `views[${index}].yaw`),
        pitch: number(source.pitch, `views[${index}].pitch`),
        fov: number(source.fov, `views[${index}].fov`),
        input: decodeInputImage(source.dataUrl, id),
    };
}

export function validateCreateJobRequest(body) {
    const source = object(body);
    const unknown = Object.keys(source).filter(field => !REQUEST_FIELDS.has(field));
    if (unknown.length) fail('UNKNOWN_FIELD', { fields: unknown });
    const styleIds = uniqueIds(source.styleIds, 'styleIds');
    const environmentIds = uniqueIds(source.environmentIds, 'environmentIds');
    const knownStyles = new Set(STYLE_CATALOG.map(item => item.id));
    const knownEnvironments = new Set(ENVIRONMENT_CATALOG.map(item => item.id));
    if (styleIds.some(id => !knownStyles.has(id))) fail('UNKNOWN_STYLE');
    if (environmentIds.some(id => !knownEnvironments.has(id))) fail('UNKNOWN_ENVIRONMENT');
    if (!Array.isArray(source.views) || !source.views.length) fail('NO_VIEWS');
    const views = source.views.map(normalizeView);
    if (new Set(views.map(view => view.id)).size !== views.length) fail('DUPLICATE_VIEW');
    if (views.length * styleIds.length * environmentIds.length > MAX_IMAGES_PER_JOB) {
        fail('TOO_MANY_IMAGES', { maxImages: MAX_IMAGES_PER_JOB });
    }
    return {
        requestId: string(source.requestId, 'requestId', { max: 120 }),
        planId: string(source.planId, 'planId', { max: 160 }),
        planVersion: string(source.planVersion, 'planVersion', { max: 160 }),
        whiteModelVersion: string(source.whiteModelVersion, 'whiteModelVersion', { max: 160 }),
        styleIds,
        environmentIds,
        views,
    };
}

function keyFacts(item) {
    return [
        item.planId,
        item.planVersion,
        item.whiteModelVersion,
        item.view?.id,
        item.styleId,
        item.environmentId,
        item.input?.digest,
    ].map(value => String(value ?? ''));
}

export function computeGenerationIdempotencyKey(item) {
    return createHash('sha256').update(JSON.stringify(keyFacts(item))).digest('hex');
}

export function expandGenerationItems(request, {
    idFactory = () => randomUUID(),
    now = () => new Date().toISOString(),
} = {}) {
    const items = [];
    for (const view of request.views) {
        for (const styleId of request.styleIds) {
            for (const environmentId of request.environmentIds) {
                const item = {
                    id: idFactory(items.length),
                    planId: request.planId,
                    planVersion: request.planVersion,
                    whiteModelVersion: request.whiteModelVersion,
                    view: {
                        id: view.id, roomId: view.roomId, roomName: view.roomName, name: view.name,
                        x: view.x, y: view.y, z: view.z, yaw: view.yaw, pitch: view.pitch, fov: view.fov,
                    },
                    styleId,
                    environmentId,
                    input: view.input,
                    status: 'queued',
                    createdAt: now(),
                    updatedAt: now(),
                };
                item.idempotencyKey = computeGenerationIdempotencyKey(item);
                items.push(item);
            }
        }
    }
    return items;
}

export function aggregateJobStatus(items = []) {
    const statuses = items.map(item => item?.status);
    if (!statuses.length || statuses.every(status => status === 'queued')) return 'queued';
    if (statuses.some(status => status === 'running')) return 'running';
    if (statuses.some(status => status === 'queued')) return 'running';
    if (statuses.every(status => status === 'completed')) return 'completed';
    if (statuses.every(status => status === 'cancelled')) return 'cancelled';
    if (!statuses.includes('completed') && statuses.some(status => status === 'failed')) return 'failed';
    if (statuses.every(status => status === 'interrupted')) return 'queued';
    if (!statuses.includes('completed') && statuses.every(status => ['failed', 'interrupted'].includes(status))) {
        return 'failed';
    }
    return 'partial';
}
