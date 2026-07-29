import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { applyWindowGlassMaterials } from '../src/components/WindowGlassMaterial.js';

function mesh(name, materialName, opacity = 1) {
    const material = new THREE.MeshStandardMaterial({ opacity });
    material.name = materialName;
    const result = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    result.name = name;
    return result;
}

test('window glass is cloned and transparent while its frame remains opaque', () => {
    const root = new THREE.Group();
    const glass = mesh('WindowGlass', '玻璃');
    const frame = mesh('AluminiumFrame', 'frame');
    const originalGlass = glass.material;
    root.add(glass, frame);

    applyWindowGlassMaterials(root, { sourceList: 'window_list' });

    assert.notEqual(glass.material, originalGlass);
    assert.equal(glass.material.transparent, true);
    assert.equal(glass.material.opacity, 0.32);
    assert.equal(glass.material.depthWrite, false);
    assert.equal(glass.material.side, THREE.DoubleSide);
    assert.equal(frame.material.transparent, false);
    assert.equal(originalGlass.transparent, false);
});

test('non-window models are not changed even when a material is named glass', () => {
    const root = mesh('glass', 'glass');
    const original = root.material;

    applyWindowGlassMaterials(root, { sourceList: 'soft_list' });

    assert.equal(root.material, original);
    assert.equal(root.material.transparent, false);
});

test('material arrays normalize only the named glass entry and retain lower source opacity', () => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
        Object.assign(new THREE.MeshStandardMaterial({ opacity: 0.2 }), { name: 'Glass_Clear' }),
        Object.assign(new THREE.MeshStandardMaterial(), { name: 'handle' }),
    ]);
    const originals = root.material.slice();

    applyWindowGlassMaterials(root, { sourceList: 'window_list' });

    assert.notEqual(root.material[0], originals[0]);
    assert.equal(root.material[0].opacity, 0.2);
    assert.equal(root.material[0].transparent, true);
    assert.equal(root.material[1], originals[1]);
});
