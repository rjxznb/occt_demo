import test from 'node:test';
import assert from 'node:assert/strict';
import { collectContentModelInstances } from '../src/components/ContentModelRegistry.js';

const block = (TypeId, extra = {}) => ({
    TypeId,
    BasePoint: 'X=1000 Y=2000 Z=30',
    Points: [
        'X=900 Y=1900 Z=0', 'X=1100 Y=1900 Z=0',
        'X=1100 Y=2100 Z=0', 'X=900 Y=2100 Z=0',
    ],
    Size: 'X=200 Y=200 Z=800',
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    OutRotateRadian: 15,
    BlockInnerInfo: {
        旋转角度: 30,
        左右翻转: true,
        上下翻转: false,
        长: 200,
        宽: 200,
        高: 800,
        离地高度: 120,
    },
    ...extra,
});

test('collects only UE model-bearing lists', () => {
    const result = collectContentModelInstances({
        soft_list: [block('soft')],
        door_list: [block('door')],
        window_list: [block('window')],
        radiator_list: [block('radiator')],
        pillar_list: [block('must-not-load')],
        room_list: [block('must-not-load-either')],
    });
    assert.deepEqual(result.map(item => item.sourceList), [
        'soft_list', 'door_list', 'window_list', 'radiator_list',
    ]);
    assert.deepEqual(result.map(item => item.category), [
        'soft', 'door', 'window', 'radiator',
    ]);
});

test('normalizes CAD plan transform, dimensions, and parameters', () => {
    const [item] = collectContentModelInstances({ soft_list: [block('225903')] });
    assert.equal(item.instanceId, 'soft_list:0');
    assert.equal(item.typeId, '225903');
    assert.deepEqual(item.basePoint, { x: 1000, y: 2000, z: 30 });
    assert.deepEqual(item.size, { x: 200, y: 200, z: 800 });
    assert.deepEqual(item.outScale, { x: 1, y: 1, z: 1 });
    assert.equal(item.rotationDegrees, 45);
    assert.equal(item.horizontalFlip, true);
    assert.equal(item.verticalFlip, false);
    assert.equal(item.groundHeight, 120);
    assert.deepEqual(item.modelParams, [
        { name: '长度', value: 200 },
        { name: '宽度', value: 200 },
        { name: '高度', value: 800 },
        { name: '离地高度', value: 120 },
    ]);
    assert.equal(item.footprint.length, 4);
});

test('keeps invalid objects out of the request set', () => {
    const result = collectContentModelInstances({
        soft_list: [{ TypeId: '', BasePoint: 'bad' }, null],
    });
    assert.deepEqual(result, []);
});

test('distinguishes an explicit zero ground height from an omitted value', () => {
    const [zeroHeight] = collectContentModelInstances({
        soft_list: [block('zero-height', { BlockInnerInfo: { 离地高度: 0 } })],
    });
    const [missingHeight] = collectContentModelInstances({
        soft_list: [block('missing-height', { BlockInnerInfo: {} })],
    });

    assert.equal(zeroHeight.groundHeight, 0);
    assert.equal(missingHeight.groundHeight, null);
});

test('derives dimensions from a valid footprint when CAD Size is unavailable', () => {
    const [item] = collectContentModelInstances({
        soft_list: [block('footprint-size', {
            Size: 'invalid',
            Points: [
                'X=0 Y=0 Z=0', 'X=400 Y=0 Z=0',
                'X=400 Y=200 Z=0', 'X=0 Y=200 Z=0',
            ],
            BlockInnerInfo: { 高: 800 },
        })],
    });

    assert.deepEqual(item.size, { x: 400, y: 200, z: 800 });
});

test('keeps two-axis CAD Size when its footprint starts on the opposite axis', () => {
    const [item] = collectContentModelInstances({
        soft_list: [block('two-axis-size', {
            Size: 'X=420 Y=730',
            Points: [
                'X=0 Y=0 Z=0', 'X=0 Y=730 Z=0',
                'X=420 Y=730 Z=0', 'X=420 Y=0 Z=0',
            ],
            BlockInnerInfo: { '\u9ad8': 800 },
        })],
    });

    assert.deepEqual(item.size, { x: 420, y: 730, z: 800 });
});

test('skips records without valid dimensions or a usable footprint', () => {
    const result = collectContentModelInstances({
        soft_list: [block('no-dimensions', { Size: 'invalid', Points: [] })],
    });

    assert.deepEqual(result, []);
});
