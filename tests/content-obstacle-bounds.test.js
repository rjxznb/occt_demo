import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { collectContentObstacleBounds } from '../src/shared/ContentObstacleBounds.js';

test('collects only content model roots with three-dimensional bounds', () => {
    const root = new THREE.Group();
    const content = new THREE.Mesh(
        new THREE.BoxGeometry(100, 200, 300),
        new THREE.MeshBasicMaterial(),
    );
    content.userData = { contentModelRoot: true, instanceId: 'chair-1' };
    content.position.set(500, 600, 150);

    const ignored = new THREE.Mesh(
        new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshBasicMaterial(),
    );
    root.add(content, ignored);

    assert.deepEqual(collectContentObstacleBounds(root), [{
        id: 'chair-1',
        minX: 450,
        minY: 500,
        minZ: 0,
        maxX: 550,
        maxY: 700,
        maxZ: 300,
    }]);
});

test('returns null when the scene group cannot be traversed', () => {
    assert.equal(collectContentObstacleBounds(null), null);
    assert.equal(collectContentObstacleBounds({}), null);
});
