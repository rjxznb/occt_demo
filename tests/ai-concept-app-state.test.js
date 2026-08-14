import test from 'node:test';
import assert from 'node:assert/strict';

import { createAiConceptHarness } from './helpers/ai-concept-app-harness.js';

function selectedIds(state) {
    return state.views.filter(view => view.selected).map(view => view.id);
}

function focusVisibility(documentRef) {
    return Object.fromEntries([
        'ai-concept-filmstrip',
        'ai-concept-previous',
        'ai-concept-next',
        'ai-concept-primary-actions',
    ].map(id => [id, documentRef.getElementById(id).hidden]));
}

test('editing an existing view hides browsing and generation controls until cancel', async () => {
    const { app, documentRef } = createAiConceptHarness();
    await app.init();
    assert.deepEqual(focusVisibility(documentRef), {
        'ai-concept-filmstrip': false,
        'ai-concept-previous': false,
        'ai-concept-next': false,
        'ai-concept-primary-actions': false,
    });

    await app.enterEditMode();
    assert.ok(Object.values(focusVisibility(documentRef)).every(Boolean));

    app.cancelEdit();
    assert.ok(Object.values(focusVisibility(documentRef)).every(hidden => hidden === false));
});

test('adding a custom view hides browsing and generation controls until save', async () => {
    const { app, documentRef } = createAiConceptHarness();
    await app.init();

    await app.addCustomView();
    assert.ok(Object.values(focusVisibility(documentRef)).every(Boolean));

    await app.saveEdit();
    assert.ok(Object.values(focusVisibility(documentRef)).every(hidden => hidden === false));
});

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

test('automatic view deletion asks for confirmation before exclusion', async () => {
    const { app, calls } = createAiConceptHarness({ confirm: () => false });
    await app.init();
    const id = app.getState().activeViewId;

    assert.equal(await app.deleteView(id), false);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'available');
    assert.equal(calls.filter(call => call[0] === 'confirm').length, 1);
});

test('confirmed automatic view deletion keeps recoverable exclusion semantics', async () => {
    const { app } = createAiConceptHarness();
    await app.init();
    const id = app.getState().activeViewId;

    assert.equal(await app.deleteView(id), true);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'excluded');
    assert.equal(await app.restoreExcluded(), true);
    assert.equal(app.getState().views.find(view => view.id === id).status, 'available');
});

test('custom view deletion asks for confirmation and cancellation preserves it', async () => {
    const { app, calls } = createAiConceptHarness({ confirm: () => false });
    await app.init();
    const custom = await app.addCustomView();
    app.cancelEdit();

    assert.equal(await app.deleteView(custom.id), false);
    assert.ok(app.getState().views.some(view => view.id === custom.id));
    assert.equal(calls.filter(call => call[0] === 'confirm').length, 1);
});

test('continue opens generation conditions with every usable view and current context', async () => {
    const { app, dialogCalls, generationDialog } = createAiConceptHarness();
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
    const opened = dialogCalls.find(call => call[0] === 'open')?.[1];
    assert.equal(opened.viewCount, usable.length);
    assert.equal(opened.catalog.styles.length, 12);
    assert.equal(opened.catalog.environments.length, 4);
    assert.deepEqual(opened.conditions, {
        styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'],
    });

    generationDialog.handlers.onCancel();
    assert.equal(app.getState().phase, 'ready');
});

test('generation conditions restore their isolated draft and surface the unwired submit boundary', async () => {
    const saves = [];
    const repository = {
        async load(context) {
            assert.equal(context.planId, 'test-plan');
            return { ok: true, conditions: { styleIds: ['fresh-cream'], environmentIds: ['night-ambience'] } };
        },
        async save(context, conditions) { saves.push([context, conditions]); return { ok: true, conditions }; },
    };
    const { app, dialogCalls, generationDialog } = createAiConceptHarness({
        generationConditionRepository: repository,
    });
    await app.init();
    app.continueToConditions();
    assert.deepEqual(dialogCalls.find(call => call[0] === 'open')[1].conditions, {
        styleIds: ['fresh-cream'], environmentIds: ['night-ambience'],
    });

    await generationDialog.handlers.onSubmit({
        styleIds: ['fresh-cream'], environmentIds: ['night-ambience'],
    });
    assert.equal(saves.length, 1);
    assert.deepEqual(dialogCalls.at(-1), ['error', 'AI_GENERATION_CLIENT_NOT_READY']);
    assert.equal(app.getState().phase, 'conditions');
});

test('saving an edit refreshes only that thumbnail while cancelling keeps the cache', async () => {
    const { app, captureCalls, generationCaptureCalls } = createAiConceptHarness();
    await app.init();
    assert.equal(generationCaptureCalls.filter(call => call[0] === 'create').length, 1);
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
    assert.equal(generationCaptureCalls.filter(call => call[0] === 'dispose').length, 1);
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
