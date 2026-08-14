import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AI_GENERATION_CONDITION_SCHEMA_VERSION,
    LocalAiGenerationConditionRepository,
} from '../src/ai-concept/AiGenerationConditionRepository.js';

class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createRepository() {
    const storage = new MemoryStorage();
    return {
        storage,
        repository: new LocalAiGenerationConditionRepository({
            storage,
            clock: () => '2026-08-14T08:00:00.000Z',
        }),
    };
}

test('condition drafts save normalized selections and isolate plan versions', async () => {
    const { repository, storage } = createRepository();
    const v1 = { planId: 'scheme/42', planVersion: '1' };
    const v2 = { planId: 'scheme/42', planVersion: '2' };
    await repository.save(v1, {
        styleIds: ['fresh-cream', 'missing', 'fresh-cream'],
        environmentIds: ['sunny-day'],
    });
    await repository.save(v2, {
        styleIds: ['italian-elegant'],
        environmentIds: ['night-ambience'],
    });

    assert.deepEqual((await repository.load(v1)).conditions, {
        styleIds: ['fresh-cream'], environmentIds: ['sunny-day'],
    });
    assert.deepEqual((await repository.load(v2)).conditions, {
        styleIds: ['italian-elegant'], environmentIds: ['night-ambience'],
    });
    assert.deepEqual([...storage.values.keys()], [
        `occt.ai-concept-generation.conditions.v${AI_GENERATION_CONDITION_SCHEMA_VERSION}:scheme%2F42:1`,
        `occt.ai-concept-generation.conditions.v${AI_GENERATION_CONDITION_SCHEMA_VERSION}:scheme%2F42:2`,
    ]);
});

test('condition drafts return approved defaults when absent or incompatible', async () => {
    const { repository, storage } = createRepository();
    const context = { planId: 'p', planVersion: 'v' };
    assert.deepEqual(await repository.load(context), {
        ok: true,
        conditions: { styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'] },
    });

    storage.setItem(repository.keyFor(context), JSON.stringify({ schemaVersion: 0, conditions: {} }));
    const incompatible = await repository.load(context);
    assert.equal(incompatible.ok, false);
    assert.equal(incompatible.error.code, 'INCOMPATIBLE_SCHEMA');
    assert.deepEqual(incompatible.conditions, {
        styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'],
    });
});

test('condition draft storage failures remain structured and never throw', async () => {
    const blocked = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
    };
    const repository = new LocalAiGenerationConditionRepository({ storage: blocked });
    const context = { planId: 'p', planVersion: 'v' };
    assert.equal((await repository.load(context)).error.code, 'STORAGE_ERROR');
    assert.equal((await repository.save(context, {})).error.code, 'STORAGE_ERROR');
});
