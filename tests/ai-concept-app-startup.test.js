import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiConceptHarness } from './helpers/ai-concept-app-harness.js';
import { descendants, findByDataset } from './helpers/fake-dom.js';

test('starts in the best primary room candidate using white model fixed view', async () => {
    const { app, calls } = createAiConceptHarness();
    assert.equal(await app.init(), true);
    const state = app.getState();

    assert.equal(state.phase, 'ready');
    assert.equal(state.views.length, 3);
    assert.equal(state.views.filter(view => view.selected).length, 1);
    assert.deepEqual(calls.slice(0, 4).map(call => call[0]), ['load', 'render', 'room-labels', 'ceilings']);
    assert.ok(calls.some(call => call[0] === 'white' && call[1] === false));
    assert.ok(calls.some(call => call[0] === 'camera'));
    assert.ok(calls.some(call => call[0] === 'animate'));
});
test('shows a recoverable error when scene loading fails', async () => {
    const { app, documentRef } = createAiConceptHarness({ loader: async () => { throw new Error('drawing missing'); } });
    assert.equal(await app.init(), false);
    assert.equal(app.getState().phase, 'error');
    assert.equal(documentRef.getElementById('ai-concept-error').hidden, false);
    assert.equal(documentRef.getElementById('ai-concept-error-message').textContent, 'drawing missing');
});

test('waits for content models before generating views and thumbnails', async () => {
    let resolveContent;
    const contentLoad = new Promise(resolve => { resolveContent = resolve; });
    const { app, calls, captureCalls, roomRenderer } = createAiConceptHarness();
    roomRenderer.render = async (data, registry) => {
        calls.push(['render', data, registry]);
        return { contentLoad };
    };

    const initialization = app.init();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.some(call => call[0] === 'camera'), false);
    assert.equal(captureCalls.some(call => call[0] === 'capture'), false);

    resolveContent({ summary: { placed: 1 }, failures: [] });
    assert.equal(await initialization, true);
    assert.ok(calls.some(call => call[0] === 'camera'));
    assert.ok(captureCalls.some(call => call[0] === 'capture'));
});

test('starts thumbnail capture in the background and renders the linked mini-map', async () => {
    let resolveCapture;
    const captureDeferred = {
        promise: new Promise(resolve => { resolveCapture = resolve; }),
    };
    const { app, captureCalls, documentRef, roomRenderer, sceneManager } = createAiConceptHarness({ captureDeferred });

    assert.equal(await app.init(), true, 'ready state does not wait for thumbnail encoding');
    assert.deepEqual(captureCalls[0], ['create', roomRenderer.sceneGroup, sceneManager.getRenderer()]);
    assert.ok(captureCalls.some(call => call[0] === 'capture'));
    const filmstrip = documentRef.getElementById('ai-concept-filmstrip');
    assert.ok(descendants(filmstrip).some(element => element.dataset.thumbnailState === 'loading'));
    const minimap = documentRef.getElementById('ai-concept-minimap');
    assert.ok(descendants(minimap).some(element => element.dataset.viewId));

    resolveCapture({ status: 'ready', url: 'blob:first', cacheKey: 'first' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(descendants(filmstrip).some(element => element.dataset.thumbnailState === 'ready'));
});

test('mini-map selection activates and scrolls the matching candidate card', async () => {
    const { app, documentRef } = createAiConceptHarness();
    await app.init();
    const before = app.getState().activeViewId;
    const target = app.getState().views.find(view => view.id !== before);
    findByDataset(documentRef.getElementById('ai-concept-minimap'), 'viewId', target.id).click();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(app.getState().activeViewId, target.id);
    const filmstrip = documentRef.getElementById('ai-concept-filmstrip');
    const track = descendants(filmstrip)
        .find(element => element.classList.contains('ai-view-track'));
    assert.equal(track.scrollToOptions?.behavior, 'smooth');
});
