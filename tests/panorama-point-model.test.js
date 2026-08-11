import test from 'node:test';
import assert from 'node:assert/strict';

import {
    normalizePanoramaPoints,
    selectInitialPanoramaPoint,
} from '../src/panorama/PanoramaPointModel.js';

const ROOM_POINTS = [[
    [0, 0, 0],
    [4000, 0, 0],
    [4000, 3000, 0],
    [0, 3000, 0],
]];

test('normalizes CAD camera facts into a stable point assigned to its room', () => {
    const cameraList = [{
        TypeId: '27d2',
        BasePoint: 'X=1200 Y=800 Z=0',
        BlockInnerInfo: {
            Rotation: 'X=-5 Y=35 Z=0',
            离地高度: 1650,
            FOV: 170,
        },
        DisplayName: '床尾点位',
    }];

    const first = normalizePanoramaPoints(cameraList, {
        roomPoints: ROOM_POINTS,
        roomNames: ['主卧'],
    });
    const second = normalizePanoramaPoints(structuredClone(cameraList), {
        roomPoints: ROOM_POINTS,
        roomNames: ['主卧'],
    });

    assert.equal(first.length, 1);
    assert.deepEqual(
        {
            name: first[0].name,
            x: first[0].x,
            y: first[0].y,
            z: first[0].z,
            yaw: first[0].yaw,
            pitch: first[0].pitch,
            fov: first[0].fov,
            roomIndex: first[0].roomIndex,
            roomName: first[0].roomName,
        },
        {
            name: '床尾点位',
            x: 1200,
            y: 800,
            z: 1650,
            yaw: 35,
            pitch: -5,
            fov: 150,
            roomIndex: 0,
            roomName: '主卧',
        },
    );
    assert.match(first[0].id, /^camera:/);
    assert.equal(first[0].id, second[0].id);
    assert.equal(first[0].valid, true);
});

test('rejects unsupported camera records and records outside rooms as invalid', () => {
    const points = normalizePanoramaPoints([
        { TypeId: '1408', BasePoint: 'X=100 Y=100 Z=0' },
        { TypeId: '27d2' },
        { TypeId: '27d202', BasePoint: 'X=9000 Y=9000 Z=0' },
    ], {
        roomPoints: ROOM_POINTS,
        roomNames: ['主卧'],
    });

    assert.equal(points.length, 1);
    assert.equal(points[0].valid, false);
    assert.equal(points[0].invalidReason, 'OUTSIDE_ROOM');
    assert.equal(points[0].roomIndex, -1);
});

test('chooses configured initial point, then last active point, then the first valid point', () => {
    const points = [
        { id: 'invalid', valid: false },
        { id: 'first', valid: true },
        { id: 'initial', valid: true },
    ];

    assert.equal(selectInitialPanoramaPoint(points, {
        initialPointId: 'initial',
        lastActivePointId: 'first',
    }).id, 'initial');
    assert.equal(selectInitialPanoramaPoint(points, {
        initialPointId: 'invalid',
        lastActivePointId: 'first',
    }).id, 'first');
    assert.equal(selectInitialPanoramaPoint(points, {
        initialPointId: 'missing',
        lastActivePointId: 'missing',
    }).id, 'first');
    assert.equal(selectInitialPanoramaPoint([{ id: 'only', valid: false }]), null);
});
