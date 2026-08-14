import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { STYLE_CATALOG } from '../src/ai-concept/AiGenerationCatalog.js';

test('every generation style resolves to a substantial project-owned image', async () => {
    const failures = [];
    for (const style of STYLE_CATALOG) {
        const path = resolve('public', style.imageUrl.replace(/^\.\//, ''));
        try {
            const info = await stat(path);
            if (!info.isFile() || info.size <= 100_000) failures.push(style.id);
        } catch {
            failures.push(style.id);
        }
    }
    assert.deepEqual(failures, []);
});
