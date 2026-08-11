import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomRenderer } from '../src/components/RoomRenderer.js';

function createRenderer() {
    return new RoomRenderer({
        getScene: () => new THREE.Scene(),
        invalidateShadow() {},
    });
}

function triangleCentroids(geometry) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const triangles = index ? index.count / 3 : position.count / 3;
    const point = i => new THREE.Vector2(position.getX(i), position.getY(i));
    const centroids = [];
    for (let triangle = 0; triangle < triangles; triangle += 1) {
        const offset = triangle * 3;
        const ia = index ? index.getX(offset) : offset;
        const ib = index ? index.getX(offset + 1) : offset + 1;
        const ic = index ? index.getX(offset + 2) : offset + 2;
        centroids.push(point(ia).add(point(ib)).add(point(ic)).multiplyScalar(1 / 3));
    }
    return centroids;
}

test('valid outline rings create one sealed ceiling and preserve real holes', () => {
    const renderer = createRenderer();
    const outlineRings = {
        outer: [[0, 0], [1000, 0], [1000, 800], [0, 800]],
        holes: [[[400, 300], [600, 300], [600, 500], [400, 500]]],
    };
    const floorA = new THREE.Mesh(new THREE.PlaneGeometry(380, 800));
    const floorB = new THREE.Mesh(new THREE.PlaneGeometry(380, 800));

    const ceilings = renderer.createCeilingMeshes(outlineRings, [floorA, floorB]);

    assert.equal(ceilings.length, 1);
    assert.equal(ceilings[0].userData.ceilingSource, 'outline');
    assert.equal(ceilings[0].position.z, 2800);
    assert.equal(ceilings[0].visible, false);
    assert.equal(ceilings[0].castShadow, false);
    assert.equal(ceilings[0].receiveShadow, true);

    const box = new THREE.Box3().setFromObject(ceilings[0]);
    assert.deepEqual(box.min.toArray(), [0, 0, 2800]);
    assert.deepEqual(box.max.toArray(), [1000, 800, 2800]);
    assert.equal(
        triangleCentroids(ceilings[0].geometry)
            .some(point => point.x > 400 && point.x < 600 && point.y > 300 && point.y < 500),
        false,
    );
});

test('missing outline keeps one room-based ceiling per floor as a fallback', () => {
    const renderer = createRenderer();
    const floorA = new THREE.Mesh(new THREE.PlaneGeometry(300, 200));
    const floorB = new THREE.Mesh(new THREE.PlaneGeometry(500, 400));
    floorA.userData.roomIndex = 3;
    floorB.userData.roomIndex = 7;

    const ceilings = renderer.createCeilingMeshes(null, [floorA, floorB]);

    assert.equal(ceilings.length, 2);
    assert.deepEqual(ceilings.map(mesh => mesh.userData.ceilingSource), [
        'room-fallback',
        'room-fallback',
    ]);
    assert.deepEqual(ceilings.map(mesh => mesh.userData.roomIndex), [3, 7]);
});
