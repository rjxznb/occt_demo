import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaEditController } from '../src/panorama/PanoramaEditController.js';
import { PanoramaPointStore } from '../src/panorama/PanoramaPointStore.js';

const POINT = {
    id: 'camera:a', name: '点位 A', x: 100, y: 200, z: 1500,
    yaw: 0, pitch: 0, fov: 90, valid: true, roomIndex: 0, roomName: '客厅',
};

async function createController(options = {}) {
    const store = new PanoramaPointStore();
    await store.initialize({
        originalPoints: [POINT],
        context: { planId: 'scheme', version: 'v1' },
        draft: null,
    });
    const previews = [];
    const controller = new PanoramaEditController({
        store,
        movementSpeed: 100,
        validator: candidate => ({
            valid: candidate.x <= 250,
            code: candidate.x <= 250 ? 'OK' : 'BLOCKED',
            roomIndex: 0,
            roomName: '客厅',
        }),
        onPreview: preview => previews.push(structuredClone(preview)),
        ...options,
    });
    return { store, controller, previews };
}

test('previews continuous movement but writes the point only when saved', async () => {
    const { store, controller } = await createController();

    assert.equal(controller.enter('camera:a'), true);
    const moved = controller.applyMovement({ forward: 1, right: 0 }, 1);

    assert.equal(moved.valid, true);
    assert.equal(controller.getState().workingPoint.x, 200);
    assert.equal(controller.getState().workingPoint.y, 200);
    assert.equal(store.getState().points[0].x, 100);

    assert.equal(await controller.save(), true);
    assert.equal(store.getState().points[0].x, 200);
    assert.equal(controller.getState().mode, 'browse');
});

test('rejects invalid movement without changing the working point', async () => {
    const { controller } = await createController();
    controller.enter('camera:a');

    const rejected = controller.applyMovement({ forward: 1, right: 0 }, 2);

    assert.equal(rejected.valid, false);
    assert.equal(rejected.code, 'BLOCKED');
    assert.equal(controller.getState().workingPoint.x, 100);
    assert.equal(controller.getState().lastValidation.code, 'BLOCKED');
});

test('cancel restores the complete entry snapshot without dirtying the store', async () => {
    const { store, controller, previews } = await createController();
    controller.enter('camera:a');
    controller.applyMovement({ forward: 0, right: 1 }, 0.5);
    controller.updateView({ yaw: 70, pitch: -8, fov: 105 });

    assert.equal(controller.cancel(), true);

    assert.deepEqual(store.getState().points, [POINT]);
    assert.deepEqual(store.getState().dirtyPointIds, []);
    assert.deepEqual(previews.at(-1), {
        point: POINT,
        view: { yaw: 0, pitch: 0, fov: 90 },
    });
    assert.equal(controller.getState().mode, 'browse');
});

test('applies named height presets and clamps fine adjustments', async () => {
    const { controller } = await createController({
        heightPresets: { child: 1200, standard: 1500, high: 1850 },
        minHeight: 1000,
        maxHeight: 1900,
    });
    controller.enter('camera:a');

    assert.equal(controller.setHeightPreset('child'), true);
    assert.equal(controller.getState().workingPoint.z, 1200);
    assert.equal(controller.nudgeHeight(-500), true);
    assert.equal(controller.getState().workingPoint.z, 1000);
    assert.equal(controller.setHeightPreset('high'), true);
    assert.equal(controller.getState().workingPoint.z, 1850);
    assert.equal(controller.nudgeHeight(500), true);
    assert.equal(controller.getState().workingPoint.z, 1900);
    assert.equal(controller.setHeightPreset('missing'), false);
});
