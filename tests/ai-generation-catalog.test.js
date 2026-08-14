import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_GENERATION_CONDITIONS,
    ENVIRONMENT_CATALOG,
    MAX_IMAGES_PER_JOB,
    STYLE_CATALOG,
    countGenerationCombinations,
    normalizeGenerationConditions,
    validateGenerationConditions,
} from '../src/ai-concept/AiGenerationCatalog.js';

test('catalog provides the approved unique styles and environments with usable defaults', () => {
    assert.equal(STYLE_CATALOG.length, 12);
    assert.equal(new Set(STYLE_CATALOG.map(style => style.id)).size, 12);
    assert.equal(ENVIRONMENT_CATALOG.length, 4);
    assert.equal(new Set(ENVIRONMENT_CATALOG.map(environment => environment.id)).size, 4);
    assert.deepEqual(DEFAULT_GENERATION_CONDITIONS, {
        styleIds: ['modern-minimalist'],
        environmentIds: ['sunny-day'],
    });
    assert.equal(MAX_IMAGES_PER_JOB, 24);
    assert.ok(STYLE_CATALOG.every(style => style.name && style.description && style.imageUrl && style.prompt));
    assert.ok(ENVIRONMENT_CATALOG.every(environment => environment.name && environment.prompt));
});

test('condition normalization removes duplicates and catalog misses without changing order', () => {
    assert.deepEqual(normalizeGenerationConditions({
        styleIds: ['fresh-cream', 'missing', 'modern-minimalist', 'fresh-cream'],
        environmentIds: ['night-ambience', 'missing', 'sunny-day', 'night-ambience'],
    }), {
        styleIds: ['fresh-cream', 'modern-minimalist'],
        environmentIds: ['night-ambience', 'sunny-day'],
    });
});

test('combination validation rejects every invalid matrix boundary', () => {
    const valid = { styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'] };
    assert.equal(countGenerationCombinations({ viewCount: 12, ...valid }), 12);
    assert.deepEqual(validateGenerationConditions({ viewCount: 0, ...valid, maxImages: 24 }), {
        valid: false, count: 0, code: 'NO_VIEWS',
    });
    assert.deepEqual(validateGenerationConditions({
        viewCount: 1, styleIds: [], environmentIds: ['sunny-day'], maxImages: 24,
    }), { valid: false, count: 0, code: 'NO_STYLES' });
    assert.deepEqual(validateGenerationConditions({
        viewCount: 1, styleIds: ['modern-minimalist'], environmentIds: [], maxImages: 24,
    }), { valid: false, count: 0, code: 'NO_ENVIRONMENTS' });
    assert.deepEqual(validateGenerationConditions({
        viewCount: 12,
        styleIds: ['modern-minimalist', 'fresh-cream', 'italian-elegant'],
        environmentIds: ['sunny-day'],
        maxImages: 24,
    }), { valid: false, count: 36, code: 'TOO_MANY_IMAGES' });
    assert.deepEqual(validateGenerationConditions({ viewCount: 12, ...valid, maxImages: 24 }), {
        valid: true, count: 12, code: 'OK',
    });
});
