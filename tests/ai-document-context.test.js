import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAiDocumentContext } from '../src/ai-concept/AiDocumentContext.js';

const FACTS = {
    dataSourceId: 'data/Drawing2.json',
    roomPoints: [[[0, 0, 0], [1000, 0, 0], [1000, 800, 0], [0, 800, 0]]],
    roomNames: ['客厅'],
    contentModels: [{ instanceId: 'sofa-1', typeId: 'soft' }],
};

test('uses explicit AI plan and version query parameters', () => {
    assert.deepEqual(resolveAiDocumentContext({
        ...FACTS,
        search: '?fixture=cameras&planId=scheme-42&version=revision-7',
    }), {
        planId: 'scheme-42',
        version: 'revision-7',
        planIdSource: 'query',
        versionSource: 'query',
    });
});
test('fingerprints rooms and content without depending on camera_list', () => {
    const first = resolveAiDocumentContext({ ...FACTS, cameraList: [{ id: 1 }] });
    const changedCamera = resolveAiDocumentContext({ ...FACTS, cameraList: [{ id: 2 }] });
    const changedContent = resolveAiDocumentContext({
        ...FACTS,
        contentModels: [{ instanceId: 'table-2', typeId: 'soft' }],
    });

    assert.deepEqual(first, changedCamera);
    assert.match(first.version, /^drawing-[0-9a-f]{8}$/);
    assert.notEqual(first.version, changedContent.version);
});
