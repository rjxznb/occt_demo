import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

test('3D distribution builds preview, VR, and standalone panorama pages', async () => {
    const configFile = fileURLToPath(new URL('../vite.config.3d.js', import.meta.url));
    const loaded = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        configFile,
    );
    const config = loaded.config;
    const inputs = config.build?.rollupOptions?.input ?? {};

    assert.equal(config.base, './');
    assert.equal(config.build?.outDir, 'dist-3d');
    assert.equal(path.basename(inputs.preview ?? ''), 'index-3d.html');
    assert.equal(path.basename(inputs.vr ?? ''), 'index-vr.html');
    assert.equal(path.basename(inputs.panorama ?? ''), 'index-panorama.html');
});
