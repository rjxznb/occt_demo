import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateMiniMapLayout,
    normalizeCameraPresets,
    parseCadVector,
} from '../src/components/CameraPresetMap.js';

test('parses CAD camera vectors and normalizes height, yaw and FOV', () => {
    assert.deepEqual(parseCadVector('X=-120.5 Y=80 Z=0.000'), { x: -120.5, y: 80, z: 0 });
    const [camera] = normalizeCameraPresets([{
        TypeId: '27d2',
        BasePoint: 'X=100 Y=200 Z=0',
        BlockInnerInfo: { 离地高度: 1600, 旋转角度: 90, FOV: 130 },
    }]);
    assert.deepEqual(
        { x: camera.x, y: camera.y, z: camera.z, yaw: camera.yaw, pitch: camera.pitch, fov: camera.fov },
        { x: 100, y: 200, z: 1600, yaw: 90, pitch: 0, fov: 130 },
    );
});

test('Rotation vector takes precedence and mini-map flips world Y into screen top', () => {
    const [camera] = normalizeCameraPresets([{
        TypeId: '27d202',
        BasePoint: 'X=10 Y=20 Z=0',
        BlockInnerInfo: { Rotation: 'X=-10 Y=45 Z=0', 离地高度: 1500 },
    }]);
    assert.equal(camera.pitch, -10);
    assert.equal(camera.yaw, 45);

    const layout = calculateMiniMapLayout([[[0, 0, 0], [100, 100, 0]]], [camera], 0);
    assert.equal(layout.toPercent(100, 100).left, 100);
    assert.equal(layout.toPercent(100, 100).top, 0);
});
