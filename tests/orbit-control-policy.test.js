import test from 'node:test';
import assert from 'node:assert/strict';

import { configureOrbitControls } from '../src/core/OrbitControlPolicy.js';

test('camera controls rotate and pan more gently without changing zoom speed', () => {
    const controls = { zoomSpeed: 1 };

    assert.equal(configureOrbitControls(controls), controls);
    assert.equal(controls.enableDamping, true);
    assert.equal(controls.dampingFactor, 0.1);
    assert.equal(controls.rotateSpeed, 0.6);
    assert.equal(controls.panSpeed, 0.6);
    assert.equal(controls.zoomSpeed, 1);
});
