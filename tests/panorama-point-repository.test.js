import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LocalPanoramaPointRepository,
    PANORAMA_DRAFT_SCHEMA_VERSION,
} from '../src/panorama/PanoramaPointRepository.js';

class MemoryStorage {
    constructor(entries = []) {
        this.values = new Map(entries);
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

function createRepository(storage = new MemoryStorage()) {
    return {
        storage,
        repository: new LocalPanoramaPointRepository({
            storage,
            clock: () => '2026-08-11T12:00:00.000Z',
            logger: { warn() {} },
        }),
    };
}

test('saves, loads, and clears a versioned panorama draft', async () => {
    const { repository, storage } = createRepository();
    const draft = {
        initialPointId: 'camera:a',
        lastActivePointId: 'camera:b',
        overrides: { 'camera:a': { name: '主卧入口' } },
    };

    assert.deepEqual(await repository.save('scheme/42', 'revision 7', draft), { ok: true });
    assert.deepEqual(await repository.load('scheme/42', 'revision 7'), {
        ok: true,
        draft,
    });
    assert.deepEqual([...storage.values.keys()], [
        `occt.panorama.points.v${PANORAMA_DRAFT_SCHEMA_VERSION}:scheme%2F42:revision%207`,
    ]);

    assert.deepEqual(await repository.clear('scheme/42', 'revision 7'), { ok: true });
    assert.deepEqual(await repository.load('scheme/42', 'revision 7'), {
        ok: true,
        draft: null,
    });
});

test('isolates drafts by both plan id and plan version', async () => {
    const { repository } = createRepository();

    await repository.save('scheme-a', 'v1', { marker: 'a-v1' });
    await repository.save('scheme-a', 'v2', { marker: 'a-v2' });
    await repository.save('scheme-b', 'v1', { marker: 'b-v1' });

    assert.equal((await repository.load('scheme-a', 'v1')).draft.marker, 'a-v1');
    assert.equal((await repository.load('scheme-a', 'v2')).draft.marker, 'a-v2');
    assert.equal((await repository.load('scheme-b', 'v1')).draft.marker, 'b-v1');
});

test('backs up malformed and incompatible drafts before returning an empty draft', async () => {
    const { repository, storage } = createRepository();
    const malformedKey = repository.keyFor('broken', 'json');
    storage.setItem(malformedKey, '{not-json');

    const malformed = await repository.load('broken', 'json');

    assert.equal(malformed.ok, false);
    assert.equal(malformed.draft, null);
    assert.equal(malformed.error.code, 'CORRUPTED_DRAFT');
    assert.equal(storage.getItem(malformedKey), null);
    assert.equal(storage.getItem(`${malformedKey}:corrupted:2026-08-11T12%3A00%3A00.000Z`), '{not-json');

    const incompatibleKey = repository.keyFor('old', 'schema');
    storage.setItem(incompatibleKey, JSON.stringify({ schemaVersion: 0, draft: { stale: true } }));

    const incompatible = await repository.load('old', 'schema');

    assert.equal(incompatible.ok, false);
    assert.equal(incompatible.error.code, 'INCOMPATIBLE_SCHEMA');
    assert.equal(storage.getItem(incompatibleKey), null);
    assert.ok([...storage.values.keys()].some(key => key.startsWith(`${incompatibleKey}:corrupted:`)));
});

test('contains storage failures in a structured result', async () => {
    const storage = {
        getItem() { throw new Error('storage blocked'); },
        setItem() { throw new Error('storage blocked'); },
        removeItem() { throw new Error('storage blocked'); },
    };
    const { repository } = createRepository(storage);

    const loaded = await repository.load('scheme', 'v1');
    const saved = await repository.save('scheme', 'v1', { point: 1 });
    const cleared = await repository.clear('scheme', 'v1');

    for (const result of [loaded, saved, cleared]) {
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'STORAGE_ERROR');
        assert.equal(result.error.message, 'storage blocked');
    }
    assert.equal(loaded.draft, null);
});
