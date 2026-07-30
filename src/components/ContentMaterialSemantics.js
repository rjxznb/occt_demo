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
    return [...new Set(normalizeContentMaterialEntries(convertedMaterials)
        .filter(entry => entry.category === 'material-library' && /^PT\d+$/.test(entry.code))
        .map(entry => entry.code))];
}

function descriptorMetadata(descriptor) {
    if (!descriptor) return null;
    return {
        code: descriptor.code,
        name: descriptor.name,
        modelType: descriptor.modelType,
        masterMaterial: descriptor.masterMaterial,
        isGlass: descriptor.isGlass,
        color: descriptor.color,
        parameters: descriptor.parameters,
    };
}

function attachSemantics(material, entry, descriptor = null) {
    material.userData = {
        ...material.userData,
        contentMaterialCategory: entry.category,
        contentMaterialCode: entry.code,
        contentMaterialIsModel: entry.isModel,
        contentBimRenderMat: entry.bimRenderMat,
        contentMaterialIsGlass: descriptor
            ? descriptor.isGlass === true
            : entry.category === 'glass',
        contentMaterialSource: entry.source,
        ...(descriptor ? { contentMaterialDescriptor: descriptorMetadata(descriptor) } : {}),
    };
}

function applyLocalMaterialProperties(material, entry) {
    if (entry.category !== 'paint' && entry.category !== 'grout') return;
    const parsedColor = parseMtlColor(entry.materialName);
    if (parsedColor && material.color?.isColor) {
        material.color.setHex(parsedColor.color);
    }
    if (entry.category === 'grout') {
        material.metalness = 0;
        material.roughness = Math.max(Number(material.roughness) || 0, 0.8);
    }
    material.needsUpdate = true;
}

function applyResolvedMaterialProperties(material, descriptor) {
    if (Array.isArray(descriptor?.color) && descriptor.color.length === 3
        && material.color?.isColor) {
        material.color.setRGB(...descriptor.color);
    }
    material.needsUpdate = true;
}

export function applyContentMaterialSemantics(root, convertedMaterials, detailByCode = new Map()) {
    if (!root?.isObject3D) return root;
    const entries = normalizeContentMaterialEntries(convertedMaterials);
    const modelEntries = entries.filter(entry => entry.isModel);
    if (modelEntries.length > 0) {
        root.userData = {
            ...root.userData,
            contentModelMaterials: modelEntries,
        };
    }
    const semanticsByObjMaterial = new Map(entries
        .filter(entry => !entry.isModel && entry.materialName)
        .map(entry => [entry.materialName, entry]));

    root.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const resolvedMaterials = materials.map(material => {
            const entry = semanticsByObjMaterial.get(material?.name);
            if (!entry) return material;
            const descriptor = entry.category === 'material-library'
                ? detailByCode.get(entry.code) : null;
            const target = descriptor && material?.isMaterial ? material.clone() : material;
            attachSemantics(target, entry, descriptor);
            applyLocalMaterialProperties(target, entry);
            if (descriptor) applyResolvedMaterialProperties(target, descriptor);
            return target;
        });
        child.material = Array.isArray(child.material) ? resolvedMaterials : resolvedMaterials[0];
    });
    return root;
}
