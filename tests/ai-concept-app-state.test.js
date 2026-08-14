import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiConceptHarness } from './helpers/ai-concept-app-harness.js';

function selectedIds(state) {
    return state.views.filter(view => view.selected).map(view => view.id);
}

test('browsing keeps generation selection while editing blocks navigation and continue', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const before = selectedIds(app.getState());
    assert.equal(await app.selectRelativeView(1), true);
    assert.deepEqual(selectedIds(app.getState()), before);

    assert.equal(await app.enterEditMode(), true);
    assert.equal(await app.selectRelativeView(1), false);
    assert.equal(app.continueToConditions(), false);
    assert.equal(app.cancelEdit(), true);
    assert.equal(app.getState().phase, 'ready');
});

test('excluding and restoring an automatic view keeps the page usable', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const active = app.getState().activeViewId;
    assert.equal(await app.excludeView(active), true);
    assert.notEqual(app.getState().activeViewId, active);
    assert.equal(await app.restoreExcluded(), true);
    assert.equal(app.getState().views.find(view => view.id === active).status, 'available');
});

test('continue exposes every usable view and context without creating fake work', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const payload = app.continueToConditions();

    assert.deepEqual(Object.keys(payload).sort(), ['context', 'selectedViews']);
    const usable = app.getState().views.filter(view => view.valid !== false
        && !['excluded', 'disabled'].includes(view.status));
    assert.equal(payload.selectedViews.length, usable.length);
    assert.deepEqual(payload.selectedViews.map(view => view.id), usable.map(view => view.id));
    assert.ok(payload.selectedViews.some(view => view.selected === false));
    assert.equal(app.getState().phase, 'conditions');
    assert.equal(app.getState().tasks, undefined);
    assert.equal(app.getState().results, undefined);
});

test('saving an edit refreshes only that thumbnail while cancelling keeps the cache', async () => {
    const { app, captureCalls } = createAiConceptHarness();
    await app.init();
    await new Promise(resolve => setTimeout(resolve, 0));
    const active = app.getState().activeViewId;
    const initialCaptures = captureCalls.filter(call => call[0] === 'capture').length;

    await app.enterEditMode(active);
    app.nudgeHeight(50);
    await app.saveEdit();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(captureCalls.filter(call => call[0] === 'invalidate'), [['invalidate', active]]);
    assert.equal(captureCalls.filter(call => call[0] === 'capture').length, initialCaptures + 1);

    await app.enterEditMode(active);
    app.nudgeHeight(50);
    app.cancelEdit();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(captureCalls.filter(call => call[0] === 'invalidate').length, 1);

    app.dispose();
    assert.equal(captureCalls.filter(call => call[0] === 'dispose').length, 1);
});

test('camera interaction is locked in preview and enabled only while editing', async () => {
    const { app, calls, sceneManager } = createAiConceptHarness();
    await app.init();
    assert.equal(sceneManager.cameraInteractionEnabled, false);

    assert.equal(await app.enterEditMode(), true);
    assert.equal(sceneManager.cameraInteractionEnabled, true);

    assert.equal(app.cancelEdit(), true);
    assert.equal(sceneManager.cameraInteractionEnabled, false);

    assert.equal(await app.enterEditMode(), true);
    assert.notEqual(await app.saveEdit(), false);
    assert.equal(sceneManager.cameraInteractionEnabled, false);
    assert.deepEqual(
        calls.filter(call => call[0] === 'camera-interaction').map(call => call[1]),
        [false, true, false, true, false],
    );
});
