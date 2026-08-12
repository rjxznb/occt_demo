import test from 'node:test';
import assert from 'node:assert/strict';

import { pointInPolygon } from '../src/panorama/PanoramaPointModel.js';
import { generateAiViewCandidates } from '../src/ai-concept/AiViewCandidateGenerator.js';

const CONTEXT = { planId: 'plan-test', version: 'v1' };

function rectangle(width, depth, originX = 0, originY = 0) {
    return [
        [originX, originY, 0],
        [originX + width, originY, 0],
        [originX + width, originY + depth, 0],
        [originX, originY + depth, 0],
    ];
}

function fixture({
    polygon = rectangle(4200, 3200),
    name = '客厅',
    obstacles = [],
    doorWindows = {},
} = {}) {
    return {
        context: CONTEXT,
        rooms: {
            roomPoints: [polygon],
            roomNames: [name],
            roomInfo: [{ name }],
        },
        doorWindows,
        obstacles,
    };
}

test('generates stable normal-room candidates and selects only the best primary view', () => {
    const first = generateAiViewCandidates(fixture());
    const repeated = generateAiViewCandidates(structuredClone(fixture()));

    assert.deepEqual(first, repeated);
    assert.equal(first.candidates.length, 3);
    assert.equal(first.candidates.filter(candidate => candidate.selected).length, 1);
    assert.equal(first.candidates[0].selected, true);
    assert.ok(first.candidates.every(candidate => candidate.fov >= 80 && candidate.fov <= 100));
});

test('limits small rooms to two and large or irregular rooms to four candidates', () => {
    const small = generateAiViewCandidates(fixture({ polygon: rectangle(2400, 2400), name: '书房' }));
    const large = generateAiViewCandidates(fixture({ polygon: rectangle(7000, 5000), name: '客厅' }));
    const irregular = generateAiViewCandidates(fixture({
        name: '主卧',
        polygon: [[0, 0, 0], [5000, 0, 0], [5000, 1800, 0], [3200, 1800, 0], [3200, 4200, 0], [0, 4200, 0]],
    }));

    assert.equal(small.candidates.length, 2);
    assert.equal(large.candidates.length, 4);
    assert.equal(irregular.candidates.length, 4);
});

test('secondary rooms generate candidates without selecting them', () => {
    const result = generateAiViewCandidates(fixture({ name: '卫生间' }));
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every(candidate => candidate.roomType === 'secondary'));
    assert.ok(result.candidates.every(candidate => candidate.selected === false));
});

test('never keeps stations outside a concave room polygon', () => {
    const polygon = [[0, 0, 0], [5000, 0, 0], [5000, 1800, 0], [2200, 1800, 0], [2200, 4500, 0], [0, 4500, 0]];
    const result = generateAiViewCandidates(fixture({ polygon, name: 'L 型客厅' }));

    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every(candidate => pointInPolygon(candidate.x, candidate.y, polygon)));
});

test('keeps candidates above low furniture when vertical bounds do not overlap', () => {
    const result = generateAiViewCandidates(fixture({
        obstacles: [{
            id: 'low-platform',
            minX: -1000, minY: -1000, minZ: 0,
            maxX: 6000, maxY: 5000, maxZ: 700,
        }],
    }));

    assert.equal(result.candidates.length, 3);
    assert.ok(result.candidates.every(candidate => candidate.valid));
});

test('reports degraded validation when obstacle bounds are unavailable', () => {
    const result = generateAiViewCandidates(fixture({ obstacles: null }));

    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every(candidate => candidate.validationMode === 'degraded'));
    assert.ok(result.roomResults.every(room => room.degraded === true));
});

test('returns an empty room result with a stable failure reason when all stations are blocked', () => {
    const result = generateAiViewCandidates(fixture({
        obstacles: [{
            id: 'room-filling-obstacle',
            minX: -1000, minY: -1000, minZ: 0,
            maxX: 6000, maxY: 5000, maxZ: 3000,
        }],
    }));

    assert.equal(result.candidates.length, 0);
    assert.equal(result.roomResults[0].status, 'empty');
    assert.equal(result.roomResults[0].reason, 'BLOCKED');
});
