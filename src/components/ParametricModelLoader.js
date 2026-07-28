import * as THREE from 'three';

import { ContentTemplateResolver } from './ContentTemplateResolver.js';
import { loadContentModels } from './ContentModelLoader.js';
import { createContentDebugInfo } from './ContentModelPlacement.js';

export {
    createPlanTransform,
    createYUpToZUpTransform,
    computeModelPlacementOffset,
} from './ContentModelPlacement.js';

const compatibilityTemplateResolver = new ContentTemplateResolver(
    (...args) => globalThis.fetch(...args),
);
let compatibilityTemplateMap = null;
let compatibilityTemplatePromise = null;

/** Create the legacy plain-data debug snapshot without retaining Three.js objects. */
export function createParametricDebugInfo(item, templateInfo, placement) {
    const baseScale = Number.isFinite(placement?.baseScale) ? placement.baseScale : 1;
    const info = createContentDebugInfo({
        ...item,
        instanceId: item?.id ?? null,
        basePoint: item?.basepoint,
        rotationDegrees: item?.rotate,
    }, {
        typeName: templateInfo?.typeName,
        resId: templateInfo?.resId,
        referenceSize: templateInfo?.defaultSize,
    }, {
        kind: 'parametric-obj',
    }, {
        ...placement,
        targetScale: new THREE.Vector3(baseScale, baseScale, baseScale),
        effectiveHorizontalFlip: item?.horizontalFlip === true,
    });
    return {
        typeId: info.typeId,
        softlistId: item?.id ?? null,
        typeName: info.selection.typeName,
        resId: info.selection.resId,
        defaultSize: info.selection.referenceSize,
        source: {
            basepoint: info.source.basePoint,
            footprint: info.source.footprint,
            modelParams: info.source.modelParams,
        },
        transform: {
            rotate: info.transform.rotationDegrees,
            horizontalFlip: info.transform.horizontalFlip,
            verticalFlip: info.transform.verticalFlip,
        },
        placement: {
            rawSize: info.placement.rawSize,
            baseScale,
            modelOffset: info.placement.modelOffset,
            worldPosition: info.placement.worldPosition,
            worldBounds: info.placement.worldBounds,
        },
    };
}

export function loadTemplate(templatePath = 'data/template.json') {
    if (compatibilityTemplatePromise) return compatibilityTemplatePromise;
    compatibilityTemplatePromise = compatibilityTemplateResolver.load(templatePath).then(catalog => {
        compatibilityTemplateMap = new Map();
        for (const [typeId, entry] of catalog) {
            const resource = entry.ResList.find(item => item?.ResId != null);
            if (!resource) continue;
            compatibilityTemplateMap.set(typeId, {
                resId: String(resource.ResId),
                defaultSize: {
                    x: Number(resource.X) || 0,
                    y: Number(resource.Y) || 0,
                    z: Number(resource.Z) || 0,
                },
                typeName: entry.TypeName ?? '',
            });
        }
        return compatibilityTemplateMap;
    });
    return compatibilityTemplatePromise;
}

export function getResId(typeId) {
    return compatibilityTemplateMap?.get(String(typeId))?.resId ?? null;
}

export function getDefaultSize(typeId) {
    return compatibilityTemplateMap?.get(String(typeId))?.defaultSize ?? null;
}

function normalizeLegacySoftlist(item, sourceIndex) {
    const sourceList = item?.sourceList ?? 'soft_list';
    const normalizedIndex = item?.sourceIndex ?? sourceIndex;
    return {
        instanceId: item?.instanceId ?? item?.id ?? `${sourceList}:${normalizedIndex}`,
        sourceList,
        sourceIndex: normalizedIndex,
        category: item?.category ?? 'soft',
        typeId: String(item?.typeId ?? ''),
        basePoint: item?.basePoint ?? item?.basepoint,
        footprint: item?.footprint,
        size: item?.size,
        rotationDegrees: item?.rotationDegrees ?? item?.rotate ?? 0,
        horizontalFlip: item?.horizontalFlip === true,
        verticalFlip: item?.verticalFlip === true,
        outScale: item?.outScale,
        groundHeight: item?.groundHeight,
        modelParams: Array.isArray(item?.modelParams) ? item.modelParams : [],
        rawBlockInnerInfo: item?.rawBlockInnerInfo,
    };
}

function markLegacyParametricModel(instance, root) {
    const softlistId = instance.instanceId;
    root.userData = {
        ...root.userData,
        type: 'parametric-softlist',
        softlistId,
        debugInfo: {
            ...root.userData?.debugInfo,
            softlistId,
        },
    };
    root.traverse(child => {
        if (!child.isMesh) return;
        child.userData = {
            ...child.userData,
            type: 'parametric-softlist',
            softlistId,
        };
    });
}

/** Delegate legacy soft-list records to the unified content-model loader. */
export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const instances = (Array.isArray(softlists) ? softlists : [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.kind === 'softlist')
        .map(({ item, index }) => normalizeLegacySoftlist(item, index));
    const previousOnInstancePlaced = options.onInstancePlaced;
    const result = await loadContentModels(instances, sceneGroup, {
        ...options,
        onInstancePlaced(instance, root) {
            markLegacyParametricModel(instance, root);
            return previousOnInstancePlaced?.(instance, root);
        },
    });
    return result.groups;
}
