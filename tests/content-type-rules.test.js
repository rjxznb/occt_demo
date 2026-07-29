import test from 'node:test';
import assert from 'node:assert/strict';
import {
    contentTypeRuleFor,
    templateTypeIdAliasFor,
} from '../src/components/ContentTypeRules.js';

test('audits every remaining source-visible UE TypeId family', () => {
    assert.deepEqual([
        '1402', '140a',
        '1403', '140302', '140303', '1404', '1405', '1406',
        '140e', '140e01', '140e02', '140f',
        '1305', '1311',
    ].map(typeId => contentTypeRuleFor(typeId)?.family), [
        'standard-window', 'standard-window',
        'bay-window', 'bay-window', 'bay-window', 'bay-window',
        'arc-bay-window', 'corner-bay-window',
        'railing-composite', 'straight-railing', 'arc-railing',
        'door-window', 'barn-door', 'pocket-door',
    ]);
});

test('exposes only the documented straight-railing template alias', () => {
    assert.equal(templateTypeIdAliasFor('140e01'), '140e');
    assert.equal(templateTypeIdAliasFor('140e02'), '140e02');
    assert.equal(templateTypeIdAliasFor(' ordinary-soft '), 'ordinary-soft');
    assert.equal(contentTypeRuleFor('ordinary-soft'), null);
});

test('returns immutable normalized rule facts', () => {
    const rule = contentTypeRuleFor(' 140302 ');
    assert.deepEqual(rule, {
        typeId: '140302',
        family: 'bay-window',
    });
    assert.equal(Object.isFrozen(rule), true);
});
