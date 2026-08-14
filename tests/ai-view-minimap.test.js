import test from 'node:test';
import assert from 'node:assert/strict';

import { AiViewMiniMap } from '../src/ai-concept/AiViewMiniMap.js';
import { FakeDocument, FakeElement, descendants, findByDataset } from './helpers/fake-dom.js';

const roomPoints = [
    [[0, 0], [2000, 0], [2000, 1600], [0, 1600]],
    [[2000, 0], [3600, 0], [3600, 1600], [2000, 1600]],
];
const views = [
    { id: 'view-a', name: '入口', roomName: '客厅', x: 500, y: 500, z: 1500, status: 'available' },
    { id: 'view-b', name: '角落', roomName: '主卧', x: 2600, y: 800, z: 1500, status: 'available' },
    { id: 'excluded', name: '排除', roomName: '客厅', x: 900, y: 900, z: 1500, status: 'excluded' },
];

test('renders every room and available candidate without direction lines', () => {
    const calls = [];
    const container = new FakeElement('aside');
    const map = new AiViewMiniMap(container, {
        documentRef: new FakeDocument(),
        onSelect: id => calls.push(id),
    });

    map.render({ roomPoints, views, activeViewId: 'view-b' });

    assert.equal(container.hidden, false);
    assert.equal(descendants(container).filter(node => node.tagName === 'POLYGON').length, 2);
    const activeMarker = findByDataset(container, 'viewId', 'view-b');
    assert.equal(activeMarker.classList.contains('is-active'), true);
    assert.equal(activeMarker.tagName, 'CIRCLE');
    assert.equal(activeMarker.parentNode.tagName, 'SVG');
    assert.equal(activeMarker.parentNode.getAttribute('aria-hidden'), null);
    assert.equal(activeMarker.getAttribute('cx'), '2600');
    assert.equal(activeMarker.getAttribute('cy'), '-800');
    assert.equal(findByDataset(container, 'viewId', 'excluded'), null);
    assert.equal(descendants(container).some(node => node.classList.contains('camera-map-direction')), false);
    findByDataset(container, 'viewId', 'view-a').click();
    assert.deepEqual(calls, ['view-a']);
});

test('hides when no room or candidate coordinates can produce a layout', () => {
    const container = new FakeElement('aside');
    const map = new AiViewMiniMap(container, { documentRef: new FakeDocument() });
    map.render({ roomPoints: [], views: [] });
    assert.equal(container.hidden, true);
    assert.equal(container.children.length, 0);
});
