import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SceneManager } from '../src/core/SceneManager.js';
import { RoomRenderer } from '../src/components/RoomRenderer.js';

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
