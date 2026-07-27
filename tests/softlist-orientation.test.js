import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import ParseJson from '../src/utils/json_parse.js';
import * as ParametricModelLoader from '../src/components/ParametricModelLoader.js';

const EPSILON = 1e-9;

function assertVector(actual, expected) {
    assert.ok(actual.distanceTo(expected) < EPSILON,
        `expected (${expected.x}, ${expected.y}, ${expected.z}), got (${actual.x}, ${actual.y}, ${actual.z})`);
}

test('soft-list rotation combines the outer placement angle with the block inner angle', () => {
    const drawing = {
        final_room_list: [],
        final_space_dim_list: [],
        door_list: [],
        window_list: [],
        soft_list: [{
            TypeId: 'cabinet',
            BasePoint: 'X=10 Y=20 Z=0',
            OutRotateRadian: 90,
            OutXScale: 1,
            OutYScale: 1,
            OutZScale: 1,
            Points: ['X=0 Y=0 Z=0', 'X=1 Y=0 Z=0', 'X=1 Y=1 Z=0', 'X=0 Y=1 Z=0'],
            BlockInnerInfo: {
                '旋转角度': 15,
                '左右翻转': 1,
                '上下翻转': 1,
            },
        }],
    };

    const [softlist] = ParseJson(drawing).SoftLists;

    assert.equal(softlist.rotate, 105);
    assert.equal(softlist.horizontalFlip, true);
    assert.equal(softlist.verticalFlip, true);
});

test('plan transform flips in local XY before rotating into the world footprint', () => {
    assert.equal(typeof ParametricModelLoader.createPlanTransform, 'function');

    const matrix = ParametricModelLoader.createPlanTransform({
        basepoint: { x: 10, y: 20, z: 0 },
        rotate: 90,
        horizontalFlip: true,
        verticalFlip: false,
    });

    const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
    const localRight = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).sub(origin);
    const localUp = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).sub(origin);

    assertVector(origin, new THREE.Vector3(10, 20, 0));
    assertVector(localRight, new THREE.Vector3(0, -1, 0));
    assertVector(localUp, new THREE.Vector3(-1, 0, 0));
});
