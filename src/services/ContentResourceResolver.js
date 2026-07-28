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
        hasStaticWebV2: resources.some(resource => resource.type === 1
            && hasValue(resource.data.webV2Url)),
        hasParameterizedJson: resources.some(resource => resource.type === 8
            && hasValue(parameterizedUrl(resource.data))),
    };

    for (const resource of resources) {
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
    if (hasValue(model?.webV2Url) || hasValue(model?.webV2Md5)) {
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
