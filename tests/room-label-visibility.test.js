import test from 'node:test';
import assert from 'node:assert/strict';

import { RoomRenderer } from '../src/components/RoomRenderer.js';

test('room label visibility toggles every Sprite label and preserves the requested state', () => {
    const renderer = Object.create(RoomRenderer.prototype);
    const first = { visible: true };
    const second = { visible: true };
    renderer.roomLabels = [first, second];
    renderer.roomLabelsVisible = true;

    assert.equal(renderer.setRoomLabelsVisible(false), false);
    assert.equal(renderer.roomLabelsVisible, false);
    assert.equal(first.visible, false);
    assert.equal(second.visible, false);

    assert.equal(renderer.setRoomLabelsVisible(true), true);
    assert.equal(first.visible, true);
    assert.equal(second.visible, true);
});
