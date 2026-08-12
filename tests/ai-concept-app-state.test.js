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

test('continue exposes selected views and context without creating fake work', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const payload = app.continueToConditions();

    assert.deepEqual(Object.keys(payload).sort(), ['context', 'selectedViews']);
    assert.equal(payload.selectedViews.length, 1);
    assert.equal(app.getState().phase, 'conditions');
    assert.equal(app.getState().tasks, undefined);
    assert.equal(app.getState().results, undefined);
});
