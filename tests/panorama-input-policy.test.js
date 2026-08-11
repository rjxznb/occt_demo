import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaInputPolicy } from '../src/panorama/PanoramaInputPolicy.js';

function keyEvent(code, { repeat = false } = {}) {
    return {
        code,
        repeat,
        prevented: false,
        preventDefault() { this.prevented = true; },
    };
}

test('browse mode returns one-shot WASD direction commands', () => {
    const policy = new PanoramaInputPolicy();
    const expectations = new Map([
        ['KeyW', 'forward'],
        ['KeyS', 'backward'],
        ['KeyA', 'left'],
        ['KeyD', 'right'],
    ]);

    for (const [code, command] of expectations) {
        const event = keyEvent(code);
        assert.equal(policy.handleKeyDown(event), command);
        assert.equal(event.prevented, true);
    }
    assert.deepEqual(policy.getMovementIntent(), { forward: 0, right: 0 });
});

test('browse mode ignores repeated WASD and leaves arrow keys unhandled', () => {
    const policy = new PanoramaInputPolicy();
    const repeated = keyEvent('KeyW', { repeat: true });
    const arrow = keyEvent('ArrowUp');

    assert.equal(policy.handleKeyDown(repeated), null);
    assert.equal(policy.handleKeyDown(arrow), null);
    assert.equal(repeated.prevented, false);
    assert.equal(arrow.prevented, false);
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
