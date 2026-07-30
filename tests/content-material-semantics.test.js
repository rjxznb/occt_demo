import test from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyContentMaterial,
    normalizeContentMaterialEntries,
    parseMtlColor,
} from '../src/components/ContentMaterialSemantics.js';

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
