import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaMiniMap } from '../src/panorama/PanoramaMiniMap.js';
import { FakeDocument, FakeElement, findByDataset } from './helpers/fake-dom.js';

const ROOM_POINTS = [[
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
]];

const POINTS = [
    { id: 'a', name: 'A', x: 20, y: 20, yaw: 0, z: 1500 },
    { id: 'b', name: 'B', x: 80, y: 80, yaw: 90, z: 1600 },
    { id: 'c', name: 'C', x: 50, y: 50, yaw: 180, z: 1400 },
];

test('renders active, ordinary, and dirty panorama points and reports selection', () => {
    const container = new FakeElement('aside');
    const selected = [];
    const map = new PanoramaMiniMap(container, {
        documentRef: new FakeDocument(),
        padding: 0,
        onSelect: id => selected.push(id),
    });

    map.render({
        roomPoints: ROOM_POINTS,
        points: POINTS,
        activePointId: 'a',
        dirtyPointIds: ['c'],
    });

    const active = findByDataset(container, 'pointId', 'a');
    const ordinary = findByDataset(container, 'pointId', 'b');
    const dirty = findByDataset(container, 'pointId', 'c');
    assert.equal(active.classList.contains('is-active'), true);
    assert.equal(ordinary.classList.contains('is-active'), false);
    assert.equal(dirty.classList.contains('is-dirty'), true);
    ordinary.click();
    assert.deepEqual(selected, ['b']);
});

test('reports collapse and world-space create intents through callbacks', () => {
    const container = new FakeElement('aside');
    const toggles = [];
    const creates = [];
    const map = new PanoramaMiniMap(container, {
        documentRef: new FakeDocument(),
        padding: 0,
        onToggle: collapsed => toggles.push(collapsed),
        onCreate: point => creates.push(point),
    });
    map.render({ roomPoints: ROOM_POINTS, points: POINTS, createMode: true });

    findByDataset(container, 'action', 'toggle-map').click();
    const stage = findByDataset(container, 'role', 'minimap-stage');
    stage.rect = { left: 0, top: 0, width: 200, height: 100 };
    stage.dispatch('click', { clientX: 150, clientY: 50 });

    assert.deepEqual(toggles, [true]);
    assert.deepEqual(creates, [{ x: 75, y: 50 }]);
});
