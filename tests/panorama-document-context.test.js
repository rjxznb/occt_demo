import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePanoramaDocumentContext } from '../src/panorama/PanoramaDocumentContext.js';

const DOCUMENT_FACTS = {
    dataSourceId: 'data/Drawing2.json',
    roomPoints: [[[0, 0, 0], [1000, 0, 0], [1000, 800, 0], [0, 800, 0]]],
    cameraList: [{ TypeId: '27d2', BasePoint: 'X=500 Y=400 Z=0' }],
};

test('uses explicit plan and version query parameters when supplied', () => {
    const context = resolvePanoramaDocumentContext({
        ...DOCUMENT_FACTS,
        search: '?fixture=cameras&planId=scheme-42&version=revision-7',
    });

    assert.deepEqual(context, {
        planId: 'scheme-42',
        version: 'revision-7',
        planIdSource: 'query',
        versionSource: 'query',
    });
});

test('derives stable isolated context and changes the version when drawing facts change', () => {
    const first = resolvePanoramaDocumentContext(DOCUMENT_FACTS);
    const repeated = resolvePanoramaDocumentContext(structuredClone(DOCUMENT_FACTS));
    const changed = resolvePanoramaDocumentContext({
        ...DOCUMENT_FACTS,
        cameraList: [{ TypeId: '27d2', BasePoint: 'X=600 Y=400 Z=0' }],
    });

    assert.deepEqual(first, repeated);
    assert.equal(first.planId, 'data/Drawing2.json');
    assert.equal(first.planIdSource, 'data-source');
    assert.equal(first.versionSource, 'fingerprint');
    assert.match(first.version, /^drawing-[0-9a-f]{8}$/);
    assert.notEqual(first.version, changed.version);
});
