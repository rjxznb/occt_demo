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

test('discovers every array-valued *_list record with a TypeId', () => {
    const result = collectContentModelInstances({
        soft_list: [block('soft')],
        door_list: [block('door')],
        pillar_list: [block('pillar')],
        final_room_list: [block('room')],
        malformed_list: null,
        metadata: [block('not-a-list')],
        ignored_list: [{ BasePoint: 'X=0 Y=0 Z=0' }],
    });
    assert.deepEqual(result.map(item => item.instanceId), [
        'soft_list:0', 'door_list:0', 'pillar_list:0', 'final_room_list:0',
    ]);
    assert.deepEqual(result.map(item => item.category), [
        'soft', 'door', 'pillar', 'final_room',
    ]);
});

test('retains zero-size irregular candidates for later local-geometry classification', () => {
    const [item] = collectContentModelInstances({
        window_list: [block('140d02', {
            Size: 'X=0 Y=0',
            Points: [
                'X=0 Y=0 Z=0', 'X=0 Y=1000 Z=0', 'X=900 Y=1400 Z=0',
                'X=1100 Y=1350 Z=0', 'X=-240 Y=900 Z=0', 'X=-240 Y=0 Z=0',
            ],
        })],
    });

    assert.equal(item.typeId, '140d02');
    assert.equal(item.size, null);
    assert.equal(item.footprint.length, 6);
});

test('normalizes CAD plan facts and preserves raw parameter sources', () => {
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
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'modelParams'), false);
    assert.deepEqual(item.rawBlockInnerInfo, {
        旋转角度: 30,
        左右翻转: true,
        上下翻转: false,
        长: 200,
        宽: 200,
        高: 800,
        离地高度: 120,
    });
    assert.equal(item.footprint.length, 4);
});

test('preserves finite CAD path points with normalized Z and bulge values', () => {
    const [item] = collectContentModelInstances({
        window_list: [block('140d02', {
            Points: [
                'X=10 Y=20 Z=30 B=-1.455308',
                'X=40 Y=50',
                'X=invalid Y=70 Z=0 B=0.25',
            ],
        })],
    });

    assert.deepEqual(item.cadPath, [
        { x: 10, y: 20, z: 30, bulge: -1.455308 },
        { x: 40, y: 50, z: 0, bulge: 0 },
    ]);
    assert.deepEqual(item.footprint, [
        { x: 10, y: 20 },
        { x: 40, y: 50 },
    ]);
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

test('retains typed records without dimensions for later classification', () => {
    const [item] = collectContentModelInstances({
        soft_list: [block('no-dimensions', { Size: 'invalid', Points: [] })],
    });

    assert.equal(item.typeId, 'no-dimensions');
    assert.equal(item.size, null);
    assert.deepEqual(item.footprint, []);
});
