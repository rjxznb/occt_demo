import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import ParseJson from '../src/utils/json_parse.js';
import { generateAiViewCandidates } from '../src/ai-concept/AiViewCandidateGenerator.js';
import { resolveAiDocumentContext } from '../src/ai-concept/AiDocumentContext.js';

const drawingUrl = new URL('../public/data/Drawing2.json', import.meta.url);

async function loadParsedDrawing() {
    const raw = JSON.parse(await readFile(drawingUrl, 'utf8'));
    const parsed = ParseJson(structuredClone(raw));
    parsed.Room_Points.forEach(room => {
        for (let index = 0; index < room.length; index += 1) {
            if (typeof room[index] === 'object' && !Array.isArray(room[index])) {
                room[index] = [room[index].x, room[index].y, room[index].z || 0, room[index].bulge || 0];
            }
        }
    });
    return { raw, parsed };
}

test('real Drawing2 deterministically produces isolated room candidates', async () => {
    const { raw, parsed } = await loadParsedDrawing();
    const rooms = {
        roomPoints: parsed.Room_Points,
        roomNames: parsed.Room_Names || [],
        roomInfo: parsed.Room_Info || [],
    };
    const context = resolveAiDocumentContext({
        dataSourceId: 'data/Drawing2.json',
        roomPoints: rooms.roomPoints,
        roomNames: rooms.roomNames,
        contentModels: parsed.content_models || [],
    });
    const input = {
        context,
        rooms,
        doorWindows: {
            doors: parsed.door_list || [],
            windows: parsed.window_list || [],
        },
        obstacles: null,
    };
    const first = generateAiViewCandidates(input);
    const repeated = generateAiViewCandidates(structuredClone(input));

    assert.deepEqual(first, repeated);
    assert.ok(first.candidates.length > 0);
    assert.ok(first.candidates.some(view => view.roomType === 'primary'));
    assert.ok(first.candidates.every(view => [
        view.x, view.y, view.z, view.yaw, view.pitch, view.fov,
    ].every(Number.isFinite)));
    const candidateRoomIds = new Set(first.candidates.map(view => view.roomId));
    assert.ok(candidateRoomIds.size > 1, 'the all-room workbench receives candidates from multiple rooms');
    assert.deepEqual(
        [...candidateRoomIds].sort(),
        [...new Set(first.roomResults
            .filter(room => first.candidates.some(view => view.roomId === room.roomId))
            .map(room => room.roomId))].sort(),
    );
    for (const room of first.roomResults) {
        assert.ok(first.candidates.filter(view => view.roomId === room.roomId).length <= 4);
        assert.ok(first.candidates.filter(view => view.roomId === room.roomId && view.selected).length <= 1);
    }
    const cameraIds = new Set((raw.camera_list || []).map(item => String(item.id ?? item.InstanceId ?? item.Guid ?? '')));
    assert.ok(first.candidates.every(view => !cameraIds.has(view.id)));
});
