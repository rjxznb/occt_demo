import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererHostClient, resolveRendererTabId } from '../src/core/RendererHostClient.js';

class FakeWindow {
    constructor() {
        this.listeners = new Map();
        this.location = { origin: 'https://renderer.local', pathname: '/preview3d/index.html' };
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    setTimeout(callback, delay) {
        return setTimeout(callback, delay);
    }

    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
    }

    emitMessage(source, data, origin = 'https://renderer.local') {
        this.listeners.get('message')?.({ source, data, origin });
    }
}

test('resolves the CAD outer tab from each embedded page path', () => {
    assert.equal(resolveRendererTabId({ pathname: '/preview3d/index.html' }), 'page-2');
    assert.equal(resolveRendererTabId({ pathname: '/preview-panorama/index.html' }), 'page-3');
    assert.equal(resolveRendererTabId({ pathname: '/preview-ai-concept/index.html' }), 'page-4');
    assert.equal(resolveRendererTabId({ pathname: '/index-panorama.html' }), 'page-3');
    assert.equal(resolveRendererTabId({ pathname: '/index-ai-concept.html' }), 'page-4');
});

function createHarness(defaultTimeoutMs = 50) {
    const selfWindow = new FakeWindow();
    const sent = [];
    const diagnostics = [];
    selfWindow.__renderPreviewDiagnostic = (stage, code) => {
        diagnostics.push({ stage, code });
    };
    const parentWindow = {
        location: { origin: 'https://renderer.local' },
        postMessage(message, targetOrigin) {
            sent.push({ message, targetOrigin });
        },
    };
    const client = new RendererHostClient({
        selfWindow,
        parentWindow,
        tabId: 'page-2',
        defaultTimeoutMs,
    });
    return { selfWindow, parentWindow, sent, diagnostics, client };
}

test('invoke pairs a renderer-preview result with its request', async () => {
    const selfWindow = new FakeWindow();
    const sent = [];
    const parentWindow = {
        location: { origin: 'https://renderer.local' },
        postMessage(message, targetOrigin) {
            sent.push({ message, targetOrigin });
        },
    };
    const client = new RendererHostClient({
        selfWindow,
        parentWindow,
        tabId: 'page-2',
        defaultTimeoutMs: 50,
    });

    const pending = client.invoke('getParametricGoodsDetail', { resId: '42' });
    const request = sent[0].message;
    assert.equal(request.channel, 'renderer-preview');
    assert.equal(request.version, 1);
    assert.equal(request.tabId, 'page-2');
    assert.equal(request.type, 'invoke');
    assert.equal(sent[0].targetOrigin, 'https://renderer.local');

    selfWindow.emitMessage(parentWindow, {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { data: { id: 42 } },
    });

    assert.deepEqual(await pending, { data: { id: 42 } });
    client.dispose();
});

test('supports a local CAD outer page with a virtual-host iframe', async () => {
    const selfWindow = new FakeWindow();
    const sent = [];
    const parentWindow = {
        location: { origin: 'null' },
        postMessage(message, targetOrigin) {
            sent.push({ message, targetOrigin });
        },
    };
    const client = new RendererHostClient({
        selfWindow,
        parentWindow,
        tabId: 'page-2',
        defaultTimeoutMs: 50,
    });

    const pending = client.invoke('getContentGoodsDetails', { resIds: ['42'] });
    const request = sent[0].message;
    assert.equal(sent[0].targetOrigin, '*');

    selfWindow.emitMessage(parentWindow, {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { items: [{ id: '42' }] },
    }, 'null');

    assert.deepEqual(await pending, { items: [{ id: '42' }] });
    client.dispose();
});

test('ignores results from an unrelated source or origin', async () => {
    const { selfWindow, parentWindow, sent, client } = createHarness();
    const pending = client.invoke('getParametricGoodsDetail', { resId: '42' });
    const request = sent[0].message;
    const result = {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { data: { id: 42 } },
    };
    selfWindow.emitMessage({}, result);
    assert.equal(client.pending.size, 1);
    selfWindow.emitMessage(parentWindow, result, 'https://untrusted.invalid');
    assert.equal(client.pending.size, 1);
    selfWindow.emitMessage(parentWindow, result);
    assert.deepEqual(await pending, { data: { id: 42 } });
    client.dispose();
});

test('rejects timed out requests with TIMEOUT', async () => {
    const { client } = createHarness(5);
    await assert.rejects(
        client.invoke('getParametricGoodsDetail', { resId: '42' }),
        error => error.code === 'TIMEOUT',
    );
    assert.equal(client.pending.size, 0);
    client.dispose();
});

test('emits only fixed RPC diagnostic stages for success and timeout', async () => {
    const successHarness = createHarness();
    const pending = successHarness.client.invoke('getParametricGoodsDetail', {
        resId: 'sensitive-resource-id',
    });
    const request = successHarness.sent[0].message;
    successHarness.selfWindow.emitMessage(successHarness.parentWindow, {
        channel: 'renderer-preview',
        version: 1,
        tabId: 'page-2',
        type: 'result',
        requestId: request.requestId,
        ok: true,
        payload: { data: { secret: 'must-not-be-diagnostic' } },
    });
    await pending;
    assert.deepEqual(successHarness.diagnostics, [
        { stage: 'rpc-client-ready', code: 'PAGE_2' },
        { stage: 'rpc-send', code: 'OK' },
        { stage: 'rpc-result', code: 'OK' },
    ]);
    assert.doesNotMatch(JSON.stringify(successHarness.diagnostics),
        /sensitive-resource-id|must-not-be-diagnostic/);
    successHarness.client.dispose();

    const timeoutHarness = createHarness(5);
    await assert.rejects(
        timeoutHarness.client.invoke('getParametricGoodsDetail', { resId: '42' }),
        error => error.code === 'TIMEOUT',
    );
    assert.deepEqual(timeoutHarness.diagnostics, [
        { stage: 'rpc-client-ready', code: 'PAGE_2' },
        { stage: 'rpc-send', code: 'OK' },
        { stage: 'rpc-timeout', code: 'TIMEOUT' },
    ]);
    timeoutHarness.client.dispose();
});

test('dispose rejects pending calls with CANCELLED and removes the listener', async () => {
    const { selfWindow, client } = createHarness();
    const pending = client.invoke('convertParametricModel', { url: 'https://model.test/a' });
    client.dispose();
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    assert.equal(client.pending.size, 0);
    assert.equal(selfWindow.listeners.has('message'), false);
});
