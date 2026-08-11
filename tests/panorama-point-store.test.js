import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaPointStore } from '../src/panorama/PanoramaPointStore.js';
import { LocalPanoramaPointRepository } from '../src/panorama/PanoramaPointRepository.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

const ORIGINAL_POINTS = [
    {
        id: 'camera:a', name: '点位 A', x: 100, y: 200, z: 1500,
        yaw: 0, pitch: 0, fov: 90, valid: true, roomName: '客厅',
    },
    {
        id: 'camera:b', name: '点位 B', x: 500, y: 600, z: 1500,
        yaw: 30, pitch: 0, fov: 80, valid: true, roomName: '主卧',
    },
];

function createRepository(storage = new MemoryStorage()) {
    return new LocalPanoramaPointRepository({
        storage,
        clock: () => '2026-08-11T12:00:00.000Z',
        logger: { warn() {} },
    });
}

async function createStore({ storage, id = 'draft:new' } = {}) {
    const repository = createRepository(storage);
    const store = new PanoramaPointStore({
        repository,
        idFactory: () => id,
    });
    await store.initialize({
        originalPoints: ORIGINAL_POINTS,
        context: { planId: 'scheme', version: 'v1' },
    });
    return { store, repository };
}

test('keeps original points immutable while applying draft overrides', async () => {
    const originalInput = structuredClone(ORIGINAL_POINTS);
    const store = new PanoramaPointStore({ idFactory: () => 'draft:new' });

    await store.initialize({
        originalPoints: originalInput,
        context: { planId: 'scheme', version: 'v1' },
        draft: {
            overrides: { 'camera:a': { name: '客厅中央', x: 180 } },
            addedPoints: [{
                id: 'draft:new', name: '新增点', x: 900, y: 800, z: 1500,
                yaw: 0, pitch: 0, fov: 90, valid: true,
            }],
            deletedPointIds: ['camera:b'],
            initialPointId: 'draft:new',
            lastActivePointId: 'camera:a',
        },
    });

    const state = store.getState();
    assert.deepEqual(originalInput, ORIGINAL_POINTS);
    assert.deepEqual(state.points.map(point => [point.id, point.name, point.x]), [
        ['camera:a', '客厅中央', 180],
        ['draft:new', '新增点', 900],
    ]);
    assert.equal(state.initialPointId, 'draft:new');
    assert.equal(state.activePointId, 'camera:a');
    assert.deepEqual([...state.dirtyPointIds].sort(), ['camera:a', 'camera:b', 'draft:new']);

    assert.throws(() => {
        state.points[0].name = '外部篡改';
    }, TypeError);
    assert.equal(store.getState().points[0].name, '客厅中央');
});

test('supports point CRUD, initial fallback, and restoring one or all points', async () => {
    const { store } = await createStore();

    await store.renamePoint('camera:a', '客厅入口');
    await store.updatePoint('camera:a', { x: 240, z: 1650 });
    const added = await store.addPoint({
        name: '新点位', x: 800, y: 900, z: 1500,
        yaw: 0, pitch: 0, fov: 90, valid: true,
    });
    await store.setInitialPoint(added.id);
    await store.selectPoint(added.id);

    assert.equal(store.getState().initialPointId, 'draft:new');
    assert.equal(store.getState().activePointId, 'draft:new');

    await store.deletePoint('draft:new');
    assert.equal(store.getState().initialPointId, 'camera:a');
    assert.equal(store.getState().activePointId, 'camera:a');

    await store.restorePoint('camera:a');
    assert.deepEqual(
        store.getState().points.find(point => point.id === 'camera:a'),
        ORIGINAL_POINTS[0],
    );

    await store.deletePoint('camera:a');
    assert.equal(store.getState().activePointId, 'camera:b');
    await store.restoreAll();
    assert.deepEqual(store.getState().points, ORIGINAL_POINTS);
    assert.equal(store.getState().initialPointId, 'camera:a');
});

test('persists selection and an independent view for every point', async () => {
    const storage = new MemoryStorage();
    const { store } = await createStore({ storage });

    await store.updateView('camera:a', { yaw: 45, pitch: -5, fov: 100 });
    await store.updateView('camera:b', { yaw: 120, pitch: 4, fov: 70 });
    await store.selectPoint('camera:b');

    const restored = new PanoramaPointStore({
        repository: createRepository(storage),
        idFactory: () => 'draft:other',
    });
    await restored.initialize({
        originalPoints: ORIGINAL_POINTS,
        context: { planId: 'scheme', version: 'v1' },
    });

    const state = restored.getState();
    assert.equal(state.activePointId, 'camera:b');
    assert.deepEqual(state.views['camera:a'], { yaw: 45, pitch: -5, fov: 100 });
    assert.deepEqual(state.views['camera:b'], { yaw: 120, pitch: 4, fov: 70 });
});

test('notifies subscribers only when an operation changes observable state', async () => {
    const { store } = await createStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    assert.equal(await store.selectPoint('missing'), false);
    assert.equal(await store.renamePoint('camera:a', '点位 A'), false);
    assert.equal(notifications, 0);

    assert.equal(await store.renamePoint('camera:a', '新名称'), true);
    assert.equal(notifications, 1);
    unsubscribe();
    await store.renamePoint('camera:a', '再次修改');
    assert.equal(notifications, 1);
});
