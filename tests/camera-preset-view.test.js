import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneManager } from '../src/core/SceneManager.js';
import { RoomRenderer } from '../src/components/RoomRenderer.js';

const closeTo = (actual, expected, epsilon = 1e-6) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
};

test('entering a camera preset interprets point FOV as horizontal degrees', () => {
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetViewState = null;
    manager.cameraPresetHorizontalFov = null;
    manager.currentViewMode = '3d';
    manager.perspectiveCamera = new THREE.PerspectiveCamera(75, 16 / 9, 1, 10000);
    manager.controls = { target: new THREE.Vector3(), enabled: true };
    manager.renderer = { domElement: { classList: { add() {} } } };
    manager.getAutoRotationStatus = () => ({ enabled: false });
    manager.switchToPerspectiveView = () => {};
    manager.enableAutoRotation = () => {};
    manager.activateOutdoorPanorama = () => false;

    assert.equal(manager.setCameraPreset({
        x: 100,
        y: 200,
        z: 1500,
        yaw: 0,
        pitch: 0,
        fov: 90,
    }), true);

    assert.equal(manager.getCameraPresetPose().fov, 90);
    closeTo(manager.perspectiveCamera.fov, 58.71550708558255);
});

test('camera preset pointer drag rotates view without moving the camera origin', () => {
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetViewState = {};
    manager.cameraPresetPointer = { id: 7, x: 100, y: 100 };
    manager.cameraPresetYaw = 0;
    manager.cameraPresetPitch = 0;
    manager.perspectiveCamera = new THREE.PerspectiveCamera(90, 1, 1, 10000);
    manager.perspectiveCamera.up.set(0, 0, 1);
    manager.perspectiveCamera.position.set(120, 340, 1500);
    manager.controls = { target: new THREE.Vector3() };
    const originalPosition = manager.perspectiveCamera.position.clone();

    manager.onCameraPresetPointerMove({
        pointerId: 7,
        clientX: 180,
        clientY: 60,
        preventDefault() {},
        stopImmediatePropagation() {},
    });

    assert.ok(manager.perspectiveCamera.position.equals(originalPosition));
    assert.notEqual(manager.cameraPresetYaw, 0);
    assert.notEqual(manager.cameraPresetPitch, 0);
    assert.ok(manager.controls.target.distanceTo(originalPosition) > 999);
});

test('disabled camera preset interaction ignores pointer drag and wheel zoom', () => {
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetViewState = {};
    manager.cameraPresetInteractionEnabled = false;
    manager.cameraPresetPointer = { id: 7, x: 100, y: 100 };
    manager.cameraPresetYaw = 0;
    manager.cameraPresetPitch = 0;
    manager.cameraPresetHorizontalFov = 90;
    manager.perspectiveCamera = new THREE.PerspectiveCamera(90, 1, 1, 10000);
    manager.controls = { target: new THREE.Vector3() };
    manager.applyCameraPresetHorizontalFov = value => { manager.appliedFov = value; };

    manager.onCameraPresetPointerMove({
        pointerId: 7,
        clientX: 180,
        clientY: 60,
        preventDefault() { throw new Error('disabled drag must not be consumed'); },
        stopImmediatePropagation() { throw new Error('disabled drag must not be consumed'); },
    });
    manager.onCameraPresetWheel({
        deltaY: 120,
        preventDefault() { throw new Error('disabled wheel must not be consumed'); },
        stopImmediatePropagation() { throw new Error('disabled wheel must not be consumed'); },
    });

    assert.equal(manager.cameraPresetYaw, 0);
    assert.equal(manager.cameraPresetPitch, 0);
    assert.equal(manager.appliedFov, undefined);
});

test('disabling camera preset interaction clears an active pointer capture', () => {
    const removed = [];
    const manager = Object.create(SceneManager.prototype);
    manager.cameraPresetInteractionEnabled = true;
    manager.cameraPresetPointer = { id: 11, x: 20, y: 30 };
    manager.renderer = { domElement: {
        releasePointerCapture(id) { manager.releasedPointerId = id; },
        classList: { remove(name) { removed.push(name); } },
    } };

    assert.equal(manager.setCameraPresetInteractionEnabled(false), true);
    assert.equal(manager.cameraPresetPointer, null);
    assert.equal(manager.releasedPointerId, 11);
    assert.deepEqual(removed, ['camera-preset-dragging']);
    assert.equal(manager.setCameraPresetInteractionEnabled(false), false);
});

test('exiting a camera preset restores the saved orbit camera state', () => {
    const manager = Object.create(SceneManager.prototype);
    const savedPosition = new THREE.Vector3(10, 20, 3000);
    const savedQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, 0.3));
    const savedTarget = new THREE.Vector3(40, 50, 0);
    manager.cameraPresetViewState = {
        viewMode: '3d',
        position: savedPosition,
        quaternion: savedQuaternion,
        fov: 75,
        target: savedTarget,
        controlsEnabled: true,
        autoRotationEnabled: true,
    };
    manager.cameraPresetPointer = null;
    manager.perspectiveCamera = new THREE.PerspectiveCamera(90, 1, 1, 10000);
    manager.perspectiveCamera.position.set(500, 600, 1500);
    manager.controls = { target: new THREE.Vector3(), enabled: false, update() {} };
    manager.renderer = { domElement: { classList: { remove() {} } } };
    manager.switchToPerspectiveView = () => {};
    manager.switchToOrthographicView = () => {};
    manager.enableAutoRotation = enabled => { manager.restoredAutoRotation = enabled; };

    assert.equal(manager.exitCameraPreset(), true);
    assert.ok(manager.perspectiveCamera.position.equals(savedPosition));
    assert.ok(manager.perspectiveCamera.quaternion.equals(savedQuaternion));
    assert.ok(manager.controls.target.equals(savedTarget));
    assert.equal(manager.controls.enabled, true);
    assert.equal(manager.restoredAutoRotation, true);
    assert.equal(manager.getCameraPresetPose(), null);
});

test('room ceilings can be shown only for an active camera preset', () => {
    const renderer = Object.create(RoomRenderer.prototype);
    renderer.ceilingMeshes = [{ visible: false }, { visible: false }];
    renderer.sceneManager = { invalidateShadow() {} };

    assert.equal(renderer.setCeilingsVisible(true), true);
    assert.deepEqual(renderer.ceilingMeshes.map(mesh => mesh.visible), [true, true]);

    assert.equal(renderer.setCeilingsVisible(false), false);
    assert.deepEqual(renderer.ceilingMeshes.map(mesh => mesh.visible), [false, false]);
});
