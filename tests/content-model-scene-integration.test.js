import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import geometryService from '../src/core/GeometryService.js';
import { DoorWindowFactory } from '../src/components/DoorWindowFactory.js';
import {
    handlePlacedContentModel,
    hidePlacedFallback,
    indexDoorWindowFallbacks,
} from '../src/components/RoomRenderer.js';

const openingPoints = [
    { x: 0, y: 0 },
    { x: 900, y: 0 },
    { x: 900, y: 120 },
    { x: 0, y: 120 },
];

test('GeometryService exposes every normalized content model without removing legacy softlists', async () => {
    const previousParseData = geometryService.parseData;
    const contentModels = [
        { instanceId: 'soft_list:0', sourceList: 'soft_list', sourceIndex: 0, category: 'soft' },
        { instanceId: 'door_list:0', sourceList: 'door_list', sourceIndex: 0, category: 'door' },
        { instanceId: 'window_list:0', sourceList: 'window_list', sourceIndex: 0, category: 'window' },
        { instanceId: 'radiator_list:0', sourceList: 'radiator_list', sourceIndex: 0, category: 'radiator' },
    ];
    const softlists = [{ id: 'legacy-softlist' }];
    geometryService.parseData = { content_models: contentModels, SoftLists: softlists };

    try {
        assert.deepEqual(await geometryService.getContentModels(), {
            success: true,
            contentModels,
        });
        assert.deepEqual(await geometryService.getSoftlists(), {
            success: true,
            softlists,
        });
    } finally {
        geometryService.parseData = previousParseData;
    }
});

test('visible door and window fallbacks retain their source identity', () => {
    const { doors, windows } = DoorWindowFactory.createDoorWindowBatch(
        [{ points: openingPoints, height: 2100, typeId: 'door-type' }],
        [{ points: openingPoints, height: 1400, groundHeight: 800, typeId: 'window-type' }],
    );

    assert.equal(doors[0].userData.sourceList, 'door_list');
    assert.equal(doors[0].userData.sourceIndex, 0);
    assert.equal(windows[0].userData.sourceList, 'window_list');
    assert.equal(windows[0].userData.sourceIndex, 0);
});

test('fallback visibility helper hides only the matching source identity', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const window = new THREE.Mesh();
    window.userData = { sourceList: 'window_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [window] });

    assert.equal(hidePlacedFallback(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }), true);
    assert.equal(door.visible, false);
    assert.equal(window.visible, true);
});

test('a placed door model marks its root and hides only its matching visible fallback', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const window = new THREE.Mesh();
    window.userData = { sourceList: 'window_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [window] });
    const root = new THREE.Group();

    assert.equal(handlePlacedContentModel(fallbackMap, {
        sourceList: 'door_list', sourceIndex: 0,
    }, root), true);
    assert.equal(root.userData.contentModelRoot, true);
    assert.equal(door.visible, false);
    assert.equal(window.visible, true);
});

test('the post-placement hook marks the real root and leaves unmatched fallbacks visible', () => {
    const door = new THREE.Mesh();
    door.userData = { sourceList: 'door_list', sourceIndex: 0 };
    const fallbackMap = indexDoorWindowFallbacks({ doors: [door], windows: [] });
    const root = new THREE.Group();

    handlePlacedContentModel(fallbackMap, {
        sourceList: 'window_list', sourceIndex: 4,
    }, root);

    assert.equal(root.userData.contentModelRoot, true);
    assert.equal(door.visible, true);
});
