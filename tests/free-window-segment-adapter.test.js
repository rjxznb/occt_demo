import test from 'node:test';
import assert from 'node:assert/strict';

import {
    expandCompositeContentInstances,
    expandFreeWindowInstances,
} from '../src/components/FreeWindowSegmentAdapter.js';

function freeWindow(extra = {}) {
    return {
        instanceId: 'window_list:1',
        sourceList: 'window_list',
        sourceIndex: 1,
        category: 'window',
        typeId: '140d02',
        basePoint: { x: -500, y: -600, z: 0 },
        cadPath: [
            { x: 0, y: 0, z: 0, bulge: 0 },
            { x: 1000, y: 0, z: 0, bulge: 0.25 },
            { x: 1000, y: 1000, z: 0, bulge: 0 },
            { x: 1200, y: 1000, z: 0, bulge: -0.25 },
            { x: 1200, y: -200, z: 0, bulge: 0 },
            { x: 0, y: -200, z: 0, bulge: 0 },
        ],
        footprint: [],
        size: null,
        outScale: { x: -1, y: -1, z: -1 },
        rotationDegrees: 37,
        horizontalFlip: true,
        verticalFlip: true,
        groundHeight: 900,
        rawBlockInnerInfo: { 高度: 1500, 离地高度: 900 },
        ...extra,
    };
}

function railing(extra = {}) {
    return freeWindow({
        instanceId: 'window_list:fixture-140e',
        sourceIndex: 7,
        typeId: '140e',
        groundHeight: 300,
        rawBlockInnerInfo: { 楂樺害: 1050, 绂诲湴楂樺害: 300 },
        ...extra,
    });
}

test('returns ordinary content by identity without cloning or expansion', () => {
    const ordinary = { ...freeWindow(), typeId: '1401' };
    const result = expandFreeWindowInstances([ordinary]);

    assert.equal(result.length, 1);
    assert.equal(result[0], ordinary);
});

test('returns an invalid free-window parent without any partial children', () => {
    const cases = [
        freeWindow({ cadPath: freeWindow().cadPath.slice(0, 2) }),
        freeWindow({ cadPath: freeWindow().cadPath.slice(0, 5) }),
        freeWindow({
            cadPath: freeWindow().cadPath.map((point, index) =>
                index === 4 ? { ...point, x: Number.NaN } : point),
        }),
        freeWindow({
            cadPath: freeWindow().cadPath.map((point, index) => {
                if (index === 3) return { ...point, bulge: 0 };
                return point;
            }),
        }),
    ];

    for (const parent of cases) {
        const result = expandFreeWindowInstances([parent]);
        assert.deepEqual(result, [parent]);
        assert.equal(result.some(item => item.parentInstanceId), false);
    }
});

test('reverses the back half and emits stable straight and arc children in path order', () => {
    const [straight, arc] = expandFreeWindowInstances([freeWindow()]);

    assert.deepEqual([straight.typeId, arc.typeId], ['1401', '140c']);
    assert.deepEqual(straight.cadPath.map(({ x, y }) => ({ x, y })), [
        { x: 0, y: 100 },
        { x: 1100, y: 100 },
        { x: 1100, y: -300 },
        { x: 0, y: -300 },
    ]);
    assert.deepEqual(arc.cadPath[3], { x: 1000, y: 0, z: 0, bulge: 0.25 });
    assert.deepEqual(arc.cadPath[0], { x: 1000, y: 1000, z: 0, bulge: 0 });
    assert.ok(arc.footprint.length > 4, 'arc footprint must sample curved edges');
});

test('generated children carry original identity and neutral world-space transforms', () => {
    const children = expandFreeWindowInstances([freeWindow()]);

    assert.deepEqual(children.map(child => child.instanceId), [
        'window_list:1#segment:0',
        'window_list:1#segment:1',
    ]);
    children.forEach((child, index) => {
        assert.equal(child.sourceList, 'window_list');
        assert.equal(child.sourceIndex, 1);
        assert.equal(child.parentInstanceId, 'window_list:1');
        assert.equal(child.compositeSegmentIndex, index);
        assert.equal(child.compositeSegmentCount, 2);
        assert.equal(child.generatedFromTypeId, '140d02');
        assert.deepEqual(child.outScale, { x: 1, y: 1, z: 1 });
        assert.equal(child.horizontalFlip, false);
        assert.equal(child.verticalFlip, false);
        assert.equal(child.groundHeight, 900);
        assert.equal(child.rawBlockInnerInfo.高度, 1500);
        assert.equal(child.rawBlockInnerInfo.离地高度, 900);
    });
    assert.equal(children[0].rotationDegrees, 0);
    assert.deepEqual(children[0].basePoint, { x: 0, y: 100, z: 0 });
    assert.deepEqual(children[0].size, { x: 1100, y: 400, z: 1500 });
    assert.equal(children[0].rawBlockInnerInfo.长, 1100);
    assert.equal(children[0].rawBlockInnerInfo.宽, 400);
    assert.equal(children[1].rotationDegrees, 0);
});

test('expands a 140e parent into ordered straight and arc railing children', () => {
    const [straight, arc] = expandCompositeContentInstances([railing()]);

    assert.deepEqual([straight.typeId, arc.typeId], ['140e01', '140e02']);
    assert.deepEqual([straight.generatedFromTypeId, arc.generatedFromTypeId], ['140e', '140e']);
    assert.deepEqual([straight.compositeSegmentIndex, arc.compositeSegmentIndex], [0, 1]);
    assert.equal(straight.parentInstanceId, 'window_list:fixture-140e');
    assert.equal(arc.parentInstanceId, 'window_list:fixture-140e');
    assert.equal(straight.groundHeight, 300);
    assert.equal(straight.rawBlockInnerInfo.楂樺害, 1050);
});

test('returns invalid 140e geometry as its untouched parent without partial children', () => {
    const parent = railing({ cadPath: [{ x: 0, y: 0, z: 0, bulge: 0 }] });

    const result = expandCompositeContentInstances([parent]);

    assert.deepEqual(result, [parent]);
    assert.equal(result[0], parent);
    assert.equal(result.some(item => item.parentInstanceId), false);
});

test('returns an empty list for non-array input', () => {
    assert.deepEqual(expandFreeWindowInstances(null), []);
    assert.deepEqual(expandCompositeContentInstances(null), []);
});
