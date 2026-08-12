import test from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyAiRoom,
    createAiViewId,
    normalizeAiView,
} from '../src/ai-concept/AiViewModel.js';

test('candidate ids are stable after coordinate normalization', () => {
    const base = {
        planId: 'plan-a', version: 'v1', roomId: 'room-0', rule: 'entrance',
        z: 1500, yaw: 90,
    };
    assert.equal(
        createAiViewId({ ...base, x: 1000.004, y: 999.996 }),
        createAiViewId({ ...base, x: 1000, y: 1000 }),
    );
    assert.notEqual(
        createAiViewId({ ...base, x: 1000, y: 1000 }),
        createAiViewId({ ...base, x: 1100, y: 1000 }),
    );
});
test('bathrooms corridors and balconies are secondary rooms', () => {
    for (const name of ['卫生间', '客卫', '过道', '走廊', '阳台']) {
        assert.equal(classifyAiRoom(name), 'secondary');
    }
    for (const name of ['客厅', '餐厅', '主卧', '书房']) {
        assert.equal(classifyAiRoom(name), 'primary');
    }
});

test('normalizes AI views with safe enums and horizontal fov bounds', () => {
    const normalized = normalizeAiView({
        roomIndex: 2,
        roomName: '主卧',
        x: '1200', y: 900, z: 1500,
        yaw: 450, pitch: -3, fov: 140,
        source: 'unknown', status: 'unknown', selected: 1,
    }, { planId: 'p', version: 'v' });

    assert.equal(normalized.roomId, 'room-2');
    assert.equal(normalized.source, 'auto');
    assert.equal(normalized.status, 'available');
    assert.equal(normalized.selected, true);
    assert.equal(normalized.fov, 100);
    assert.equal(normalized.yaw, 90);
    assert.equal(normalized.planId, 'p');
    assert.equal(normalized.planVersion, 'v');
});
