function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
}

function fingerprint(value) {
    const text = stableSerialize(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function queryValue(params, name) {
    const value = params.get(name)?.trim();
    return value || null;
}

export function resolvePanoramaDocumentContext({
    search = '',
    dataSourceId = '',
    dataSourceName = '',
    roomPoints = [],
    cameraList = [],
} = {}) {
    const params = new URLSearchParams(String(search).replace(/^\?/, ''));
    const queryPlanId = queryValue(params, 'planId');
    const queryVersion = queryValue(params, 'version');
    const fallbackPlanId = String(dataSourceId || dataSourceName || 'local-drawing').trim();

    return {
        planId: queryPlanId ?? fallbackPlanId,
        version: queryVersion ?? `drawing-${fingerprint({ roomPoints, cameraList })}`,
        planIdSource: queryPlanId ? 'query' : 'data-source',
        versionSource: queryVersion ? 'query' : 'fingerprint',
    };
}
