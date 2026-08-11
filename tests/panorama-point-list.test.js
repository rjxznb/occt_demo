import test from 'node:test';
import assert from 'node:assert/strict';

import { PanoramaPointList } from '../src/panorama/PanoramaPointList.js';
import { FakeDocument, FakeElement, findByDataset } from './helpers/fake-dom.js';

test('renders point metadata and reports every point action without mutating data', () => {
    const points = [
        { id: 'a', name: '客厅中央', roomName: '客厅', z: 1500, valid: true },
        { id: 'b', name: '主卧入口', roomName: '主卧', z: 1200, valid: true },
    ];
    const calls = [];
    const container = new FakeElement('aside');
    const list = new PanoramaPointList(container, {
        documentRef: new FakeDocument(),
        onSelect: id => calls.push(['select', id]),
        onRename: id => calls.push(['rename', id]),
        onDelete: id => calls.push(['delete', id]),
        onSetInitial: id => calls.push(['initial', id]),
        onRestore: id => calls.push(['restore', id]),
    });

    list.render({
        points,
        activePointId: 'a',
        initialPointId: 'b',
        dirtyPointIds: ['a'],
    });

    const activeRow = findByDataset(container, 'pointId', 'a');
    assert.equal(activeRow.classList.contains('is-active'), true);
    assert.equal(activeRow.classList.contains('is-dirty'), true);
    assert.match(activeRow.textContent, /客厅中央.*客厅.*1500/);
    assert.equal(findByDataset(container, 'pointId', 'b').classList.contains('is-initial'), true);

    findByDataset(container, 'action', 'select:a').click();
    findByDataset(container, 'action', 'rename:a').click();
    findByDataset(container, 'action', 'delete:a').click();
    findByDataset(container, 'action', 'initial:a').click();
    findByDataset(container, 'action', 'restore:a').click();

    assert.deepEqual(calls, [
        ['select', 'a'], ['rename', 'a'], ['delete', 'a'],
        ['initial', 'a'], ['restore', 'a'],
    ]);
    assert.equal(points[0].name, '客厅中央');
});
