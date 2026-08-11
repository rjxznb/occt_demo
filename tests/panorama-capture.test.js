import test from 'node:test';
import assert from 'node:assert/strict';

import { CUBE_FACE_NAMES, equirectDirection } from '../src/components/PanoramaCapture.js';

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('panorama cube faces use the Three.js render-target order', () => {
    assert.deepEqual(CUBE_FACE_NAMES, ['+X', '-X', '+Y', '-Y', '+Z', '-Z']);
});

test('equirectangular directions keep scene Z vertical and +Y at panorama center', () => {
    const front = equirectDirection(0.5, 0.5);
    closeTo(front.x, 0);
    closeTo(front.y, 1);
    closeTo(front.z, 0);

    const right = equirectDirection(0.75, 0.5);
    closeTo(right.x, 1);
    closeTo(right.y, 0);
    closeTo(right.z, 0);

    const top = equirectDirection(0.5, 0);
    closeTo(top.x, 0);
    closeTo(top.y, 0);
    closeTo(top.z, 1);
});
