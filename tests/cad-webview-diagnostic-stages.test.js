import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { startSceneContentModelLoads } from '../src/components/RoomRenderer.js';

const APP_PATH = new URL('../src/App3D.js', import.meta.url);

test('App3D reports only fixed boot and data-load diagnostic stages', async () => {
    const source = await readFile(APP_PATH, 'utf8');

    assert.match(source, /__renderPreviewDiagnostic\?\.\('app-boot', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-start', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-ready', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-error', 'DATA_ERROR'\)/);
    assert.doesNotMatch(source, /__renderPreviewDiagnostic\?\.\([^'\n]/);
});

test('RoomRenderer reports only fixed soft and content pipeline diagnostic stages', async () => {
    const diagnostics = [];
    const data = {
        softlists: { softlists: [] },
        contentModels: { contentModels: [] },
    };
    const success = startSceneContentModelLoads(data, {}, new Map(), {
        diagnostic: (stage, code) => diagnostics.push([stage, code]),
        async loadSoft() { return []; },
        async loadContent() { return { summary: {}, failures: [] }; },
        logger: { log() {}, warn() {} },
    });
    await Promise.all([success.softLoad, success.contentLoad]);

    const failure = startSceneContentModelLoads(data, {}, new Map(), {
        diagnostic: (stage, code) => diagnostics.push([stage, code]),
        async loadSoft() { throw new Error('soft failed'); },
        async loadContent() { throw new Error('content failed'); },
        logger: { log() {}, warn() {} },
    });
    await Promise.all([failure.softLoad, failure.contentLoad]);

    assert.deepEqual(diagnostics, [
        ['soft-load-start', 'OK'],
        ['content-load-start', 'OK'],
        ['soft-load-summary', 'OK'],
        ['content-load-summary', 'OK'],
        ['soft-load-start', 'OK'],
        ['content-load-start', 'OK'],
        ['soft-load-error', 'PARAMETRIC_ERROR'],
        ['content-load-error', 'CONTENT_ERROR'],
    ]);
});
