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
            hasStaticWebPackage: false,
            hasStaticWebV2: true,
            hasParameterizedJson: false,
        },
    });
});

test('type 8 prefers the Web parameterized JSON and falls back to the legacy JSON', () => {
    const resource = resolveModelResource('2406734', {
        id: 2406734, modelType: 0,
        resourceList: [{ type: 8, data: {
            parameterizedWebJsonUrl: 'https://file.test/model-web.json?signature=secret',
            parameterizedWebJsonMd5: 'parameter-web-md5',
            parameterizedJsonUrl: 'https://file.test/model-desktop.json?signature=secret',
            parameterizedJsonMd5: 'parameter-desktop-md5',
        } }],
    });
    assert.equal(resource.kind, 'parametric-obj');
    assert.equal(resource.resourceType, 8);
    assert.equal(resource.sourceUrl, 'https://file.test/model-web.json?signature=secret');
    assert.equal(resource.contentHash, 'parameter-web-md5');

    const fallback = resolveModelResource('2406735', {
        resourceList: [{ type: 8, data: {
            parameterizedJsonUrl: 'https://file.test/model-desktop.json',
            parameterizedJsonMd5: 'parameter-desktop-md5',
        } }],
    });
    assert.equal(fallback.sourceUrl, 'https://file.test/model-desktop.json');
    assert.equal(fallback.contentHash, 'parameter-desktop-md5');
});

test('standalone Node flat modelDTO fields resolve to the same resource kinds', () => {
    const staticResource = resolveModelResource('1961100', {
        resGoodsId: 1961100,
        modelType: 1,
        webV2Url: 'https://file.test/static.kb',
        webV2Md5: 'static-flat-md5',
    });
    const parametricResource = resolveModelResource('2406734', {
        resGoodsId: 2406734,
        modelType: 0,
        parameterizedJsonUrl: 'https://file.test/parametric.json',
        parameterizedJsonMd5: 'parametric-flat-md5',
    });

    assert.equal(staticResource.kind, 'static-glb');
    assert.equal(staticResource.resourceType, 1);
    assert.equal(staticResource.contentHash, 'static-flat-md5');
    assert.equal(parametricResource.kind, 'parametric-obj');
    assert.equal(parametricResource.resourceType, 8);
    assert.equal(parametricResource.contentHash, 'parametric-flat-md5');
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

test('CAD transport prefers WebV2 GLB over an encrypted Web package', () => {
    const resource = resolveModelResource('1961113', {
        modelType: 1,
        resourceList: [{ type: 1, data: {
            webUrl: 'https://file.ljcdn.com/model.pak?signature=secret',
            webMd5: '0123456789abcdef0123456789abcdef',
            webV2Url: 'https://file.test/model.kb?signature=secret',
            webV2Md5: 'web-v2-md5',
        } }],
    }, { preferWebV2: true });
    assert.deepEqual(resource, {
        resId: '1961113',
        kind: 'static-glb',
        sourceUrl: 'https://file.test/model.kb?signature=secret',
        contentHash: 'web-v2-md5',
        modelType: 1,
        resourceType: 1,
        rawSummary: {
            candidateCount: 1,
            hasStaticWebPackage: true,
            hasStaticWebV2: true,
            hasParameterizedJson: false,
        },
    });
});

test('supports Web-package-only static resources and rejects an invalid package MD5', () => {
    const packageOnly = resolveModelResource('1961114', {
        resourceList: [{ type: 1, data: {
            webUrl: 'https://file.ljcdn.com/model.pak',
            webMd5: 'ABCDEF0123456789ABCDEF0123456789',
        } }],
    });
    assert.equal(packageOnly.kind, 'static-web-package');
    assert.equal(packageOnly.contentHash, 'abcdef0123456789abcdef0123456789');
    assert.equal(packageOnly.fallbackResource, undefined);

    const invalidMd5 = resolveModelResource('1961115', {
        resourceList: [{ type: 1, data: {
            webUrl: 'https://file.ljcdn.com/model.pak',
            webMd5: 'not-an-md5',
        } }],
    });
    assert.equal(invalidMd5.errorCode, 'RESOURCE_URL_MISSING');
});

test('type 8 remains parameterized when its unused Web fields are present', () => {
    const resource = resolveModelResource('2406313', {
        resourceList: [{ type: 8, data: {
            webUrl: '',
            webMd5: '',
            parameterizedJsonUrl: 'https://file.test/window.json',
            parameterizedJsonMd5: 'window-md5',
        } }],
    });
    assert.equal(resource.kind, 'parametric-obj');
    assert.equal(resource.sourceUrl, 'https://file.test/window.json');
});
