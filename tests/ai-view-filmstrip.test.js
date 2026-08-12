import test from 'node:test';
import assert from 'node:assert/strict';

import { AiViewFilmstrip } from '../src/ai-concept/AiViewFilmstrip.js';
import { FakeDocument, FakeElement, descendants, findByDataset } from './helpers/fake-dom.js';

const views = [{
    id: 'living-entry', roomId: 'room-0', roomName: '客厅', name: '入口广角',
    source: 'auto', status: 'available', selected: true, valid: true,
}, {
    id: 'bedroom-corner', roomId: 'room-1', roomName: '主卧', name: '角部广角',
    source: 'auto', status: 'available', selected: false, valid: true,
}, {
    id: 'excluded', roomId: 'room-0', roomName: '客厅', name: '主墙构图',
    source: 'auto', status: 'excluded', selected: false, valid: true,
}];

test('renders room labels, text edit controls, trash buttons, and selection separately', () => {
    const calls = [];
    const container = new FakeElement('section');
    const filmstrip = new AiViewFilmstrip(container, {
        documentRef: new FakeDocument(),
        onActivate: id => calls.push(['activate', id]),
        onToggleSelected: id => calls.push(['select', id]),
        onEdit: id => calls.push(['edit', id]),
        onDelete: id => calls.push(['delete', id]),
        onRestore: () => calls.push(['restore']),
        onAdd: () => calls.push(['add']),
        onRoomFilter: id => calls.push(['room', id]),
    });

    filmstrip.render({ views, activeViewId: 'living-entry', activeRoomId: 'room-0' });

    const active = findByDataset(container, 'viewId', 'living-entry');
    assert.equal(active.classList.contains('is-active'), true);
    assert.match(active.textContent, /客厅.*入口广角/);
    assert.doesNotMatch(active.textContent, /自动|手动/);
    assert.equal(findByDataset(active, 'action', 'edit').textContent, '微调');
    assert.equal(findByDataset(active, 'action', 'delete').getAttribute('aria-label'), '删除入口广角');
    assert.equal(findByDataset(active, 'action', 'toggle-selected').getAttribute('aria-pressed'), 'true');
    assert.equal(findByDataset(container, 'viewId', 'excluded'), null);

    findByDataset(active, 'action', 'activate').click();
    findByDataset(active, 'action', 'toggle-selected').click();
    findByDataset(active, 'action', 'edit').click();
    findByDataset(active, 'action', 'delete').click();
    findByDataset(container, 'action', 'restore').click();
    findByDataset(container, 'action', 'add').click();
    findByDataset(container, 'roomId', 'room-1').click();

    assert.deepEqual(calls, [
        ['activate', 'living-entry'], ['select', 'living-entry'],
        ['edit', 'living-entry'], ['delete', 'living-entry'],
        ['restore'], ['add'], ['room', 'room-1'],
    ]);
    assert.ok(descendants(container).some(element => element.getAttribute('aria-label') === '垃圾桶'));
});
