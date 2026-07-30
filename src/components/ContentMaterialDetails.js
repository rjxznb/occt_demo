function parseJson(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value.replace(/^\uFEFF/, ''));
    } catch {
        return null;
    }
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function parseParameterValue(key, value) {
    if (key === '100') {
        const color = String(value).split('-').map(finiteNumber);
        if (color.length === 3 && color.every(component => component !== null)) return color;
    }
    return finiteNumber(value);
}

function parseMaterialParameters(value) {
    const parsed = parseJson(value);
    const row = Array.isArray(parsed?.D?.[0]) ? parsed.D[0] : [];
    const masterMaterial = String(row[0] ?? '')
        .replace(/^SN:/i, '')
        .replace(/^\d+_/, '')
        .trim();
    const parameters = {};
    for (const encoded of row.slice(1)) {
        const separator = String(encoded).indexOf('*');
        if (separator <= 0) continue;
        const key = String(encoded).slice(0, separator).trim();
        const parsedValue = parseParameterValue(key, String(encoded).slice(separator + 1).trim());
        if (parsedValue !== null) parameters[key] = parsedValue;
    }
    return { masterMaterial, parameters };
}

function unresolvedDescriptor(detail) {
    return {
        code: String(detail?.code ?? detail?.resCode ?? '').trim(),
        name: String(detail?.name ?? '').trim(),
        modelType: '',
        masterMaterial: '',
        isGlass: false,
        color: null,
        parameters: {},
        source: null,
    };
}

export function parseContentMaterialDetail(detail) {
    const fallback = unresolvedDescriptor(detail);
    const optimize = parseJson(detail?.optimizeParam);
    if (!optimize) return fallback;
    const { masterMaterial, parameters } = parseMaterialParameters(optimize.materialParameter);
    const code = fallback.code || String(optimize.resCode ?? '').trim();
    const name = fallback.name || String(optimize.name ?? '').trim();
    const modelType = String(optimize.modelType ?? detail?.modelType ?? '').trim();
    const glassLabel = `${name} ${optimize.name ?? ''}`;
    return {
        code,
        name,
        modelType,
        masterMaterial,
        isGlass: modelType === '4'
            || /glass/i.test(masterMaterial)
            || glassLabel.includes('\u73bb\u7483'),
        color: Array.isArray(parameters['100']) ? parameters['100'] : null,
        parameters,
        source: optimize,
    };
}

export async function resolveContentMaterialDetails(details, { fetchJson } = {}) {
    const descriptors = new Map();
    for (const detail of Array.isArray(details) ? details : []) {
        let descriptor = parseContentMaterialDetail(detail);
        const optimizeFileUrl = String(detail?.optimizeFileUrl ?? '').trim();
        if (!descriptor.source && optimizeFileUrl && typeof fetchJson === 'function') {
            try {
                const optimize = await fetchJson(optimizeFileUrl);
                descriptor = parseContentMaterialDetail({
                    ...detail,
                    optimizeParam: JSON.stringify(optimize),
                });
            } catch {
                // The unresolved descriptor is a valid non-fatal fallback.
            }
        }
        if (/^PT\d+$/.test(descriptor.code)) descriptors.set(descriptor.code, descriptor);
    }
    return descriptors;
}
