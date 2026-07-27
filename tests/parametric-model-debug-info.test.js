import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createParametricDebugInfo } from '../src/components/ParametricModelLoader.js';

test('parametric debug info captures source and placement data as plain values', () => {
    const item = {
        id: 'soft-7',
        typeId: '7001',
        basepoint: { x: 10, y: 20, z: 0 },
        footprint: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }],
        rotate: 75,
        horizontalFlip: true,
        verticalFlip: false,
        modelParams: [{ name: 'width', value: 100 }],
    };
    const worldBox = new THREE.Box3(
        new THREE.Vector3(1, 2, 0),
        new THREE.Vector3(101, 202, 300),
    );

    const info = createParametricDebugInfo(
        item,
        { typeName: '测试柜体', resId: 'res-1', defaultSize: { x: 1, y: 2, z: 3 } },
        {
            rawSize: new THREE.Vector3(1, 2, 3),
            baseScale: 1000,
            modelOffset: new THREE.Vector3(-0.5, 0.25, 0),
            worldPosition: new THREE.Vector3(10, 20, 0),
            worldBox,
        },
    );

    assert.equal(info.typeId, '7001');
    assert.equal(info.softlistId, 'soft-7');
    assert.equal(info.typeName, '测试柜体');
    assert.equal(info.transform.rotate, 75);
    assert.equal(info.transform.horizontalFlip, true);
    assert.deepEqual(info.placement.rawSize, { x: 1, y: 2, z: 3 });
    assert.deepEqual(info.placement.worldBounds.size, { x: 100, y: 200, z: 300 });
    assert.doesNotThrow(() => JSON.stringify(info));
    assert.equal(Object.values(info).some(value => value?.isObject3D), false);
});
