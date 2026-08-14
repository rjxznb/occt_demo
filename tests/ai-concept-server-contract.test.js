import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startAiConceptServer } from '../server/ai-concept-server.mjs';

async function withServer(options, run) {
    const root = await mkdtemp(join(tmpdir(), 'occt-ai-server-'));
    const runtimeDir = join(root, 'runtime');
    const staticDir = join(root, 'dist-3d');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(staticDir, { recursive: true }));
    await writeFile(join(staticDir, 'index-ai-concept.html'), '<!doctype html><title>AI Concept Contract</title>');
    const server = await startAiConceptServer({
        host: '127.0.0.1', port: 0, runtimeDir, staticDir, apiKey: '', ...options,
    });
    try {
        await run(server);
    } finally {
        await server.close();
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
    }
}

test('development API starts without a key, exposes catalog, and rejects generation before persistence', async () => {
    await withServer({ production: false }, async ({ origin }) => {
        const catalog = await fetch(`${origin}/api/ai-concept/catalog`);
        assert.equal(catalog.status, 200);
        assert.equal((await catalog.json()).configured, false);

        const create = await fetch(`${origin}/api/ai-concept/jobs`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        });
        assert.equal(create.status, 503);
        assert.equal((await create.json()).code, 'OPENAI_NOT_CONFIGURED');

        const staticPage = await fetch(`${origin}/index-ai-concept.html`);
        assert.equal(staticPage.status, 404);
    });
});

test('production mode serves only controlled dist files and rejects traversal', async () => {
    await withServer({ production: true }, async ({ origin }) => {
        const page = await fetch(`${origin}/index-ai-concept.html`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /AI Concept Contract/);

        const traversal = await fetch(`${origin}/..%2Fpackage.json`);
        assert.equal(traversal.status, 404);
        assert.doesNotMatch(await traversal.text(), /scripts|dependencies/);
    });
});

test('server validates concurrency and graceful close releases the listener', async () => {
    await assert.rejects(
        startAiConceptServer({ concurrency: 0, port: 0 }),
        /INVALID_AI_CONCEPT_CONCURRENCY/,
    );
    await withServer({ production: false }, async server => {
        await server.close();
        await assert.rejects(fetch(`${server.origin}/api/ai-concept/catalog`));
    });
});
