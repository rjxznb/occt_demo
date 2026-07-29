import test from 'node:test';
import assert from 'node:assert/strict';

import { withSceneFixture } from '../src/core/DataSource.js';

function drawingSource(drawing) {
    return {
        name: 'fixture drawing',
        async loadDrawing() {
            return drawing;
        },
        async loadSoftlist(id) {
            return { id };
        },
    };
}

function minimalDrawing() {
    return {
        out_wall_thickness: 240,
        window_list: [{ TypeId: '1401', BasePoint: 'X=0 Y=0 Z=0' }],
        door_list: [{ TypeId: '1302', BasePoint: 'X=0 Y=0 Z=0' }],
        final_room_list: [{ TypeId: '1101' }],
    };
}

test('individual remaining TypeId fixtures append one complete immutable record', async () => {
    const cases = [
        ['1402', 'window_list', '1402', 4],
        ['140302', 'window_list', '140302', 4],
        ['1405', 'window_list', '1405', 4],
        ['1406', 'window_list', '1406', 6],
        ['140e', 'window_list', '140e', 6],
        ['140f', 'window_list', '140f', 4],
        ['1305', 'door_list', '1305', 4],
        ['1311', 'door_list', '1311', 4],
    ];

    for (const [fixtureName, listName, typeId, pointCount] of cases) {
        const drawing = minimalDrawing();
        const result = await withSceneFixture(
            drawingSource(drawing),
            `?fixture=${fixtureName}`,
        ).loadDrawing();
        const fixture = result[listName].at(-1);

        assert.equal(fixture.TypeId, typeId, fixtureName);
        assert.equal(fixture.Points.length, pointCount, `${fixtureName} points`);
        assert.ok(fixture.BlockInnerInfo && typeof fixture.BlockInnerInfo === 'object');
        assert.notEqual(result, drawing);
        assert.notEqual(result[listName], drawing[listName]);
    }
});

test('fixture=ue-specials appends every remaining family without mutating the drawing', async () => {
    const drawing = minimalDrawing();
    const snapshot = structuredClone(drawing);
    const result = await withSceneFixture(
        drawingSource(drawing),
        '?fixture=ue-specials',
    ).loadDrawing();

    assert.deepEqual(result.window_list.slice(-6).map(item => item.TypeId), [
        '1402', '140302', '1405', '1406', '140e', '140f',
    ]);
    assert.deepEqual(result.door_list.slice(-2).map(item => item.TypeId), ['1305', '1311']);
    assert.deepEqual(drawing, snapshot);
    assert.notEqual(result.window_list, drawing.window_list);
    assert.notEqual(result.door_list, drawing.door_list);
});

test('combined fixtures clone nested values independently on every load', async () => {
    const source = drawingSource(minimalDrawing());
    const first = await withSceneFixture(source, '?fixture=ue-specials').loadDrawing();
    first.window_list.at(-6).BlockInnerInfo['\u957f'] = -1;
    first.window_list.at(-6).Points[0] = 'changed';

    const second = await withSceneFixture(source, '?fixture=ue-specials').loadDrawing();

    assert.equal(second.window_list.at(-6).BlockInnerInfo['\u957f'], 1500);
    assert.notEqual(second.window_list.at(-6).Points[0], 'changed');
});
