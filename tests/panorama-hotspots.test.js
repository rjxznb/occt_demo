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

test('projects visible points into the viewport and clamps points behind the camera to an edge', () => {
    const camera = createCamera();

    const visible = projectPanoramaHotspot({ x: 0, y: 0, z: -10 }, camera, {
        width: 800,
        height: 600,
        margin: 40,
    });
    const behind = projectPanoramaHotspot({ x: 0, y: 0, z: 10 }, camera, {
        width: 800,
        height: 600,
        margin: 40,
    });

    assert.deepEqual(visible, {
        inView: true,
        left: 400,
        top: 300,
        angle: 0,
    });
    assert.equal(behind.inView, false);
    assert.ok(behind.left >= 40 && behind.left <= 760);
    assert.ok(behind.top >= 40 && behind.top <= 560);
});

test('renders hotspot and direction states, reports selection, and disables hidden hotspots', () => {
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
    hotspots.update(createCamera());

    const front = findByDataset(container, 'pointId', 'front');
    const back = findByDataset(container, 'pointId', 'back');
    assert.equal(findByDataset(container, 'pointId', 'active'), null);
    assert.equal(front.classList.contains('is-offscreen'), false);
    assert.equal(back.classList.contains('is-offscreen'), true);
    front.click();
    assert.deepEqual(selected, ['front']);

    hotspots.setVisible(false);
    assert.equal(container.hidden, true);
    back.click();
    assert.deepEqual(selected, ['front']);
});
