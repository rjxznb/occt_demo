import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiConceptHarness } from './helpers/ai-concept-app-harness.js';

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
