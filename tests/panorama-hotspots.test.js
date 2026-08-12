import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    PanoramaHotspots,
    projectPanoramaHotspot,
} from '../src/panorama/PanoramaHotspots.js';
import { FakeDocument, FakeElement, findByDataset } from './helpers/fake-dom.js';

function createCamera() {
    const camera = new THREE.PerspectiveCamera(90, 4 / 3, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
}

test('shows front and side points while hiding rear and coincident points', () => {
    const camera = createCamera();
    const viewport = { width: 800, height: 600, margin: 40 };

    const front = projectPanoramaHotspot({ x: 0, y: 0, z: -10 }, camera, viewport);
    const side = projectPanoramaHotspot({ x: 10, y: 0, z: 0 }, camera, viewport);
    const behind = projectPanoramaHotspot({ x: 0, y: 0, z: 10 }, camera, viewport);
    const coincident = projectPanoramaHotspot({ x: 0, y: 0, z: 0 }, camera, viewport);

    assert.deepEqual(front, {
        visible: true,
        inView: true,
        left: 400,
        top: 300,
        angle: 0,
    });
    assert.equal(side.visible, true);
    assert.equal(side.inView, false);
    assert.equal(side.left, 760);
    assert.equal(side.top, 300);
    assert.deepEqual(behind, {
        visible: false,
        inView: false,
        left: 0,
        top: 0,
        angle: 0,
    });
    assert.equal(coincident.visible, false);
});

test('keeps front offscreen points as clamped edge hints', () => {
    const projection = projectPanoramaHotspot(
        { x: 20, y: 0, z: -10 },
        createCamera(),
        { width: 800, height: 600, margin: 40 },
    );

    assert.equal(projection.visible, true);
    assert.equal(projection.inView, false);
    assert.ok(projection.left >= 40 && projection.left <= 760);
    assert.ok(projection.top >= 40 && projection.top <= 560);
});

test('updates hotspot visibility as the camera rotates and preserves selection', () => {
    const container = new FakeElement('div');
    container.rect = { left: 0, top: 0, width: 800, height: 600 };
    const selected = [];
    const hotspots = new PanoramaHotspots(container, {
        documentRef: new FakeDocument(),
        onSelect: id => selected.push(id),
    });
    hotspots.render({
        points: [
            { id: 'active', name: '当前点', x: 0, y: 0, z: 0 },
            { id: 'front', name: '前方', roomName: '客厅', x: 0, y: 0, z: -10 },
            { id: 'back', name: '后方', roomName: '主卧', x: 0, y: 0, z: 10 },
        ],
        activePointId: 'active',
        visible: true,
    });
    const camera = createCamera();
    hotspots.update(camera);

    const front = findByDataset(container, 'pointId', 'front');
    const back = findByDataset(container, 'pointId', 'back');
    assert.equal(findByDataset(container, 'pointId', 'active'), null);
    assert.equal(front.hidden, false);
    assert.equal(back.hidden, true);
    assert.equal(front.classList.contains('is-offscreen'), false);
    front.click();
    assert.deepEqual(selected, ['front']);

    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);
    hotspots.update(camera);

    assert.equal(front.hidden, true);
    assert.equal(back.hidden, false);
    back.click();
    assert.deepEqual(selected, ['front', 'back']);

    hotspots.setVisible(false);
    assert.equal(container.hidden, true);
    back.click();
    assert.deepEqual(selected, ['front', 'back']);
});
