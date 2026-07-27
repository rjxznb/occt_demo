import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ParametricModelLoader delegates API traffic to ParametricApiClient', async () => {
    const source = await readFile(
        new URL('../src/components/ParametricModelLoader.js', import.meta.url),
        'utf8',
    );
    assert.match(source, /parametricApiClient/);
    assert.match(source, /apiClient\.getGoodsDetail/);
    assert.match(source, /apiClient\.convertModel/);
    assert.doesNotMatch(source, /localhost:3100/);
    assert.doesNotMatch(source, /fetch\s*\(/);
});
