import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SceneManager } from '../src/core/SceneManager.js';

function createActiveManager() {
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetViewState = {};
    manager.cameraPresetYaw = THREE.MathUtils.degToRad(45);
    manager.cameraPresetPitch = THREE.MathUtils.degToRad(-10);
    manager.perspectiveCamera = new THREE.PerspectiveCamera(100, 1, 1, 10000);
    manager.perspectiveCamera.up.set(0, 0, 1);
    manager.perspectiveCamera.position.set(100, 200, 1500);
    manager.controls = { target: new THREE.Vector3() };
    return manager;
}

test('reports the current fixed-point pose in CAD degrees and millimeters', () => {
    const manager = createActiveManager();

    assert.deepEqual(manager.getCameraPresetPose(), {
        x: 100,
        y: 200,
        z: 1500,
        yaw: 45,
        pitch: -10,
        fov: 100,
    });
});

test('updates position while preserving the current panorama orientation by default', () => {
    const manager = createActiveManager();

    assert.equal(manager.updateCameraPresetPose({
        x: 300, y: 400, z: 1650,
        yaw: 120, pitch: 8, fov: 70,
    }), true);

    const pose = manager.getCameraPresetPose();
    assert.deepEqual(pose, {
        x: 300,
        y: 400,
        z: 1650,
        yaw: 45,
        pitch: -10,
        fov: 100,
    });
    assert.ok(manager.controls.target.distanceTo(manager.perspectiveCamera.position) > 999);
});

test('resets orientation and FOV from the selected point without leaving fixed-point mode', () => {
    const manager = createActiveManager();

    assert.equal(manager.resetCameraPresetOrientation({
        x: 100, y: 200, z: 1500,
        yaw: 120, pitch: 8, fov: 70,
    }), true);

    assert.deepEqual(manager.getCameraPresetPose(), {
        x: 100,
        y: 200,
        z: 1500,
        yaw: 120,
        pitch: 8,
        fov: 70,
    });
    assert.equal(manager.cameraPresetViewState instanceof Object, true);
    assert.equal(manager.controls.enabled ?? false, false);
});

test('pose controls are inert outside fixed-point mode', () => {
    const manager = createActiveManager();
    manager.cameraPresetViewState = null;

    assert.equal(manager.getCameraPresetPose(), null);
    assert.equal(manager.updateCameraPresetPose({ x: 1, y: 2, z: 3 }), false);
    assert.equal(manager.resetCameraPresetOrientation({ yaw: 0, pitch: 0, fov: 90 }), false);
});
