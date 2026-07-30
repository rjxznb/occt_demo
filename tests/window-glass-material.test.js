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

test('named glass in non-window content is also made transparent', () => {
    const root = mesh('glass', 'glass');
    const original = root.material;

    applyWindowGlassMaterials(root, { sourceList: 'soft_list' });

    assert.notEqual(root.material, original);
    assert.equal(root.material.transparent, true);
    assert.equal(root.material.opacity, 0.32);
});

test('PT material semantics identify glass even when OBJ material names are UUIDs', () => {
    const root = mesh('merged-window', '237e983c-f392-434a-be5c-7c695c60b00d');
    root.material.userData.contentMaterialIsGlass = true;

    applyWindowGlassMaterials(root, { sourceList: 'window_list' });

    assert.equal(root.material.transparent, true);
    assert.equal(root.material.opacity, 0.32);
});

test('explicit non-glass protocol semantics override a legacy glass material name', () => {
    const root = mesh('window-part', 'glass_named_frame');
    const original = root.material;
    original.userData.contentMaterialIsGlass = false;

    applyWindowGlassMaterials(root);

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
