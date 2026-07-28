import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { parametricApiClient } from '../services/ParametricApiClient.js';
import { ContentTemplateResolver } from './ContentTemplateResolver.js';
import { createContentDebugInfo, placeContentModel } from './ContentModelPlacement.js';

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
const clientCaches = new WeakMap();

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
        legacySoftlistId: item?.id ?? item?.instanceId ?? `${sourceList}:${normalizedIndex}`,
    };
}

function markLegacyParametricModel(instance, root) {
    const softlistId = instance.legacySoftlistId;
    const debugInfo = root.userData?.debugInfo ?? {};
    const selection = debugInfo.selection ?? {};
    const source = debugInfo.source ?? {};
    const transform = debugInfo.transform ?? {};
    const placement = debugInfo.placement ?? {};
    const targetScaleX = Number(placement.targetScale?.x);
    root.userData = {
        ...root.userData,
        type: 'parametric-softlist',
        softlistId,
        debugInfo: {
            ...debugInfo,
            softlistId,
            typeName: selection.typeName ?? null,
            resId: selection.resId ?? null,
            defaultSize: selection.referenceSize ?? null,
            source: {
                ...source,
                basepoint: source.basePoint ?? null,
            },
            transform: {
                ...transform,
                rotate: transform.rotationDegrees ?? 0,
            },
            placement: {
                ...placement,
                baseScale: Number.isFinite(targetScaleX) ? targetScaleX : 1,
            },
        },
    };
    root.traverse(child => {
        if (!child.isMesh) return;
        child.userData = {
            ...child.userData,
            type: child.userData?.type || 'parametric-softlist',
            softlistId,
        };
    });
}

function findStringField(value, fieldName, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (typeof value[fieldName] === 'string' && value[fieldName]) return value[fieldName];
    for (const child of Object.values(value)) {
        const found = findStringField(child, fieldName, depth + 1);
        if (found) return found;
    }
    return null;
}

function extractObjContent(value, depth = 0) {
    if (!value || depth > 6) return null;
    if (typeof value === 'string') return null;
    if (typeof value !== 'object') return null;
    if (typeof value.obj === 'string' && value.obj) return value.obj;
    if (value.files && typeof value.files === 'object') {
        for (const [name, content] of Object.entries(value.files)) {
            if (name.toLowerCase().endsWith('.obj') && typeof content === 'string' && content) {
                return content;
            }
        }
    }
    for (const [name, child] of Object.entries(value)) {
        if (name.toLowerCase().endsWith('.obj') && typeof child === 'string' && child) {
            return child;
        }
        const found = extractObjContent(child, depth + 1);
        if (found) return found;
    }
    return null;
}

function cachesFor(apiClient) {
    let caches = clientCaches.get(apiClient);
    if (!caches) {
        caches = { urls: new Map(), prototypes: new Map(), pending: new Map() };
        clientCaches.set(apiClient, caches);
    }
    return caches;
}

async function resolveParametricUrl(selection, apiClient, caches) {
    if (caches.urls.has(selection.resId)) return caches.urls.get(selection.resId);
    const detail = await apiClient.getGoodsDetail(selection.resId);
    const url = findStringField(detail?.data?.modelDTO, 'parameterizedJsonUrl')
        ?? findStringField(detail, 'parameterizedJsonUrl');
    if (!url) throw Object.assign(new Error('Parameterized model URL is missing'), {
        code: 'PARAMETRIC_URL_MISSING',
    });
    caches.urls.set(selection.resId, url);
    return url;
}

async function loadLegacyPrototype(instance, selection, {
    apiClient,
    parseObj,
}) {
    const caches = cachesFor(apiClient);
    const parameters = Array.isArray(instance.modelParams) ? instance.modelParams : [];
    const key = `${selection.resId}|${JSON.stringify(parameters)}`;
    if (caches.prototypes.has(key)) return caches.prototypes.get(key);
    if (caches.pending.has(key)) return caches.pending.get(key);

    const pending = (async () => {
        const url = await resolveParametricUrl(selection, apiClient, caches);
        const converted = await apiClient.convertModel(url, parameters);
        const content = extractObjContent(converted);
        if (!content) throw Object.assign(new Error('Converted response contains no OBJ model'), {
            code: 'PARAMETRIC_OBJ_MISSING',
        });
        const prototype = parseObj
            ? parseObj(content, instance.typeId)
            : new OBJLoader().parse(content);
        if (!prototype?.isObject3D) {
            throw Object.assign(new Error('Parsed OBJ model is invalid'), {
                code: 'PARAMETRIC_OBJ_INVALID',
            });
        }
        prototype.name ||= `parametric-${instance.typeId}`;
        caches.prototypes.set(key, prototype);
        return prototype;
    })();
    caches.pending.set(key, pending);
    try {
        return await pending;
    } finally {
        caches.pending.delete(key);
    }
}

async function mapWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), values.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex++;
            results[index] = await mapper(values[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

/** Load legacy soft-list records through the independent per-resource bridge. */
export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const instances = (Array.isArray(softlists) ? softlists : [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.kind === 'softlist' && item?.typeId
            && Array.isArray(item?.footprint) && item.footprint.length >= 3)
        .map(({ item, index }) => normalizeLegacySoftlist(item, index));
    if (instances.length === 0) return [];

    const {
        apiClient = parametricApiClient,
        concurrency = 3,
        logger = console,
        onInstancePlaced,
        onProgress,
        parseObj,
        templateResolver = compatibilityTemplateResolver,
    } = options;
    await templateResolver.load('data/template.json');

    let completed = 0;
    const placed = await mapWithConcurrency(instances, concurrency, async instance => {
        try {
            const selection = templateResolver.select(instance);
            if (!selection || selection.errorCode) {
                throw Object.assign(new Error('Template resource could not be selected'), {
                    code: selection?.errorCode || 'TEMPLATE_SELECTION_FAILED',
                });
            }
            const prototype = await loadLegacyPrototype(instance, selection, { apiClient, parseObj });
            const root = placeContentModel(prototype, instance, selection, {
                kind: 'parametric-obj',
            });
            markLegacyParametricModel(instance, root);
            sceneGroup.add(root);
            try {
                await onInstancePlaced?.(instance, root);
            } catch (error) {
                logger.warn?.('[ParamLoader] placement observer failed', {
                    instanceId: instance.instanceId,
                    code: error?.code || 'OBSERVER_ERROR',
                });
            }
            return root;
        } catch (error) {
            logger.warn?.('[ParamLoader] model failed', {
                instanceId: instance.instanceId,
                typeId: instance.typeId,
                code: error?.code || 'UNKNOWN_ERROR',
            });
            return null;
        } finally {
            completed += 1;
            onProgress?.(completed, instances.length);
        }
    });
    return placed.filter(Boolean);
}
