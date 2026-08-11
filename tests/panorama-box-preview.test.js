import test from 'node:test';
import assert from 'node:assert/strict';

import { panoramaUvForDirection } from '../src/components/PanoramaBoxPreview.js';

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('panorama box keeps +Y forward and scene Z vertical', () => {
    const front = panoramaUvForDirection(0, 1, 0);
    closeTo(front.u, 0.5);
    closeTo(front.v, 0.5);

    const right = panoramaUvForDirection(1, 0, 0);
    closeTo(right.u, 0.75);
    closeTo(right.v, 0.5);

    const top = panoramaUvForDirection(0, 0, 1);
    closeTo(top.u, 0.5);
    closeTo(top.v, 1);
});
