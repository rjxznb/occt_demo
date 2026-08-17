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
    assert.equal(findByDataset(active, 'action', 'toggle-selected'), null);
    assert.equal(active.classList.contains('is-selected'), false);
    assert.equal(findByDataset(container, 'viewId', 'excluded'), null);

    findByDataset(active, 'action', 'activate').click();
    findByDataset(active, 'action', 'edit').click();
    findByDataset(active, 'action', 'delete').click();
    findByDataset(container, 'action', 'restore').click();
    findByDataset(container, 'action', 'add').click();

    assert.deepEqual(calls, [
        ['activate', 'living-entry'],
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

function createScrollableFilmstrip() {
    const container = new FakeElement('section');
    const filmstrip = new AiViewFilmstrip(container, { documentRef: new FakeDocument() });
    filmstrip.render({ views, activeViewId: 'living-entry' });
    const track = container.children[0];
    track.rect = { left: 100, top: 0, width: 600, height: 150 };
    track.clientWidth = 600;
    track.scrollWidth = 1400;
    track.scrollLeft = 200;
    return { container, filmstrip, track };
}

test('centers an interior selected card in the filmstrip viewport', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'bedroom-corner');
    card.rect = { left: 620, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('bedroom-corner');

    assert.deepEqual(track.scrollToOptions, { left: 510, behavior: 'smooth' });
});

test('preserves the current scroll position when the filmstrip rerenders', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    track.scrollLeft = 360;

    filmstrip.render({ views, activeViewId: 'bedroom-corner' });

    assert.equal(container.children[0].scrollLeft, 360);
});

test('centers cards when nested children are browser-like collections', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'bedroom-corner');
    card.rect = { left: 620, top: 0, width: 180, height: 130 };
    const group = card.parentNode.parentNode;
    const originalChildren = group.children;
    group.children = {
        0: originalChildren[0],
        1: originalChildren[1],
        length: originalChildren.length,
        [Symbol.iterator]: function* iterator() { yield* originalChildren; },
    };

    filmstrip.scrollViewIntoView('bedroom-corner');

    assert.deepEqual(track.scrollToOptions, { left: 510, behavior: 'smooth' });
});

test('clamps a selected card at the leading scroll boundary', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'living-entry');
    card.rect = { left: -180, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('living-entry');

    assert.equal(track.scrollToOptions.left, 0);
});

test('clamps a selected card at the trailing scroll boundary', () => {
    const { container, filmstrip, track } = createScrollableFilmstrip();
    const card = findByDataset(container, 'viewId', 'bedroom-corner');
    card.rect = { left: 1220, top: 0, width: 180, height: 130 };

    filmstrip.scrollViewIntoView('bedroom-corner');

    assert.equal(track.scrollToOptions.left, 800);
});
