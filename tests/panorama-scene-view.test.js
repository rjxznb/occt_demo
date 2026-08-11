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
    manager.controls = { target: new THREE.Vector3(), enabled: false };
    manager._cameraPresetTransition = null;
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

test('transitions a fixed-point camera with eased position, shortest yaw, pitch, and FOV', () => {
    const manager = createActiveManager();
    manager.cameraPresetYaw = THREE.MathUtils.degToRad(170);

    assert.equal(manager.transitionCameraPreset({
        x: 900, y: 600, z: 1700,
        yaw: -170, pitch: 10, fov: 80,
    }), true);

    manager._updateCameraPresetTransition(0.4);
    const halfway = manager.getCameraPresetPose();
    assert.deepEqual([halfway.x, halfway.y, halfway.z], [500, 400, 1600]);
    assert.equal(Math.abs(Math.abs(halfway.yaw) - 180) < 1e-8, true);
    assert.equal(halfway.pitch, 0);
    assert.equal(halfway.fov, 90);

    manager._updateCameraPresetTransition(0.4);
    assert.deepEqual(manager.getCameraPresetPose(), {
        x: 900, y: 600, z: 1700,
        yaw: -170, pitch: 10, fov: 80,
    });
    assert.equal(manager._cameraPresetTransition, null);
});

test('replaces an active transition from the current live camera pose', () => {
    const manager = createActiveManager();
    manager.transitionCameraPreset({ x: 900, y: 200, z: 1500, yaw: 90, pitch: 0, fov: 90 });
    manager._updateCameraPresetTransition(0.4);
    const interruptedAt = manager.getCameraPresetPose();

    assert.equal(manager.transitionCameraPreset({
        x: 300, y: 800, z: 1600, yaw: 0, pitch: 5, fov: 70,
    }), true);
    assert.deepEqual(manager._cameraPresetTransition.from, interruptedAt);
});

test('rejects an invalid transition without changing the live camera pose', () => {
    const manager = createActiveManager();
    const before = manager.getCameraPresetPose();

    assert.equal(manager.transitionCameraPreset({
        x: Number.NaN, y: 800, z: 1600, yaw: 0, pitch: 5, fov: 70,
    }), false);
    assert.deepEqual(manager.getCameraPresetPose(), before);
    assert.equal(manager._cameraPresetTransition, null);
});

test('falls back to immediate preset entry when fixed-point mode is inactive', () => {
    const manager = createActiveManager();
    manager.cameraPresetViewState = null;
    manager.setCameraPreset = point => {
        manager.fallbackPoint = point;
        return true;
    };
    const point = { x: 1, y: 2, z: 3, yaw: 4, pitch: 5, fov: 90 };

    assert.equal(manager.transitionCameraPreset(point), true);
    assert.equal(manager.fallbackPoint, point);
});

test('starting a fixed-point drag cancels the active camera transition', () => {
    const manager = createActiveManager();
    manager._cameraPresetTransition = { elapsed: 0 };
    const classNames = new Set();
    const event = {
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 120,
        preventDefault() {},
        stopImmediatePropagation() {},
        currentTarget: {
            setPointerCapture() {},
            classList: { add: name => classNames.add(name) },
        },
    };

    manager.onCameraPresetPointerDown(event);

    assert.equal(manager._cameraPresetTransition, null);
    assert.equal(classNames.has('camera-preset-dragging'), true);
});

test('an immediate edit preview cancels the active camera transition', () => {
    const manager = createActiveManager();
    manager._cameraPresetTransition = { elapsed: 0 };

    assert.equal(manager.updateCameraPresetPose({ x: 300, y: 400, z: 1600 }), true);
    assert.equal(manager._cameraPresetTransition, null);
    assert.deepEqual(manager.perspectiveCamera.position.toArray(), [300, 400, 1600]);
});
