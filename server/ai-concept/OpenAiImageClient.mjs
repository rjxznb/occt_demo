import {
    ENVIRONMENT_CATALOG,
    STYLE_CATALOG,
} from '../../src/ai-concept/AiGenerationCatalog.js';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenAiImageError extends Error {
    constructor(code, message = code, {
        status = undefined,
        retryable = false,
        requestId = undefined,
    } = {}) {
        super(message);
        this.name = 'OpenAiImageError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.requestId = requestId;
    }
}

function safeError(code, options = {}) {
    const messages = {
        OPENAI_NOT_CONFIGURED: 'OpenAI image generation is not configured.',
        INVALID_REQUEST: 'The image edit request is invalid.',
        INVALID_CATALOG_SELECTION: 'The selected style or environment is unavailable.',
        INVALID_RESPONSE: 'The image service returned an invalid response.',
        AUTHENTICATION_ERROR: 'The image service rejected its server credentials.',
        RATE_LIMITED: 'The image service is temporarily rate limited.',
        QUOTA_EXHAUSTED: 'The image service quota is unavailable.',
        CONTENT_POLICY_VIOLATION: 'The image request was rejected by content policy.',
        UPSTREAM_UNAVAILABLE: 'The image service is temporarily unavailable.',
        UPSTREAM_ERROR: 'The image service rejected the request.',
        NETWORK_ERROR: 'The image service could not be reached.',
        TIMEOUT: 'The image service request timed out.',
        CANCELLED: 'The image request was cancelled.',
    };
    return new OpenAiImageError(code, messages[code] ?? 'Image generation failed.', options);
}

function catalogEntry(selection, catalog) {
    const id = typeof selection === 'string' ? selection : selection?.id;
    return catalog.find(item => item.id === id);
}

export function buildInteriorEditPrompt({ style, environment } = {}) {
    const selectedStyle = catalogEntry(style, STYLE_CATALOG);
    const selectedEnvironment = catalogEntry(environment, ENVIRONMENT_CATALOG);
    if (!selectedStyle || !selectedEnvironment) {
        throw safeError('INVALID_CATALOG_SELECTION');
    }

    return [
        'Create a photorealistic interior design rendering from this white-model image.',
        'Strictly preserve the original camera viewpoint, perspective, room dimensions, walls, openings, ceiling, fixed elements, and major furniture placement.',
        'Do not change the floor plan, structural geometry, window or door positions, or the spatial relationship of the existing objects.',
        'Return one normal eye-level interior photograph only; forbid plans, axonometric views, collages, text, watermarks, logos, and people.',
        `Design style: ${selectedStyle.prompt}.`,
        `Lighting and environment: ${selectedEnvironment.prompt}.`,
    ].join(' ');
}

function validateEditInput({ imageBytes, mimeType, prompt } = {}) {
    const bytes = Buffer.isBuffer(imageBytes)
        ? imageBytes
        : imageBytes instanceof Uint8Array
            ? Buffer.from(imageBytes)
            : null;
    if (!bytes?.length || typeof mimeType !== 'string' || !mimeType.startsWith('image/')
        || typeof prompt !== 'string' || !prompt.trim()) {
        throw safeError('INVALID_REQUEST');
    }
    return { bytes, mimeType, prompt: prompt.trim() };
}

async function responseJson(response) {
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

function upstreamCode(body) {
    return typeof body?.error?.code === 'string' ? body.error.code.toLowerCase() : '';
}

function classifyHttpError(response, body, requestId) {
    const status = response.status;
    const code = upstreamCode(body);
    const common = { status, requestId };

    if (code.includes('content_policy') || code.includes('moderation')) {
        return safeError('CONTENT_POLICY_VIOLATION', common);
    }
    if (code === 'insufficient_quota' || code.includes('quota_exhausted')) {
        return safeError('QUOTA_EXHAUSTED', common);
    }
    if (status === 401 || status === 403) {
        return safeError('AUTHENTICATION_ERROR', common);
    }
    if (status === 429) {
        return safeError('RATE_LIMITED', { ...common, retryable: true });
    }
    if (status >= 500) {
        return safeError('UPSTREAM_UNAVAILABLE', { ...common, retryable: true });
    }
    return safeError('UPSTREAM_ERROR', common);
}

function decodeOutput(body, requestId) {
    const base64 = body?.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || !base64.length || base64.length % 4 !== 0
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw safeError('INVALID_RESPONSE', { requestId });
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== base64) {
        throw safeError('INVALID_RESPONSE', { requestId });
    }
    return bytes;
}

export class OpenAiImageClient {
    constructor({
        apiKey,
        fetchImpl = globalThis.fetch,
        endpoint = DEFAULT_ENDPOINT,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = {}) {
        if (typeof apiKey !== 'string' || !apiKey.trim()) {
            throw safeError('OPENAI_NOT_CONFIGURED');
        }
        if (typeof fetchImpl !== 'function') throw safeError('INVALID_REQUEST');
        this.apiKey = apiKey.trim();
        this.fetchImpl = fetchImpl;
        this.endpoint = endpoint;
        this.timeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    }

    async edit(input = {}) {
        const { bytes, mimeType, prompt } = validateEditInput(input);
        const callerSignal = input.signal;
        const controller = new AbortController();
        let timedOut = false;
        const onCallerAbort = () => controller.abort(callerSignal.reason);
        if (callerSignal?.aborted) onCallerAbort();
        else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('Timed out', 'TimeoutError'));
        }, this.timeoutMs);

        const form = new FormData();
        form.append('model', 'gpt-image-2');
        form.append('image', new Blob([bytes], { type: mimeType }), 'white-model.webp');
        form.append('prompt', prompt);
        form.append('size', '1536x1024');
        form.append('quality', 'medium');
        form.append('output_format', 'png');

        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.apiKey}` },
                body: form,
                signal: controller.signal,
            });
            const requestId = response.headers?.get?.('x-request-id') ?? undefined;
            const body = await responseJson(response);
            if (!response.ok) throw classifyHttpError(response, body, requestId);
            return {
                bytes: decodeOutput(body, requestId),
                mimeType: 'image/png',
                usage: body?.usage ?? null,
                requestId,
            };
        } catch (error) {
            if (error instanceof OpenAiImageError) throw error;
            if (timedOut) throw safeError('TIMEOUT', { retryable: true });
            if (callerSignal?.aborted) throw safeError('CANCELLED');
            throw safeError('NETWORK_ERROR', { retryable: true });
        } finally {
            clearTimeout(timeout);
            callerSignal?.removeEventListener?.('abort', onCallerAbort);
        }
    }
}
