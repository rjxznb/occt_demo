import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelResource } from '../src/services/ContentResourceResolver.js';

test('type 1 chooses nested webV2Url as a static GLB', () => {
    const resource = resolveModelResource('1961100', {
        id: 1961100, modelType: 1,
        resourceList: [{ type: 1, data: {
            webV2Url: 'https://file.test/model.kb?signature=secret',
            webV2Md5: 'static-md5', url427: 'https://file.test/model.pak',
        } }],
    });
    assert.deepEqual(resource, {
        resId: '1961100', kind: 'static-glb',
        sourceUrl: 'https://file.test/model.kb?signature=secret',
        contentHash: 'static-md5', modelType: 1, resourceType: 1,
        rawSummary: {
            candidateCount: 1,
            hasStaticWebV2: true,
            hasParameterizedJson: false,
        },
    });
});

test('type 8 chooses parameterizedJsonUrl and never treats it as static', () => {
    const resource = resolveModelResource('2406734', {
        id: 2406734, modelType: 0,
        resourceList: [{ type: 8, data: {
            parameterizedJsonUrl: 'https://file.test/model.json?signature=secret',
            parameterizedJsonMd5: 'parameter-md5',
        } }],
    });
    assert.equal(resource.kind, 'parametric-obj');
    assert.equal(resource.resourceType, 8);
    assert.equal(resource.contentHash, 'parameter-md5');
});

test('unknown and incomplete resources return stable error codes', () => {
    assert.equal(resolveModelResource('1', { resourceList: [{ type: 1, data: {} }] }).errorCode,
        'RESOURCE_URL_MISSING');
    assert.equal(resolveModelResource('2', { resourceList: [{ type: 99, data: {} }] }).errorCode,
        'UNSUPPORTED_RESOURCE_TYPE');
});

test('resolver ignores signed URLs that are not HTTP(S) resources', () => {
    const resource = resolveModelResource('3', {
        resourceList: [{ type: 8, data: { parameterizedJsonUrl: 'file:///secret.json?signature=secret' } }],
    });
    assert.equal(resource.errorCode, 'RESOURCE_URL_MISSING');
    assert.deepEqual(resource, { errorCode: 'RESOURCE_URL_MISSING', resId: '3' });
});
