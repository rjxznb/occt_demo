import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseContentMaterialDetail,
    resolveContentMaterialDetails,
} from '../src/components/ContentMaterialDetails.js';

const glassOptimize = {
    version: '100',
    materialParameter: JSON.stringify({
        D: [['SN:0_MI_V8_Glass', '300*1.0', '700*0.2', '800*0.0']],
    }),
    name: 'transparent glass',
    resCode: 'PT527545889554403328',
    modelType: '4',
};

test('parses BOM-prefixed optimization metadata and recognizes UE glass', () => {
    const descriptor = parseContentMaterialDetail({
        code: 'PT527545889554403328',
        name: 'transparent glass',
        optimizeParam: `\uFEFF${JSON.stringify(glassOptimize)}`,
        pakFileUrl: 'https://file.test/material.pak',
    });

    assert.equal(descriptor.code, 'PT527545889554403328');
    assert.equal(descriptor.modelType, '4');
    assert.equal(descriptor.masterMaterial, 'MI_V8_Glass');
    assert.equal(descriptor.isGlass, true);
    assert.deepEqual(descriptor.parameters, {
        300: 1,
        700: 0.2,
        800: 0,
    });
});

test('parses protocol base color without guessing unknown scalar meanings', () => {
    const descriptor = parseContentMaterialDetail({
        code: 'PT1031617746398150656',
        name: 'matte metal',
        optimizeParam: JSON.stringify({
            materialParameter: JSON.stringify({
                D: [[
                    'SN:MI_V8_Normal',
                    '100*0.1-0.2-0.3',
                    '300*0.7',
                    '407*-0.44',
                ]],
            }),
            modelType: '2',
        }),
    });

    assert.equal(descriptor.masterMaterial, 'MI_V8_Normal');
    assert.deepEqual(descriptor.color, [0.1, 0.2, 0.3]);
    assert.deepEqual(descriptor.parameters, {
        100: [0.1, 0.2, 0.3],
        300: 0.7,
        407: -0.44,
    });
    assert.equal(descriptor.isGlass, false);
});

test('falls back to optimizeFileUrl and never requests the PAK URL', async () => {
    const calls = [];
    const details = [{
        code: 'PT9',
        name: 'glass',
        optimizeParam: '{broken',
        optimizeFileUrl: 'https://file.test/material.json',
        pakFileUrl: 'https://file.test/material.pak',
    }];

    const descriptors = await resolveContentMaterialDetails(details, {
        fetchJson: async url => {
            calls.push(url);
            return glassOptimize;
        },
    });

    assert.deepEqual(calls, ['https://file.test/material.json']);
    assert.equal(descriptors.get('PT9').isGlass, true);
    assert.equal(calls.includes('https://file.test/material.pak'), false);
});

test('invalid detail metadata degrades to a named unresolved descriptor', async () => {
    const descriptors = await resolveContentMaterialDetails([{
        code: 'PT10',
        name: 'unknown material',
        optimizeParam: '{broken',
    }], { fetchJson: async () => { throw new Error('must not run'); } });

    assert.deepEqual(descriptors.get('PT10'), {
        code: 'PT10',
        name: 'unknown material',
        modelType: '',
        masterMaterial: '',
        isGlass: false,
        color: null,
        parameters: {},
        source: null,
    });
});
