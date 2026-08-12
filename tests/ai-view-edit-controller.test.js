import test from 'node:test';
import assert from 'node:assert/strict';

import { AiViewEditController } from '../src/ai-concept/AiViewEditController.js';

function createHarness({ validator = point => ({ valid: true, code: 'OK', roomIndex: 0, roomName: '客厅' }) } = {}) {
    const original = {
        id: 'view-a', roomId: 'room-0', roomIndex: 0, roomName: '客厅',
        name: '入口广角', source: 'auto', status: 'available', selected: true,
        valid: true, x: 1000, y: 1000, z: 1500, yaw: 0, pitch: 0, fov: 86,
    };
    const updates = [];
    const previews = [];
    const store = {
        state: { views: [structuredClone(original)] },
        getState() { return structuredClone(this.state); },
        async updateView(id, patch) {
            updates.push([id, structuredClone(patch)]);
            this.state.views[0] = { ...this.state.views[0], ...patch };
            return true;
        },
    };
    const controller = new AiViewEditController({
        store,
        validator,
        movementSpeed: 120,
        onPreview: value => previews.push(structuredClone(value)),
    });
    return { controller, original, store, updates, previews };
}

test('moves in the current view direction and rejects invalid candidates', () => {
    let valid = true;
    const { controller } = createHarness({
        validator: point => valid
            ? { valid: true, code: 'OK', roomIndex: 0, roomName: '客厅' }
            : { valid: false, code: 'BLOCKED' },
    });
    controller.enter('view-a', { yaw: 90, pitch: 0, fov: 86 });
    const moved = controller.applyMovement({ forward: 1 }, 0.5, { yaw: 90, pitch: 0, fov: 86 });
    assert.equal(moved.valid, true);
    assert.ok(Math.abs(controller.getState().workingView.y - 1060) < 1e-9);

    valid = false;
    assert.deepEqual(controller.applyMovement({ forward: 1 }, 0.5), { valid: false, code: 'BLOCKED' });
    assert.ok(Math.abs(controller.getState().workingView.y - 1060) < 1e-9);
});

test('cancel restores the exact entry pose', () => {
    const { controller, original, previews } = createHarness();
    controller.enter('view-a', { yaw: 35, pitch: -2, fov: 82 });
    controller.applyMovement({ forward: 1 }, 0.5, { yaw: 35, pitch: -2, fov: 82 });
    assert.equal(controller.cancel(), true);
    assert.deepEqual(previews.at(-1), {
        point: original,
        view: { yaw: 35, pitch: -2, fov: 82 },
    });
    assert.equal(controller.getState().mode, 'browse');
});

test('save validates once more and marks an automatic view adjusted', async () => {
    const { controller, updates } = createHarness();
    controller.enter('view-a');
    controller.updateView({ yaw: 50, pitch: 2, fov: 90 });
    assert.equal(await controller.save(), true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1].status, 'adjusted');
    assert.equal(updates[0][1].yaw, 50);
    assert.equal(controller.getState().mode, 'browse');
});

test('save remains in edit mode when the working position becomes invalid', async () => {
    const { controller, updates } = createHarness({
        validator: () => ({ valid: false, code: 'TOO_CLOSE_TO_WALL' }),
    });
    controller.enter('view-a');
    assert.deepEqual(await controller.save(), { valid: false, code: 'TOO_CLOSE_TO_WALL' });
    assert.equal(updates.length, 0);
    assert.equal(controller.getState().mode, 'edit');
});
