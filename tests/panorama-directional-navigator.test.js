import test from 'node:test';
import assert from 'node:assert/strict';

import { selectDirectionalPanoramaPoint } from '../src/panorama/PanoramaDirectionalNavigator.js';

const ACTIVE = { id: 'active', x: 0, y: 0, valid: true };

function choose(points, direction, yaw = 0) {
    return selectDirectionalPanoramaPoint({
        activePoint: ACTIVE,
        points: [ACTIVE, ...points],
        yaw,
        direction,
    });
}

test('uses the project Z-up forward and right bases at yaw zero', () => {
    const forward = { id: 'forward', x: 100, y: 0, valid: true };
    const right = { id: 'right', x: 0, y: -100, valid: true };
    const points = [forward, right];

    assert.equal(choose(points, 'forward'), forward);
    assert.equal(choose(points, 'right'), right);
});

test('rotates forward, backward, left, and right with the live camera yaw', () => {
    const north = { id: 'north', x: 0, y: 100, valid: true };
    const south = { id: 'south', x: 0, y: -100, valid: true };
    const east = { id: 'east', x: 100, y: 0, valid: true };
    const west = { id: 'west', x: -100, y: 0, valid: true };
    const points = [north, south, east, west];

    assert.equal(choose(points, 'forward', 90), north);
    assert.equal(choose(points, 'backward', 90), south);
    assert.equal(choose(points, 'right', 90), east);
    assert.equal(choose(points, 'left', 90), west);
});

test('rejects candidates outside the sixty-degree direction cone', () => {
    const angle = 70 * Math.PI / 180;
    const outside = {
        id: 'outside',
        x: Math.cos(angle) * 100,
        y: Math.sin(angle) * 100,
        valid: true,
    };

    assert.equal(choose([outside], 'forward'), null);
});

test('prefers angular alignment before planar distance', () => {
    const nearDiagonal = { id: 'near', x: 60, y: 30, valid: true };
    const farAligned = { id: 'far', x: 300, y: 0, valid: true };

    assert.equal(choose([nearDiagonal, farAligned], 'forward'), farAligned);
});

test('prefers the nearest point when angular alignment is equal', () => {
    const far = { id: 'far', x: 300, y: 0, valid: true };
    const near = { id: 'near', x: 100, y: 0, valid: true };

    assert.equal(choose([far, near], 'forward'), near);
});

test('keeps original point order when angle and distance are equal', () => {
    const first = { id: 'first', x: 100, y: 100, valid: true };
    const second = { id: 'second', x: 100, y: -100, valid: true };

    assert.equal(choose([first, second], 'forward'), first);
});

test('excludes the active point, invalid points, and coincident points', () => {
    const coincident = { id: 'same-place', x: 0, y: 0, valid: true };
    const invalid = { id: 'invalid', x: 100, y: 0, valid: false };

    assert.equal(choose([coincident, invalid], 'forward'), null);
    assert.equal(selectDirectionalPanoramaPoint({
        activePoint: null,
        points: [],
        yaw: 0,
        direction: 'forward',
    }), null);
});

