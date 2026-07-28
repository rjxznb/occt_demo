import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyContentCandidates } from '../src/components/ContentModelClassifier.js';

function candidate(sourceList, sourceIndex, typeId) {
    return {
        instanceId: `${sourceList}:${sourceIndex}`,
        sourceList,
        sourceIndex,
        typeId,
    };
}

function resolverFor(selections) {
    return {
        select(instance) {
            const selection = selections[instance.typeId];
            if (selection instanceof Error) throw selection;
            return selection;
        },
    };
}

test('classifies selections independently from source-list names', () => {
    const candidates = [
        candidate('mixed_list', 0, 'static-type'),
        candidate('mixed_list', 1, 'parametric-type'),
        candidate('pillar_list', 0, 'no-template'),
        candidate('door_list', 0, '1307'),
    ];
    const result = classifyContentCandidates(candidates, resolverFor({
        'static-type': { resId: '1', typeId: 'static-type' },
        'parametric-type': { resId: '2', typeId: 'parametric-type' },
        'no-template': { errorCode: 'TEMPLATE_TYPE_NOT_FOUND' },
        1307: { resId: 'must-not-request', typeId: '1307' },
    }));

    assert.deepEqual(result.selectedRecords.map(item => item.selection.resId), ['1', '2']);
    assert.deepEqual(result.localGeometry, [{
        instance: candidates[2],
        state: 'local-geometry',
        reasonCode: 'TEMPLATE_TYPE_NOT_FOUND',
    }]);
    assert.deepEqual(result.openingOnly, [{
        instance: candidates[3],
        state: 'opening-only',
        reasonCode: 'INTENTIONAL_OPENING',
    }]);
});

test('keeps ordinary missing resources as local geometry', () => {
    const current = candidate('window_list', 3, 'ordinary-window');
    const result = classifyContentCandidates([current], resolverFor({
        'ordinary-window': { errorCode: 'TEMPLATE_RESOURCE_MISSING' },
    }));

    assert.deepEqual(result.selectedRecords, []);
    assert.deepEqual(result.openingOnly, []);
    assert.deepEqual(result.localGeometry, [{
        instance: current,
        state: 'local-geometry',
        reasonCode: 'TEMPLATE_RESOURCE_MISSING',
    }]);
});

test('isolates resolver exceptions and reserves opening-only for exact TypeId 1307', () => {
    const failed = candidate('custom_list', 0, 'throws');
    const similar = candidate('door_list', 1, '01307');
    const result = classifyContentCandidates([failed, similar], resolverFor({
        throws: new Error('private resolver details'),
        '01307': { errorCode: 'TEMPLATE_RESOURCE_MISSING' },
    }));

    assert.deepEqual(result.openingOnly, []);
    assert.deepEqual(result.localGeometry.map(item => ({
        instanceId: item.instance.instanceId,
        state: item.state,
        reasonCode: item.reasonCode,
    })), [
        {
            instanceId: 'custom_list:0',
            state: 'local-geometry',
            reasonCode: 'TEMPLATE_TYPE_NOT_FOUND',
        },
        {
            instanceId: 'door_list:1',
            state: 'local-geometry',
            reasonCode: 'TEMPLATE_RESOURCE_MISSING',
        },
    ]);
});

