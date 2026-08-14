import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AiApiError,
    aggregateJobStatus,
    computeGenerationIdempotencyKey,
    expandGenerationItems,
    validateCreateJobRequest,
} from '../server/ai-concept/AiGenerationJobModel.mjs';

const image = `data:image/webp;base64,${Buffer.from('white-model').toString('base64')}`;

function validBody(overrides = {}) {
    return {
        requestId: 'request-001',
        planId: 'plan-a',
        planVersion: 'v1',
        whiteModelVersion: 'white-v3',
        styleIds: ['modern-minimalist'],
        environmentIds: ['sunny-day'],
        views: [{
            id: 'view-a', roomId: 'room-a', roomName: '客厅', name: '入口视角',
            x: 100, y: 200, z: 1500, yaw: 90, pitch: 0, fov: 80,
            dataUrl: image,
        }],
        ...overrides,
    };
}

test('validates and normalizes a create-job request without trusting client counts', () => {
    const request = validateCreateJobRequest(validBody());
    assert.equal(request.views[0].input.mimeType, 'image/webp');
    assert.equal(request.views[0].input.bytes.toString(), 'white-model');
    assert.match(request.views[0].input.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(request.styleIds, ['modern-minimalist']);
    assert.equal(Object.hasOwn(request, 'count'), false);
});

test('rejects unknown fields, catalog misses, duplicate captures, and malformed images', () => {
    const cases = [
        [validBody({ apiKey: 'secret' }), 'UNKNOWN_FIELD'],
        [validBody({ styleIds: ['not-a-style'] }), 'UNKNOWN_STYLE'],
        [validBody({ environmentIds: ['not-an-environment'] }), 'UNKNOWN_ENVIRONMENT'],
        [validBody({ views: [validBody().views[0], { ...validBody().views[0] }] }), 'DUPLICATE_VIEW'],
        [validBody({ views: [{ ...validBody().views[0], dataUrl: 'data:image/png;base64,AAAA' }] }), 'INVALID_INPUT_IMAGE'],
        [validBody({ views: [{ ...validBody().views[0], dataUrl: 'data:image/webp;base64,***' }] }), 'INVALID_INPUT_IMAGE'],
    ];
    for (const [body, code] of cases) {
        assert.throws(() => validateCreateJobRequest(body), error => error instanceof AiApiError && error.code === code);
    }
});

test('enforces the 24-image server limit from the Cartesian product', () => {
    const views = Array.from({ length: 13 }, (_, index) => ({
        ...validBody().views[0], id: `view-${index}`, dataUrl: image,
    }));
    assert.throws(
        () => validateCreateJobRequest(validBody({
            views,
            styleIds: ['modern-minimalist', 'fresh-cream'],
        })),
        error => error instanceof AiApiError && error.code === 'TOO_MANY_IMAGES',
    );
});

test('expands items in stable view-style-environment order with deterministic keys', () => {
    const request = validateCreateJobRequest(validBody({
        views: [validBody().views[0], { ...validBody().views[0], id: 'view-b', x: 300 }],
        styleIds: ['modern-minimalist', 'fresh-cream'],
        environmentIds: ['sunny-day', 'night-ambience'],
    }));
    const first = expandGenerationItems(request, {
        idFactory: index => `item-${index}`,
        now: () => '2026-08-14T00:00:00.000Z',
    });
    const second = expandGenerationItems(request, {
        idFactory: index => `other-${index}`,
        now: () => '2026-08-15T00:00:00.000Z',
    });
    assert.equal(first.length, 8);
    assert.deepEqual(first.slice(0, 4).map(item => [item.view.id, item.styleId, item.environmentId]), [
        ['view-a', 'modern-minimalist', 'sunny-day'],
        ['view-a', 'modern-minimalist', 'night-ambience'],
        ['view-a', 'fresh-cream', 'sunny-day'],
        ['view-a', 'fresh-cream', 'night-ambience'],
    ]);
    assert.match(first[0].idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(first[0].idempotencyKey, second[0].idempotencyKey);
    assert.equal(computeGenerationIdempotencyKey(first[0]), first[0].idempotencyKey);
});

test('aggregates every documented job status', () => {
    const items = (...statuses) => statuses.map(status => ({ status }));
    assert.equal(aggregateJobStatus(items('queued')), 'queued');
    assert.equal(aggregateJobStatus(items('running', 'queued')), 'running');
    assert.equal(aggregateJobStatus(items('completed', 'completed')), 'completed');
    assert.equal(aggregateJobStatus(items('failed', 'interrupted')), 'failed');
    assert.equal(aggregateJobStatus(items('cancelled', 'cancelled')), 'cancelled');
    assert.equal(aggregateJobStatus(items('completed', 'failed')), 'partial');
});
