import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import * as ParametricModelLoader from '../src/components/ParametricModelLoader.js';

test('model offset preserves the JSON base-point to footprint-center relationship', () => {
    assert.equal(typeof ParametricModelLoader.computeModelPlacementOffset, 'function');

    const item = {
        basepoint: { x: 100, y: 200, z: 0 },
        rotate: 0,
        horizontalFlip: false,
        verticalFlip: false,
        footprint: [
            { x: 100, y: 200 },
            { x: 500, y: 200 },
            { x: 500, y: 800 },
            { x: 100, y: 800 },
        ],
    };
    const convertedModelBox = new THREE.Box3(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(1, 1, 2),
    );

    const offset = ParametricModelLoader.computeModelPlacementOffset(
        item,
        convertedModelBox,
        100,
    );

    // Footprint center is (300, 500), i.e. local (200, 300) mm from BasePoint.
    // At 100 scene units per OBJ unit this is (2, 3); subtract bbox center (0.5, 0).
    assert.ok(offset.distanceTo(new THREE.Vector3(1.5, 3, 0)) < 1e-9);
});
