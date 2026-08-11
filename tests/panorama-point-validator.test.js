import test from 'node:test';
import assert from 'node:assert/strict';

import {
    pointToSegmentDistance,
    validatePanoramaPoint,
} from '../src/panorama/PanoramaPointValidator.js';

const ROOMS = {
    roomPoints: [[
        [0, 0, 0],
        [4000, 0, 0],
        [4000, 3000, 0],
        [0, 3000, 0],
    ]],
    roomNames: ['客厅'],
};

test('accepts a point with wall clearance and reports its room', () => {
    const result = validatePanoramaPoint({ x: 2000, y: 1500 }, {
        ...ROOMS,
        obstacles: [],
        minWallDistance: 100,
        cameraRadius: 50,
    });

    assert.deepEqual(result, {
        valid: true,
        code: 'OK',
        roomIndex: 0,
        roomName: '客厅',
        degraded: false,
    });
});

test('rejects points outside every room and points too close to a wall', () => {
    assert.deepEqual(
        validatePanoramaPoint({ x: 5000, y: 1500 }, { ...ROOMS, obstacles: [] }),
        {
            valid: false,
            code: 'OUTSIDE_ROOM',
            roomIndex: -1,
            roomName: '',
            degraded: false,
        },
    );

    const nearWall = validatePanoramaPoint({ x: 120, y: 1500 }, {
        ...ROOMS,
        obstacles: [],
        minWallDistance: 100,
        cameraRadius: 50,
    });
    assert.equal(nearWall.valid, false);
    assert.equal(nearWall.code, 'TOO_CLOSE_TO_WALL');
    assert.equal(nearWall.roomIndex, 0);
    assert.equal(nearWall.distance, 120);
    assert.equal(nearWall.requiredClearance, 150);
});

test('rejects a point when the camera footprint overlaps a fixed obstacle', () => {
    const result = validatePanoramaPoint({ x: 1450, y: 1000 }, {
        ...ROOMS,
        minWallDistance: 0,
        cameraRadius: 100,
        obstacles: [{ id: 'cabinet', minX: 1500, minY: 800, maxX: 1900, maxY: 1200 }],
    });

    assert.equal(result.valid, false);
    assert.equal(result.code, 'BLOCKED');
    assert.equal(result.obstacleId, 'cabinet');
});

test('allows XY overlap when the camera clearance is above the obstacle', () => {
    const result = validatePanoramaPoint({ x: 1700, y: 1000, z: 1500 }, {
        ...ROOMS,
        minWallDistance: 0,
        cameraRadius: 80,
        obstacles: [{
            id: 'table', minX: 1500, minY: 800, minZ: 0,
            maxX: 1900, maxY: 1200, maxZ: 750,
        }],
    });

    assert.equal(result.valid, true);
    assert.equal(result.code, 'OK');
});

test('rejects full XYZ overlap with a fixed obstacle', () => {
    const result = validatePanoramaPoint({ x: 1700, y: 1000, z: 800 }, {
        ...ROOMS,
        minWallDistance: 0,
        cameraRadius: 80,
        obstacles: [{
            id: 'cabinet', minX: 1500, minY: 800, minZ: 0,
            maxX: 1900, maxY: 1200, maxZ: 900,
        }],
    });

    assert.equal(result.valid, false);
    assert.equal(result.code, 'BLOCKED');
    assert.equal(result.obstacleId, 'cabinet');
});

test('handles concave rooms and boundary points deterministically', () => {
    const concave = [[
        [0, 0], [3000, 0], [3000, 1000],
        [1000, 1000], [1000, 3000], [0, 3000],
    ]];

    assert.equal(validatePanoramaPoint({ x: 500, y: 2500 }, {
        roomPoints: concave,
        roomNames: ['L 型房'],
        obstacles: [],
        minWallDistance: 0,
        cameraRadius: 0,
    }).valid, true);
    assert.equal(validatePanoramaPoint({ x: 2000, y: 2000 }, {
        roomPoints: concave,
        roomNames: ['L 型房'],
        obstacles: [],
        minWallDistance: 0,
        cameraRadius: 0,
    }).code, 'OUTSIDE_ROOM');
    assert.equal(validatePanoramaPoint({ x: 0, y: 500 }, {
        roomPoints: concave,
        roomNames: ['L 型房'],
        obstacles: [],
        minWallDistance: 1,
        cameraRadius: 0,
    }).code, 'TOO_CLOSE_TO_WALL');
});

test('marks validation as degraded when obstacle data is not ready', () => {
    const result = validatePanoramaPoint({ x: 2000, y: 1500 }, {
        ...ROOMS,
        obstacles: null,
        minWallDistance: 100,
        cameraRadius: 50,
    });

    assert.equal(result.valid, true);
    assert.equal(result.degraded, true);
});

test('computes the literal shortest distance to a wall segment', () => {
    assert.equal(
        pointToSegmentDistance({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
        4,
    );
    assert.equal(
        pointToSegmentDistance({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
        5,
    );
});
