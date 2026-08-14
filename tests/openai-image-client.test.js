import test from 'node:test';
import assert from 'node:assert/strict';

import {
    OpenAiImageClient,
    OpenAiImageError,
    buildInteriorEditPrompt,
} from '../server/ai-concept/OpenAiImageClient.mjs';

function jsonResponse(body, { status = 200, requestId = 'req_test' } = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
            'x-request-id': requestId,
        },
    });
}

test('image edit sends the fixed GPT Image 2 multipart contract and decodes PNG output', async () => {
    let request;
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        fetchImpl: async (url, options) => {
            request = { url, options };
            return jsonResponse({
                data: [{ b64_json: Buffer.from('generated-png').toString('base64') }],
                usage: { input_tokens: 123, output_tokens: 456 },
            }, { requestId: 'req_success' });
        },
    });

    const result = await client.edit({
        imageBytes: Buffer.from('white-model-webp'),
        mimeType: 'image/webp',
        prompt: 'Preserve the room and apply the selected style.',
    });

    assert.equal(request.url, 'https://api.openai.com/v1/images/edits');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer sk-test-secret');
    assert.ok(request.options.body instanceof FormData);
    assert.deepEqual([...request.options.body.keys()], [
        'model', 'image', 'prompt', 'size', 'quality', 'output_format',
    ]);
    assert.equal(request.options.body.get('model'), 'gpt-image-2');
    assert.equal(request.options.body.get('prompt'), 'Preserve the room and apply the selected style.');
    assert.equal(request.options.body.get('size'), '1536x1024');
    assert.equal(request.options.body.get('quality'), 'medium');
    assert.equal(request.options.body.get('output_format'), 'png');
    const image = request.options.body.get('image');
    assert.ok(image instanceof Blob);
    assert.equal(image.type, 'image/webp');
    assert.equal(Buffer.from(await image.arrayBuffer()).toString(), 'white-model-webp');
    assert.equal(result.bytes.toString(), 'generated-png');
    assert.equal(result.mimeType, 'image/png');
    assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 456 });
    assert.equal(result.requestId, 'req_success');
});

test('image edit rejects malformed successful responses without exposing the upstream body', async () => {
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        fetchImpl: async () => jsonResponse({ data: [{ unexpected: 'private-upstream-value' }] }),
    });

    await assert.rejects(
        client.edit({ imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit' }),
        error => {
            assert.ok(error instanceof OpenAiImageError);
            assert.equal(error.code, 'INVALID_RESPONSE');
            assert.equal(error.retryable, false);
            assert.doesNotMatch(error.message, /private-upstream-value|sk-test-secret/);
            return true;
        },
    );
});

test('image edit aborts on timeout and classifies it as retryable', async () => {
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        timeoutMs: 5,
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });

    await assert.rejects(
        client.edit({ imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit' }),
        error => error instanceof OpenAiImageError
            && error.code === 'TIMEOUT'
            && error.retryable === true,
    );
});

test('caller cancellation is non-retryable', async () => {
    const controller = new AbortController();
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            controller.abort();
        }),
    });

    await assert.rejects(
        client.edit({
            imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit', signal: controller.signal,
        }),
        error => error instanceof OpenAiImageError
            && error.code === 'CANCELLED'
            && error.retryable === false,
    );
});

for (const scenario of [
    { status: 401, upstreamCode: 'invalid_api_key', code: 'AUTHENTICATION_ERROR', retryable: false },
    { status: 403, upstreamCode: 'access_denied', code: 'AUTHENTICATION_ERROR', retryable: false },
    { status: 429, upstreamCode: 'rate_limit_exceeded', code: 'RATE_LIMITED', retryable: true },
    { status: 429, upstreamCode: 'insufficient_quota', code: 'QUOTA_EXHAUSTED', retryable: false },
    { status: 500, upstreamCode: 'server_error', code: 'UPSTREAM_UNAVAILABLE', retryable: true },
]) {
    test(`image edit maps HTTP ${scenario.status} ${scenario.upstreamCode} safely`, async () => {
        const client = new OpenAiImageClient({
            apiKey: 'sk-test-secret',
            fetchImpl: async () => jsonResponse({
                error: { code: scenario.upstreamCode, message: 'private upstream diagnostic' },
            }, { status: scenario.status, requestId: 'req_failure' }),
        });

        await assert.rejects(
            client.edit({ imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit' }),
            error => {
                assert.ok(error instanceof OpenAiImageError);
                assert.equal(error.code, scenario.code);
                assert.equal(error.status, scenario.status);
                assert.equal(error.retryable, scenario.retryable);
                assert.equal(error.requestId, 'req_failure');
                assert.doesNotMatch(error.message, /private upstream diagnostic|sk-test-secret/);
                return true;
            },
        );
    });
}

test('image edit maps content policy responses to a non-retryable safe error', async () => {
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        fetchImpl: async () => jsonResponse({
            error: { code: 'content_policy_violation', message: 'private moderation detail' },
        }, { status: 400 }),
    });

    await assert.rejects(
        client.edit({ imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit' }),
        error => error instanceof OpenAiImageError
            && error.code === 'CONTENT_POLICY_VIOLATION'
            && error.status === 400
            && error.retryable === false
            && !error.message.includes('private moderation detail'),
    );
});

test('image edit classifies network failures as retryable without leaking their message', async () => {
    const client = new OpenAiImageClient({
        apiKey: 'sk-test-secret',
        fetchImpl: async () => { throw new Error('socket contained private infrastructure name'); },
    });

    await assert.rejects(
        client.edit({ imageBytes: Buffer.from('x'), mimeType: 'image/webp', prompt: 'edit' }),
        error => error instanceof OpenAiImageError
            && error.code === 'NETWORK_ERROR'
            && error.retryable === true
            && !error.message.includes('private infrastructure name'),
    );
});

test('interior prompt preserves structure, forbids presentation artifacts, and uses catalog-owned fragments', () => {
    const prompt = buildInteriorEditPrompt({
        style: { id: 'modern-minimalist', prompt: 'untrusted-style-fragment' },
        environment: { id: 'sunny-day', prompt: 'untrusted-environment-fragment' },
    });

    for (const required of [
        'camera viewpoint', 'perspective', 'room dimensions', 'walls', 'openings', 'ceiling',
        'fixed elements', 'major furniture placement', 'plans', 'axonometric views', 'collages',
        'text', 'watermarks', 'logos', 'people', 'modern minimalist interior', 'bright sunny daytime',
    ]) assert.match(prompt, new RegExp(required, 'i'));
    assert.doesNotMatch(prompt, /untrusted-style-fragment|untrusted-environment-fragment/);
});

test('interior prompt rejects unknown catalog entries', () => {
    assert.throws(
        () => buildInteriorEditPrompt({ style: 'not-a-style', environment: 'sunny-day' }),
        error => error instanceof OpenAiImageError && error.code === 'INVALID_CATALOG_SELECTION',
    );
});
