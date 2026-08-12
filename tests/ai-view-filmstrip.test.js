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

test('renders every room group and candidate even when one room is active', () => {
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
    });

    filmstrip.render({ views, activeViewId: 'living-entry', activeRoomId: 'room-0' });

    assert.ok(findByDataset(container, 'roomGroupId', 'room-0'));
    assert.ok(findByDataset(container, 'roomGroupId', 'room-1'));
    const active = findByDataset(container, 'viewId', 'living-entry');
    const otherRoom = findByDataset(container, 'viewId', 'bedroom-corner');
    assert.equal(active.classList.contains('is-active'), true);
    assert.ok(otherRoom, 'the inactive room candidate remains visible');
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

    assert.deepEqual(calls, [
        ['activate', 'living-entry'], ['select', 'living-entry'],
        ['edit', 'living-entry'], ['delete', 'living-entry'],
        ['restore'], ['add'],
    ]);
    assert.ok(descendants(container).some(element => element.getAttribute('aria-label') === '垃圾桶'));
});

test('renders ready images and recoverable thumbnail failures', () => {
    const calls = [];
    const container = new FakeElement('section');
    const filmstrip = new AiViewFilmstrip(container, {
        documentRef: new FakeDocument(),
        onRetryThumbnail: id => calls.push(id),
    });
    const thumbnails = new Map([
        ['living-entry', { status: 'ready', url: 'blob:living' }],
        ['bedroom-corner', { status: 'error' }],
    ]);

    filmstrip.render({ views, activeViewId: 'living-entry', thumbnails });

    const ready = findByDataset(container, 'viewId', 'living-entry');
    const failed = findByDataset(container, 'viewId', 'bedroom-corner');
    assert.equal(ready.dataset.thumbnailState, 'ready');
    assert.equal(failed.dataset.thumbnailState, 'error');
    const image = descendants(ready).find(element => element.tagName === 'IMG');
    assert.equal(image?.getAttribute('src'), 'blob:living');
    assert.equal(image?.getAttribute('alt'), '客厅 入口广角');
    findByDataset(failed, 'action', 'retry-thumbnail').click();
    assert.deepEqual(calls, ['bedroom-corner']);
});
