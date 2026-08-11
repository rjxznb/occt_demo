import test from 'node:test';
import assert from 'node:assert/strict';

import * as DataSources from '../src/core/DataSource.js';

function drawingSource(drawing) {
    return {
        name: 'test drawing',
        softlistDir: '/data/parsed_dxf',
        async loadDrawing() {
            return drawing;
        },
        async loadSoftlist(id) {
            return { id };
        },
    };
}

function withFixture(source, search) {
    return DataSources.withSceneFixture?.(source, search) ?? source;
}

test('fixture=1313 appends one complete CAD door record without mutating the drawing', async () => {
    const originalDoor = { TypeId: '1302', BasePoint: 'X=0 Y=0 Z=0' };
    const drawing = {
        door_list: [originalDoor],
        final_room_list: [{ TypeId: '1101' }],
    };

    const result = await withFixture(drawingSource(drawing), '?fixture=1313').loadDrawing();
    const fixture = result.door_list.at(-1);

    assert.equal(result.door_list.length, 2);
    assert.equal(fixture.TypeId, '1313');
    assert.equal(fixture.BasePoint, 'X=-1498.686324 Y=-5448.045438 Z=0.000000');
    assert.equal(fixture.Size, 'X=1200.000000 Y=1500.000000');
    assert.equal(fixture.BlockInnerInfo.长, 1200);
    assert.equal(fixture.BlockInnerInfo.宽, 1500);
    assert.equal(fixture.BlockInnerInfo.高度, 2200);
    assert.equal(fixture.BlockInnerInfo.外边长, 180);
    assert.equal(fixture.BlockInnerInfo.外边宽, 240);
    assert.equal(fixture.Points.length, 6);
    assert.equal(fixture.Points[0],
        'X=-1498.686324 Y=-5448.045438 Z=0.000000 B=0.000000');
    assert.notEqual(result, drawing);
    assert.notEqual(result.door_list, drawing.door_list);
    assert.deepEqual(drawing.door_list, [originalDoor]);
    assert.equal(result.final_room_list, drawing.final_room_list);
});

test('fixture=1408 appends one asymmetric U-window without mutating the drawing', async () => {
    const originalWindow = { TypeId: '1401', BasePoint: 'X=0 Y=0 Z=0' };
    const originalDoor = { TypeId: '1302' };
    const drawing = {
        window_list: [originalWindow],
        door_list: [originalDoor],
        final_room_list: [{ TypeId: '1101' }],
    };

    const result = await withFixture(drawingSource(drawing), '?fixture=1408').loadDrawing();
    const fixture = result.window_list.at(-1);

    assert.equal(result.window_list.length, 2);
    assert.equal(fixture.TypeId, '1408');
    assert.equal(fixture.BasePoint, 'X=3631.313676 Y=-4488.045438 Z=0.000000');
    assert.equal(fixture.Size, 'X=2870.000000 Y=1030.000000');
    assert.equal(fixture.OutRotateRadian, 180);
    assert.deepEqual(fixture.BlockInnerInfo, {
        长: 2870,
        下厚: 240,
        左厚: 180,
        右厚: 220,
        左宽: 1030,
        右宽: 810,
        高度: 1600,
        墙厚: 240,
        左右翻转: 0,
        上下翻转: 0,
        旋转角度: 0,
        离地高度: 900,
    });
    assert.equal(fixture.Points.length, 8);
    assert.equal(fixture.Points[0],
        'X=3631.313676 Y=-4488.045438 Z=0.000000 B=0.000000');
    assert.equal(fixture.Points[4],
        'X=461.313676 Y=-4728.045438 Z=0.000000 B=0.000000');
    assert.equal(fixture.Points[6],
        'X=3411.313676 Y=-5538.045438 Z=0.000000 B=0.000000');
    assert.notEqual(result, drawing);
    assert.notEqual(result.window_list, drawing.window_list);
    assert.deepEqual(drawing.window_list, [originalWindow]);
    assert.equal(result.door_list, drawing.door_list);
    assert.equal(result.final_room_list, drawing.final_room_list);
});

test('unrelated fixture values leave the drawing untouched', async () => {
    for (const search of [
        '?fixture=13130', '?fixture=14080', '?fixture=U-window',
        '?fixture=1403020', '?fixture=ue-special',
    ]) {
        const drawing = {
            door_list: [{ TypeId: '1302' }],
            window_list: [{ TypeId: '1401' }],
        };
        const result = await withFixture(drawingSource(drawing), search).loadDrawing();

        assert.equal(result, drawing);
        assert.equal(result.door_list.length, 1);
        assert.equal(result.window_list.length, 1);
    }
});

test('fixture=panorama-empty removes camera presets without mutating the drawing', async () => {
    const camera = { TypeId: '27d2', BasePoint: 'X=100 Y=100 Z=0' };
    const drawing = { camera_list: [camera], room_list: [] };

    const result = await withFixture(drawingSource(drawing), '?fixture=panorama-empty').loadDrawing();

    assert.deepEqual(result.camera_list, []);
    assert.deepEqual(drawing.camera_list, [camera]);
    assert.notEqual(result, drawing);
});
