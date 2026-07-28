import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const APP_PATH = new URL('../src/App3D.js', import.meta.url);
const ROOM_RENDERER_PATH = new URL('../src/components/RoomRenderer.js', import.meta.url);

test('App3D reports only fixed boot and data-load diagnostic stages', async () => {
    const source = await readFile(APP_PATH, 'utf8');

    assert.match(source, /__renderPreviewDiagnostic\?\.\('app-boot', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-start', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-ready', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('data-load-error', 'DATA_ERROR'\)/);
    assert.doesNotMatch(source, /__renderPreviewDiagnostic\?\.\([^'\n]/);
});

test('RoomRenderer reports fixed content-load start, summary, and error stages', async () => {
    const source = await readFile(ROOM_RENDERER_PATH, 'utf8');

    assert.match(source, /__renderPreviewDiagnostic\?\.\('content-load-start', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('content-load-summary', 'OK'\)/);
    assert.match(source, /__renderPreviewDiagnostic\?\.\('content-load-error', 'CONTENT_ERROR'\)/);
    assert.doesNotMatch(source, /__renderPreviewDiagnostic\?\.\([^'\n]/);
});
