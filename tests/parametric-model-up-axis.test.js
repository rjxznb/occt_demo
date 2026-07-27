import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import * as ParametricModelLoader from '../src/components/ParametricModelLoader.js';

test('parameterized OBJ Y-up axis is converted to the scene Z-up axis', () => {
    assert.equal(typeof ParametricModelLoader.createYUpToZUpTransform, 'function');

    const matrix = ParametricModelLoader.createYUpToZUpTransform();
    const sourceUp = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
    const sourceFront = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix);

    assert.ok(sourceUp.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9);
    assert.ok(sourceFront.distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-9);
});
