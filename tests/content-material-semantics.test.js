import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    applyContentMaterialSemantics,
    classifyContentMaterial,
    normalizeContentMaterialEntries,
    parseMtlColor,
} from '../src/components/ContentMaterialSemantics.js';

function meshWithMaterial(name) {
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
    });
    material.name = name;
    return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
}

test('normalizes object-map material metadata and uses the key when MatName is absent', () => {
    const entries = normalizeContentMaterialEntries({
        glass_uuid: { ID: 'PT1', IsModel: 'false', BimRenderMat: '3' },
    });

    assert.deepEqual(entries.map(({
        materialName, code, isModel, bimRenderMat, category,
    }) => ({
        materialName, code, isModel, bimRenderMat, category,
    })), [{
        materialName: 'glass_uuid',
        code: 'PT1',
        isModel: false,
        bimRenderMat: 3,
        category: 'glass',
    }]);
});

test('normalizes array material metadata by MatName', () => {
    const entries = normalizeContentMaterialEntries([
        { ID: 'PT2', IsModel: 0, MatName: 'tile_uuid', BimRenderMat: 5 },
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].materialName, 'tile_uuid');
    assert.equal(entries[0].category, 'material-library');
});

test('classifies every documented BimRender material combination', () => {
    const cases = [
        [0, false, 'tiling'],
        [1, false, 'paint'],
        [2, false, 'grout'],
        [3, false, 'glass'],
        [4, false, 'window-frame-loft'],
        [5, false, 'material-library'],
        [0, true, 'static-model'],
        [6, true, 'parametric-model'],
        [6, false, 'unknown'],
    ];

    for (const [bimRenderMat, isModel, expected] of cases) {
        assert.equal(classifyContentMaterial({ bimRenderMat, isModel }), expected);
    }
});

test('parses RRGGBB and AARRGGBB MTLCOLOR markers', () => {
    assert.deepEqual(parseMtlColor('MTLCOLOR336699_wall'), {
        color: 0x336699,
        opacity: null,
    });
    assert.deepEqual(parseMtlColor('prefix_MTLCOLOR80336699_wall'), {
        color: 0x336699,
        opacity: 128 / 255,
    });
    assert.equal(parseMtlColor('MTLCOLOR-not-hex'), null);
});

test('applies paint, grout, glass, frame and PT semantics by MatName', () => {
    const root = new THREE.Group();
    const paint = meshWithMaterial('MTLCOLOR336699_wall');
    const grout = meshWithMaterial('MTLCOLORFFCCAA_joint');
    const glass = meshWithMaterial('glass_uuid');
    const frame = meshWithMaterial('frame_uuid');
    const library = meshWithMaterial('library_uuid');
    root.add(paint, grout, glass, frame, library);

    applyContentMaterialSemantics(root, {
        paint: { MatName: paint.material.name, BimRenderMat: 1, IsModel: false },
        grout: { MatName: grout.material.name, BimRenderMat: 2, IsModel: false },
        glass: { MatName: glass.material.name, BimRenderMat: 3, IsModel: false },
        frame: { MatName: frame.material.name, BimRenderMat: 4, IsModel: false },
        library: {
            MatName: library.material.name,
            ID: 'PT9',
            BimRenderMat: 5,
            IsModel: false,
        },
    });

    assert.equal(paint.material.color.getHex(), 0x336699);
    assert.equal(grout.material.color.getHex(), 0xffccaa);
    assert.equal(grout.material.metalness, 0);
    assert.ok(grout.material.roughness >= 0.8);
    assert.equal(glass.material.userData.contentMaterialIsGlass, true);
    assert.equal(frame.material.transparent, false);
    assert.equal(frame.material.userData.contentMaterialCategory, 'window-frame-loft');
    assert.equal(library.material.userData.contentMaterialCode, 'PT9');
});

test('preserves unknown materials and records model-only entries on the root', () => {
    const root = new THREE.Group();
    const mesh = meshWithMaterial('source');
    const originalColor = mesh.material.color.getHex();
    root.add(mesh);

    applyContentMaterialSemantics(root, [
        { MatName: 'source', BimRenderMat: 99, IsModel: false },
        { MatName: '软硬装模型', ID: '123', BimRenderMat: 0, IsModel: true },
        { MatName: '参数化模型', ID: 'MX8', BimRenderMat: 6, IsModel: true },
    ]);

    assert.equal(mesh.material.color.getHex(), originalColor);
    assert.equal(mesh.material.userData.contentMaterialCategory, 'unknown');
    assert.deepEqual(root.userData.contentModelMaterials.map(item => item.category), [
        'static-model',
        'parametric-model',
    ]);
});
