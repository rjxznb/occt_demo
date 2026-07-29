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
    assert.equal(fixture.Size, 'X=1500.000000 Y=1200.000000');
    assert.equal(fixture.BlockInnerInfo.高度, 2200);
    assert.equal(fixture.BlockInnerInfo.外边长, 180);
    assert.equal(fixture.BlockInnerInfo.外边宽, 240);
    assert.equal(fixture.Points.length, 6);
    assert.notEqual(result, drawing);
    assert.notEqual(result.door_list, drawing.door_list);
    assert.deepEqual(drawing.door_list, [originalDoor]);
    assert.equal(result.final_room_list, drawing.final_room_list);
});

test('unrelated fixture values leave the drawing untouched', async () => {
    const drawing = { door_list: [{ TypeId: '1302' }] };
    const result = await withFixture(drawingSource(drawing), '?fixture=13130').loadDrawing();

    assert.equal(result, drawing);
    assert.equal(result.door_list.length, 1);
});
