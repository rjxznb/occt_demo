import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiGenerationRepository } from '../server/ai-concept/AiGenerationRepository.mjs';

async function withRepository(run) {
    const rootDir = await mkdtemp(join(tmpdir(), 'occt-ai-repo-'));
    try {
        await run(new AiGenerationRepository({ rootDir }), rootDir);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
}

function job(overrides = {}) {
    return {
        id: 'job-001', requestId: 'request-001', planId: '方案/甲', planVersion: 'v1:初版',
        status: 'running', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
        items: [{ id: 'item-001', status: 'running' }],
        ...overrides,
    };
}

test('creates and atomically replaces isolated job metadata', async () => {
    await withRepository(async (repository, rootDir) => {
        await repository.createJob(job());
        await repository.saveJob(job({ status: 'queued', items: [{ id: 'item-001', status: 'queued' }] }));
        const loaded = await repository.loadJob('job-001');
        assert.equal(loaded.status, 'queued');
        const files = await readdir(rootDir, { recursive: true });
        assert.equal(files.filter(name => String(name).endsWith('.tmp')).length, 0);
        const metadataPath = files.find(name => String(name).endsWith('job.json'));
        assert.ok(metadataPath);
        assert.equal(JSON.parse(await readFile(join(rootDir, metadataPath), 'utf8')).id, 'job-001');
    });
});

test('writes controlled input and output assets without exposing absolute paths', async () => {
    await withRepository(async repository => {
        await repository.createJob(job());
        const input = await repository.writeInput('job-001', 'input-001', Buffer.from('webp'), 'image/webp');
        const output = await repository.writeOutput('job-001', 'output-001', Buffer.from('png'), 'image/png');
        assert.deepEqual(input, {
            assetId: 'input-001', mimeType: 'image/webp', url: '/api/ai-concept/jobs/job-001/assets/input-001',
        });
        assert.equal(output.url, '/api/ai-concept/jobs/job-001/assets/output-001');
        assert.equal((await repository.readAsset('job-001', 'input-001')).bytes.toString(), 'webp');
        assert.equal((await repository.readAsset('job-001', 'output-001')).bytes.toString(), 'png');
        await assert.rejects(repository.writeInput('job-001', '../escape', Buffer.from('x'), 'image/webp'), /INVALID_ASSET_ID/);
        await assert.rejects(repository.loadJob('../escape'), /INVALID_JOB_ID/);
    });
});

test('recovers completed assets and interrupts stale running items after restart', async () => {
    await withRepository(async (repository, rootDir) => {
        const completed = job({
            id: 'job-completed', status: 'completed',
            items: [{ id: 'done', status: 'completed', output: { assetId: 'result-001' } }],
        });
        await repository.createJob(completed);
        await repository.writeOutput('job-completed', 'result-001', Buffer.from('result'), 'image/png');
        await repository.createJob(job());

        const restarted = new AiGenerationRepository({ rootDir });
        const recoverable = await restarted.listRecoverableJobs();
        assert.deepEqual(recoverable.map(entry => entry.id), ['job-001']);
        assert.equal(recoverable[0].items[0].status, 'interrupted');
        assert.equal(recoverable[0].status, 'queued');
        const result = await restarted.readAsset('job-completed', 'result-001');
        assert.equal(result.bytes.toString(), 'result');
        assert.equal((await stat(result.path)).isFile(), true);
    });
});
