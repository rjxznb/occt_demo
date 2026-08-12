import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AI_VIEW_DRAFT_SCHEMA_VERSION,
    LocalAiViewRepository,
} from '../src/ai-concept/AiViewRepository.js';

class MemoryStorage {
    constructor(entries = []) { this.values = new Map(entries); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createRepository(storage = new MemoryStorage()) {
    return {
        storage,
        repository: new LocalAiViewRepository({
            storage,
            clock: () => '2026-08-12T08:00:00.000Z',
            logger: { warn() {} },
        }),
    };
}

test('saves loads and clears an isolated AI view draft', async () => {
    const { repository, storage } = createRepository();
    const draft = { views: [{ id: 'ai-view:a' }], activeViewId: 'ai-view:a' };

    assert.deepEqual(await repository.save('scheme/42', 'revision 7', draft), { ok: true });
    assert.deepEqual(await repository.load('scheme/42', 'revision 7'), { ok: true, draft });
    assert.deepEqual([...storage.values.keys()], [
        `occt.ai-concept.views.v${AI_VIEW_DRAFT_SCHEMA_VERSION}:scheme%2F42:revision%207`,
    ]);
    assert.doesNotMatch([...storage.values.keys()][0], /panorama/);

    assert.deepEqual(await repository.clear('scheme/42', 'revision 7'), { ok: true });
    assert.deepEqual(await repository.load('scheme/42', 'revision 7'), { ok: true, draft: null });
});

test('isolates AI drafts by plan and version', async () => {
    const { repository } = createRepository();
    await repository.save('a', '1', { marker: 'a1' });
    await repository.save('a', '2', { marker: 'a2' });
    assert.equal((await repository.load('a', '1')).draft.marker, 'a1');
    assert.equal((await repository.load('a', '2')).draft.marker, 'a2');
});

test('backs up malformed and incompatible AI drafts', async () => {
    const { repository, storage } = createRepository();
    const malformedKey = repository.keyFor('broken', 'json');
    storage.setItem(malformedKey, '{bad-json');
    const malformed = await repository.load('broken', 'json');
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error.code, 'CORRUPTED_DRAFT');
    assert.equal(storage.getItem(malformedKey), null);
    assert.equal(
        storage.getItem(`${malformedKey}:corrupted:2026-08-12T08%3A00%3A00.000Z`),
        '{bad-json',
    );

    const oldKey = repository.keyFor('old', 'schema');
    storage.setItem(oldKey, JSON.stringify({ schemaVersion: 0, draft: {} }));
    const incompatible = await repository.load('old', 'schema');
    assert.equal(incompatible.ok, false);
    assert.equal(incompatible.error.code, 'INCOMPATIBLE_SCHEMA');
});

test('contains AI storage failures in structured results', async () => {
    const blocked = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
    };
    const { repository } = createRepository(blocked);
    for (const result of [
        await repository.load('p', 'v'),
        await repository.save('p', 'v', {}),
        await repository.clear('p', 'v'),
    ]) {
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'STORAGE_ERROR');
    }
});
