const CATEGORY_BY_KEY = new Map([
    ['0:false', 'tiling'],
    ['1:false', 'paint'],
    ['2:false', 'grout'],
    ['3:false', 'glass'],
    ['4:false', 'window-frame-loft'],
    ['5:false', 'material-library'],
    ['0:true', 'static-model'],
    ['6:true', 'parametric-model'],
]);

function booleanValue(value) {
    return value === true
        || value === 1
        || value === '1'
        || String(value).toLowerCase() === 'true';
}

function convertedMaterialEntries(convertedMaterials) {
    if (Array.isArray(convertedMaterials)) {
        return convertedMaterials
            .filter(value => value && typeof value === 'object')
            .map(value => [String(value.MatName ?? ''), value]);
    }
    if (!convertedMaterials || typeof convertedMaterials !== 'object') return [];
    return Object.entries(convertedMaterials).filter(([, value]) =>
        value && typeof value === 'object');
}

export function classifyContentMaterial({ bimRenderMat, isModel } = {}) {
    return CATEGORY_BY_KEY.get(`${Number(bimRenderMat)}:${Boolean(isModel)}`) ?? 'unknown';
}

export function normalizeContentMaterialEntries(convertedMaterials) {
    return convertedMaterialEntries(convertedMaterials).map(([fallbackName, source]) => {
        const isModel = booleanValue(source.IsModel);
        const bimRenderMat = Number(source.BimRenderMat);
        const normalized = {
            materialName: String(source.MatName ?? fallbackName ?? '').trim(),
            code: String(source.ID ?? '').trim(),
            isModel,
            bimRenderMat: Number.isFinite(bimRenderMat) ? bimRenderMat : null,
            source,
        };
        return {
            ...normalized,
            category: classifyContentMaterial(normalized),
        };
    });
}

export function parseMtlColor(matName) {
    const match = String(matName ?? '').match(/MTLCOLOR([0-9a-f]{6}|[0-9a-f]{8})(?:_|$)/i);
    if (!match) return null;
    const hex = match[1];
    return {
        color: Number.parseInt(hex.slice(-6), 16),
        opacity: hex.length === 8
            ? Number.parseInt(hex.slice(0, 2), 16) / 255
            : null,
    };
}

export function contentMaterialCodes(convertedMaterials) {
    return [...new Set(convertedMaterialEntries(convertedMaterials)
        .map(([, value]) => String(value.ID ?? '').trim())
        .filter(code => /^PT\d+$/.test(code)))];
}

function isGlassDetail(detail) {
    const semanticText = `${detail?.name ?? ''} ${detail?.optimizeParam ?? ''}`;
    return /glass|玻璃/i.test(semanticText);
}

export function applyContentMaterialSemantics(root, convertedMaterials, details = []) {
    if (!root?.isObject3D) return root;
    const detailByCode = new Map((details || [])
        .filter(detail => detail && detail.code != null)
        .map(detail => [String(detail.code), detail]));
    const semanticsByObjMaterial = new Map(convertedMaterialEntries(convertedMaterials)
        .map(([objMaterial, value]) => {
            const code = String(value.ID ?? '').trim();
            const detail = detailByCode.get(code);
            return [objMaterial, { code, isGlass: isGlassDetail(detail) }];
        }));

    root.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            const semantics = semanticsByObjMaterial.get(material?.name);
            if (!semantics) return;
            material.userData = {
                ...material.userData,
                contentMaterialCode: semantics.code,
                contentMaterialIsGlass: semantics.isGlass,
            };
        });
    });
    return root;
}
