export function resolveModelResource(resId, detail) {
    const normalizedResId = String(resId ?? '').trim();
    const model = detail?.modelDTO ?? detail?.data?.modelDTO ?? detail ?? {};
    const candidates = Array.isArray(model?.resourceList) ? model.resourceList : [];
    const sourceCandidates = candidates.length > 0 ? candidates : legacyFlatCandidates(model);
    const resources = sourceCandidates.map(candidate => ({
        type: candidate?.type,
        data: candidate?.data ?? candidate ?? {},
    }));
    const rawSummary = {
        candidateCount: resources.length,
        hasStaticWebPackage: resources.some(resource => resource.type === 1
            && hasWebPackage(resource.data)),
        hasStaticWebV2: resources.some(resource => resource.type === 1
            && hasValue(resource.data.webV2Url)),
        hasParameterizedJson: resources.some(resource => resource.type === 8
            && hasValue(parameterizedUrl(resource.data))),
    };

    for (const resource of resources) {
        if (resource.type === 1 && hasWebPackage(resource.data)) {
            const fallbackResource = staticFallback(
                normalizedResId,
                resource.data,
                model.modelType,
            );
            return {
                resId: normalizedResId,
                kind: 'static-web-package',
                contentHash: resource.data.webMd5.trim().toLowerCase(),
                ...(fallbackResource ? { fallbackResource } : {}),
                modelType: model.modelType,
                resourceType: 1,
                rawSummary,
            };
        }
        if (resource.type === 1 && isHttpUrl(resource.data.webV2Url)) {
            return resolvedResource(normalizedResId, 'static-glb', resource.data.webV2Url,
                resource.data.webV2Md5, model.modelType, 1, rawSummary);
        }
        if (resource.type === 8 && isHttpUrl(parameterizedUrl(resource.data))) {
            return resolvedResource(normalizedResId, 'parametric-obj', parameterizedUrl(resource.data),
                parameterizedHash(resource.data), model.modelType, 8, rawSummary);
        }
    }

    const hasSupportedResource = resources.some(resource => resource.type === 1 || resource.type === 8);
    return {
        errorCode: hasSupportedResource ? 'RESOURCE_URL_MISSING' : 'UNSUPPORTED_RESOURCE_TYPE',
        resId: normalizedResId,
    };
}

function legacyFlatCandidates(model) {
    const resources = [];
    if (hasValue(parameterizedUrl(model)) || hasValue(parameterizedHash(model))) {
        resources.push({ type: 8, data: model });
    }
    if (hasValue(model?.webUrl) || hasValue(model?.webMd5)
        || hasValue(model?.webV2Url) || hasValue(model?.webV2Md5)) {
        resources.push({ type: 1, data: model });
    }
    return resources;
}

function parameterizedUrl(data) {
    return isHttpUrl(data?.parameterizedWebJsonUrl)
        ? data.parameterizedWebJsonUrl
        : data?.parameterizedJsonUrl;
}

function parameterizedHash(data) {
    return isHttpUrl(data?.parameterizedWebJsonUrl)
        ? data?.parameterizedWebJsonMd5
        : data?.parameterizedJsonMd5;
}

function resolvedResource(resId, kind, sourceUrl, contentHash, modelType, resourceType, rawSummary) {
    return { resId, kind, sourceUrl, contentHash, modelType, resourceType, rawSummary };
}

function staticFallback(resId, data, modelType) {
    if (!isHttpUrl(data?.webV2Url)) return null;
    return {
        resId,
        kind: 'static-glb',
        sourceUrl: data.webV2Url,
        contentHash: data.webV2Md5,
        modelType,
        resourceType: 1,
    };
}

function hasWebPackage(data) {
    return isHttpUrl(data?.webUrl)
        && /^[a-f\d]{32}$/i.test(String(data?.webMd5 ?? '').trim());
}

function hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value) {
    if (!hasValue(value)) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
