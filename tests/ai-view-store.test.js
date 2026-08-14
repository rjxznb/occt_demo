import test from 'node:test';
import assert from 'node:assert/strict';

import { AiViewStore } from '../src/ai-concept/AiViewStore.js';

const context = { planId: 'plan-a', version: 'v1' };

function view(id, overrides = {}) {
    return {
        id,
        planId: context.planId,
        planVersion: context.version,
        roomId: 'room-0',
        roomIndex: 0,
        roomName: '客厅',
        roomType: 'primary',
        name: id,
        x: 1000,
        y: 1000,
        z: 1500,
        yaw: 0,
        pitch: 0,
        fov: 86,
        source: 'auto',
        status: 'available',
        selected: false,
        valid: true,
        ...overrides,
    };
}

class MemoryRepository {
    constructor(draft = null) {
        this.draft = draft;
        this.calls = [];
    }
    async load(planId, version) {
        this.calls.push(['load', planId, version]);
        return { ok: true, draft: structuredClone(this.draft) };
    }
    async save(planId, version, draft) {
        this.calls.push(['save', planId, version]);
        this.draft = structuredClone(draft);
        return { ok: true };
    }
}

async function createStore({ repository = null, generatedViews = null } = {}) {
    const store = new AiViewStore({
        repository,
        idFactory: () => 'custom-generated',
        clock: () => '2026-08-12T09:00:00.000Z',
    });
    await store.initialize({
        generatedViews: generatedViews ?? [
            view('best', { selected: true, score: 100 }),
            view('second', { score: 80 }),
        ],
        roomResults: [{ roomId: 'room-0', roomName: '客厅', status: 'ready' }],
        context,
    });
    return store;
}

test('active view changes without changing generation selection', async () => {
    const store = await createStore();
    await store.setActiveView('second');
    const state = store.getState();

    assert.equal(state.activeViewId, 'second');
    assert.deepEqual(state.views.filter(candidate => candidate.selected).map(candidate => candidate.id), ['best']);
    assert.equal(state.canContinue, true);
});

test('generation can continue when usable views are not manually selected', async () => {
    const store = await createStore();
    await store.toggleSelected('best');

    assert.deepEqual(store.getState().views.filter(view => view.selected), []);
    assert.equal(store.getState().canContinue, true);
});

test('selection rejects invalid excluded and disabled views', async () => {
    const store = await createStore({ generatedViews: [
        view('valid'),
        view('invalid', { valid: false }),
        view('excluded', { status: 'excluded' }),
        view('disabled', { status: 'disabled' }),
    ] });

    assert.equal(await store.toggleSelected('valid'), true);
    assert.equal(await store.toggleSelected('invalid'), false);
    assert.equal(await store.toggleSelected('excluded'), false);
    assert.equal(await store.toggleSelected('disabled'), false);
});

test('automatic views are excluded and restored instead of deleted', async () => {
    const store = await createStore();
    assert.equal(await store.excludeView('best'), true);
    assert.equal(store.getState().views.find(candidate => candidate.id === 'best').status, 'excluded');
    assert.equal(store.getState().views.find(candidate => candidate.id === 'best').selected, false);
    assert.equal(store.getState().activeViewId, 'second');

    assert.equal(await store.restoreExcluded(), true);
    assert.equal(store.getState().views.find(candidate => candidate.id === 'best').status, 'available');
});

test('custom views are deleted after confirmation is handled by the caller', async () => {
    const store = await createStore();
    const added = await store.addCustomView(view('', { source: 'custom', name: '自定义视角' }));
    assert.equal(added.id, 'custom-generated');
    assert.equal(await store.deleteCustomView(added.id), true);
    assert.equal(store.getState().views.some(candidate => candidate.id === added.id), false);
});

test('views linked to work are disabled instead of deleted', async () => {
    const store = await createStore();
    const linked = await store.addCustomView(view('custom-linked', {
        source: 'custom',
        taskIds: ['task-1'],
    }));
    assert.equal(await store.deleteCustomView(linked.id), true);
    assert.equal(store.getState().views.find(candidate => candidate.id === linked.id).status, 'disabled');
});

test('restores a matching repository draft instead of generated candidates', async () => {
    const repository = new MemoryRepository({
        views: [view('saved', { selected: true, yaw: 35 })],
        roomResults: [{ roomId: 'room-0', roomName: '客厅', status: 'ready' }],
        activeViewId: 'saved',
        activeRoomId: 'room-0',
    });
    const store = await createStore({ repository });

    assert.equal(store.getState().views[0].id, 'saved');
    assert.equal(store.getState().views[0].yaw, 35);
    assert.equal(store.getState().draftRecovered, true);
    assert.deepEqual(repository.calls[0], ['load', 'plan-a', 'v1']);
});

test('persists updates with the current plan and version', async () => {
    const repository = new MemoryRepository();
    const store = await createStore({ repository });
    await store.toggleSelected('second');

    assert.deepEqual(repository.calls.at(-1), ['save', 'plan-a', 'v1']);
    assert.equal(repository.draft.views.find(candidate => candidate.id === 'second').selected, true);
});
