import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clampPanoramaHorizontalFov,
    horizontalToVerticalFov,
    normalizeAspect,
    verticalToHorizontalFov,
} from '../src/core/CameraFov.js';

const closeTo = (actual, expected, epsilon = 1e-6) => {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`,
    );
};

test('converts a 90 degree horizontal view to Three.js vertical FOV at 16:9', () => {
    closeTo(horizontalToVerticalFov(90, 16 / 9), 58.71550708558255);
});

test('round-trips horizontal and vertical FOV at 4:3', () => {
    const vertical = horizontalToVerticalFov(80, 4 / 3);

    closeTo(verticalToHorizontalFov(vertical, 4 / 3), 80);
});

test('uses 16:9 when the viewport aspect is invalid', () => {
    assert.equal(normalizeAspect(0), 16 / 9);
    assert.equal(normalizeAspect(Number.NaN), 16 / 9);
    closeTo(horizontalToVerticalFov(90, 0), 58.71550708558255);
});

test('clamps panorama horizontal FOV to the supported display range', () => {
    assert.equal(clampPanoramaHorizontalFov(10), 30);
    assert.equal(clampPanoramaHorizontalFov(75), 75);
    assert.equal(clampPanoramaHorizontalFov(140), 120);
});
