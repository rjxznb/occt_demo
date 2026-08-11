import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaInputPolicy } from '../src/panorama/PanoramaInputPolicy.js';

function keyEvent(code) {
    return {
        code,
        prevented: false,
        preventDefault() { this.prevented = true; },
    };
}

test('browse mode ignores movement keys without preventing ordinary page input', () => {
    const policy = new PanoramaInputPolicy();
    const event = keyEvent('KeyW');

    assert.equal(policy.handleKeyDown(event), null);
    assert.equal(event.prevented, false);
    assert.deepEqual(policy.getMovementIntent(), { forward: 0, right: 0 });
});

test('edit mode tracks continuous movement intent and clears it on exit', () => {
    const policy = new PanoramaInputPolicy();
    policy.setMode('edit');
    const forward = keyEvent('KeyW');
    const right = keyEvent('ArrowRight');

    assert.equal(policy.handleKeyDown(forward), 'forward');
    assert.equal(policy.handleKeyDown(right), 'right');
    assert.equal(forward.prevented, true);
    assert.equal(right.prevented, true);
    assert.deepEqual(policy.getMovementIntent(), { forward: 1, right: 1 });

    policy.handleKeyUp(keyEvent('KeyW'));
    assert.deepEqual(policy.getMovementIntent(), { forward: 0, right: 1 });
    policy.setMode('browse');
    assert.deepEqual(policy.getMovementIntent(), { forward: 0, right: 0 });
});

test('reset clears pressed keys after window focus is lost', () => {
    const policy = new PanoramaInputPolicy();
    policy.setMode('edit');
    policy.handleKeyDown(keyEvent('KeyS'));
    policy.handleKeyDown(keyEvent('KeyA'));

    policy.reset();

    assert.deepEqual(policy.getMovementIntent(), { forward: 0, right: 0 });
});
