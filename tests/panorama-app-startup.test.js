import test from 'node:test';
import assert from 'node:assert/strict';

import { cameraRecord, createHarness, sceneData } from './helpers/panorama-app-harness.js';

test('loads, renders, forces white model, shows ceilings, and enters the initial point', async () => {
    const { app, calls, documentRef } = createHarness();

    assert.equal(await app.init(), true);

    assert.deepEqual(calls.map(call => call[0]), [
        'load', 'render', 'white', 'ceilings', 'camera', 'animate',
    ]);
    assert.deepEqual(calls.find(call => call[0] === 'white'), ['white', false]);
    assert.equal(documentRef.getElementById('panorama-loading').hidden, true);
    assert.equal(documentRef.getElementById('panorama-error').hidden, true);
    assert.equal(documentRef.getElementById('panorama-empty').hidden, true);
    assert.equal(documentRef.getElementById('panorama-point-name').textContent, '点位 A');
    assert.equal(app.getState().phase, 'ready');
});

test('shows first-point guidance instead of entering an orbit view when cameras are absent', async () => {
    const { app, calls, documentRef } = createHarness({ cameraList: [] });

    assert.equal(await app.init(), true);

    assert.equal(calls.some(call => call[0] === 'camera'), false);
    assert.equal(calls.some(call => call[0] === 'ceilings'), false);
    assert.equal(documentRef.getElementById('panorama-empty').hidden, false);
    assert.equal(app.getState().phase, 'empty');
});

test('shows a recoverable error and retry initializes one fresh runtime', async () => {
    let attempts = 0;
    const harness = createHarness({
        loader: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('drawing unavailable');
            return sceneData([cameraRecord(1000, 1000, '恢复点位')]);
        },
    });

    assert.equal(await harness.app.init(), false);
    assert.equal(harness.documentRef.getElementById('panorama-error').hidden, false);
    assert.equal(harness.documentRef.getElementById('panorama-error-message').textContent, 'drawing unavailable');

    assert.equal(await harness.app.retry(), true);
    assert.equal(attempts, 2);
    assert.equal(harness.calls.filter(call => call[0] === 'animate').length, 1);
    assert.equal(harness.app.getState().phase, 'ready');
});

