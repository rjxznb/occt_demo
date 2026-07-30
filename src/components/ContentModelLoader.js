import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
    applyContentMaterialSemantics,
    contentMaterialCodes,
} from './ContentMaterialSemantics.js';
import { resolveContentMaterialDetails } from './ContentMaterialDetails.js';

import { ContentTemplateResolver } from './ContentTemplateResolver.js';
import { classifyContentCandidates } from './ContentModelClassifier.js';
import { resolveParametricParameters } from './ParametricParameterResolver.js';
import { placeContentModel } from './ContentModelPlacement.js';
import {
    indexGoodsDetails,
    parametricApiClient,
} from '../services/ParametricApiClient.js';
import { resolveModelResource } from '../services/ContentResourceResolver.js';

const FAILURE_CODES = new Set([
    'CONTENT_INPUT_INVALID',
    'TEMPLATE_TYPE_NOT_FOUND',
    'TEMPLATE_RESOURCE_MISSING',
    'UNSUPPORTED_CUSTOM_GEOMETRY',
    'RESOURCE_DETAIL_MISSING',
    'RESOURCE_URL_MISSING',
    'UNSUPPORTED_RESOURCE_TYPE',
    'STATIC_MODEL_LOAD_FAILED',
    'PARAMETRIC_CONVERSION_FAILED',
    'MODEL_PARSE_FAILED',
    'MODEL_SIZE_UNRESOLVED',
    'INVALID_ARGUMENT',
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'RESPONSE_TOO_LARGE',
    'INVALID_RESPONSE',
    'TIMEOUT',
    'CANCELLED',
]);

const DEPENDENCY_OPTIONS = [
    'loadGltf', 'parseObj', 'templateResolver', 'apiClient',
    'placeModel', 'resolveResource', 'resolveParameters', 'logger',
];
const DEFAULT_PROTOTYPE_CACHE_LIMIT = 96;

function finiteNumericString(value) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function stableValue(value, key = '') {
    if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    if (key === 'value') {
        const numeric = finiteNumericString(value);
        if (numeric !== null) return Object.is(numeric, -0) ? 0 : numeric;
    }
    if (Array.isArray(value)) return value.map(item => stableValue(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort()
        .map(property => [property, stableValue(value[property], property)]));
}

export function normalizeParameters(parameters) {
    if (!Array.isArray(parameters) || parameters.length === 0) return '[]';
    const normalized = parameters.map(parameter => stableValue(parameter));
    normalized.sort((left, right) => {
        const leftName = String(left?.name ?? '');
        const rightName = String(right?.name ?? '');
        return leftName.localeCompare(rightName) || JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
    return JSON.stringify(normalized);
}

export function staticCacheKey(resource) {
    return `static:${resource.resId}:${resource.contentHash || 'unversioned'}`;
}

export function parametricCacheKey(resource, parameters) {
    return `parametric:${resource.resId}:${resource.contentHash || 'unversioned'}:${normalizeParameters(parameters)}`;
}

function extractObjContent(data) {
    if (!data || typeof data !== 'object') return null;
    if (typeof data.obj === 'string' && data.obj.trim()) return data.obj;
    if (data.files && typeof data.files === 'object') {
        for (const [name, content] of Object.entries(data.files)) {
            if (name.toLowerCase().endsWith('.obj') && typeof content === 'string' && content.trim()) {
                return content;
            }
        }
    }
    let inner = data;
    for (let depth = 0; depth < 3; depth += 1) {
        if (!inner.data || typeof inner.data !== 'object') break;
        inner = inner.data;
        const content = extractObjContentAtLevel(inner);
        if (content) return content;
    }
    return extractObjContentAtLevel(data, true);
}

function extractObjContentAtLevel(data, scanObjKeys = false) {
    if (typeof data?.obj === 'string' && data.obj.trim()) return data.obj;
    if (data?.files && typeof data.files === 'object') {
        for (const [name, content] of Object.entries(data.files)) {
            if (name.toLowerCase().endsWith('.obj') && typeof content === 'string' && content.trim()) {
                return content;
            }
        }
    }
    if (scanObjKeys) {
        for (const [name, content] of Object.entries(data ?? {})) {
            if (name.toLowerCase().endsWith('.obj') && typeof content === 'string' && content.trim()) {
                return content;
            }
        }
    }
    return null;
}

function pipelineError(code, message, cause) {
    return Object.assign(new Error(message), { code, cause });
}

function usableMaterial(material) {
    return Boolean(material && material.isMaterial === true);
}

function sanitizeSensitiveText(value) {
    return value
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/(?:sourceUrl|webV2Url|parameterizedJsonUrl)/gi, '[redacted-resource-field]');
}

function sanitizeMetadata(value, seen = new WeakSet()) {
    if (typeof value === 'string') return sanitizeSensitiveText(value);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((item, index) => { value[index] = sanitizeMetadata(item, seen); });
        return value;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    for (const key of Object.keys(value)) {
        if (/(?:sourceUrl|webV2Url|parameterizedJsonUrl)/i.test(key)) {
            delete value[key];
        } else {
            value[key] = sanitizeMetadata(value[key], seen);
        }
    }
    return value;
}

function sanitizePrototypeMetadata(root) {
    root.traverse(child => {
        if (typeof child.name === 'string') child.name = sanitizeSensitiveText(child.name);
        if (child.userData && typeof child.userData === 'object') {
            sanitizeMetadata(child.userData);
        }
    });
}

function preparePrototype(root, noMeshCode) {
    if (!root?.isObject3D) throw pipelineError(noMeshCode, 'Model prototype is missing');
    sanitizePrototypeMetadata(root);
    let meshCount = 0;
    root.traverse(child => {
        if (!child.isMesh) return;
        meshCount += 1;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        if (!materials.some(usableMaterial)) {
            child.material = new THREE.MeshStandardMaterial({
                color: 0xB8B0A0,
                roughness: 0.85,
                metalness: 0,
            });
        }
        child.castShadow = true;
        child.receiveShadow = true;
    });
    if (meshCount === 0) throw pipelineError(noMeshCode, 'Model prototype contains no Mesh');
    return root;
}

function sanitizedMessage(error, fallback) {
    const value = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : fallback;
    return sanitizeSensitiveText(value);
}

function failureCode(error, fallback) {
    return FAILURE_CODES.has(error?.code) ? error.code : fallback;
}

function failureFor(instance, selection, resourceKind, errorCode) {
    return {
        sourceList: instance?.sourceList ?? null,
        sourceIndex: instance?.sourceIndex ?? null,
        typeId: instance?.typeId == null ? null : String(instance.typeId),
        resId: selection?.resId == null ? null : String(selection.resId),
        resourceKind: resourceKind ?? null,
        errorCode: FAILURE_CODES.has(errorCode) ? errorCode : 'INVALID_RESPONSE',
    };
}

function groupedFailureCounts(failures) {
    const counts = {};
    for (const failure of failures) {
        counts[failure.errorCode] = (counts[failure.errorCode] ?? 0) + 1;
    }
    return counts;
}

function hasVisibleFallback(options, instance) {
    if (typeof options?.hasFallback !== 'function') return false;
    try {
        return options.hasFallback(instance) === true;
    } catch {
        return false;
    }
}

function isValidInstance(instance) {
    return Boolean(instance && typeof instance === 'object'
        && String(instance.typeId ?? '').trim());
}

function sourceIdentity(instance, inputIndex) {
    if (instance?.parentInstanceId) return String(instance.parentInstanceId);
    if (instance?.sourceList && instance?.sourceIndex != null) {
        return `${instance.sourceList}:${instance.sourceIndex}`;
    }
    if (instance?.instanceId) return String(instance.instanceId);
    return `input:${inputIndex}`;
}

async function mapWithConcurrency(values, concurrency, mapper) {
    const count = Math.max(1, Math.min(3, Number.isFinite(Number(concurrency))
        ? Math.floor(Number(concurrency)) : 3));
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(count, values.length) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            await mapper(values[index], index);
        }
    });
    await Promise.all(workers);
}

function createLimiter(maximum) {
    let active = 0;
    const queue = [];
    return async task => {
        if (active >= maximum) {
            await new Promise(resolve => queue.push(resolve));
        }
        active += 1;
        try {
            return await task();
        } finally {
            active -= 1;
            const resume = queue.shift();
            if (resume) resume();
        }
    };
}

export class ContentModelLoader {
    constructor({
        loadGltf,
        parseObj,
        templateResolver = new ContentTemplateResolver(),
        apiClient = parametricApiClient,
        placeModel = placeContentModel,
        resolveResource = resolveModelResource,
        resolveParameters = resolveParametricParameters,
        logger = console,
        prototypeCacheLimit = DEFAULT_PROTOTYPE_CACHE_LIMIT,
    } = {}) {
        const gltfLoader = loadGltf ? null : new GLTFLoader();
        const dracoLoader = loadGltf ? null : new DRACOLoader()
            .setDecoderPath('data/draco/gltf/')
            .setWorkerLimit(3);
        if (gltfLoader) gltfLoader.setDRACOLoader(dracoLoader);
        const objLoader = parseObj ? null : new OBJLoader();
        this.loadGltf = loadGltf ?? (async url => (await gltfLoader.loadAsync(url)).scene);
        this.parseObj = parseObj ?? (content => objLoader.parse(content));
        this.templateResolver = templateResolver;
        this.apiClient = apiClient;
        this.placeModel = placeModel;
        this.resolveResource = resolveResource;
        this.resolveParameters = resolveParameters;
        this.logger = logger;
        this.prototypeCache = new Map();
        this.prototypeCacheLimit = Math.max(1, Math.floor(Number(prototypeCacheLimit)) || 1);
        this.prototypeFlights = new Map();
        this.runPrototypeLoad = createLimiter(3);
        this.materialDescriptorCache = new Map();
        this.optimizationJsonCache = new Map();
    }

    async getPrototype(resource, parameters) {
        const key = resource.kind === 'static-glb'
            ? staticCacheKey(resource)
            : parametricCacheKey(resource, parameters);
        if (this.prototypeCache.has(key)) {
            const cached = this.prototypeCache.get(key);
            this.prototypeCache.delete(key);
            this.prototypeCache.set(key, cached);
            return cached;
        }
        if (this.prototypeFlights.has(key)) return this.prototypeFlights.get(key);

        const flight = this.runPrototypeLoad(() => resource.kind === 'static-glb'
            ? this.loadStaticPrototype(resource)
            : this.loadParametricPrototype(resource, parameters));
        this.prototypeFlights.set(key, flight);
        try {
            const prototypeRoot = await flight;
            this.prototypeCache.set(key, prototypeRoot);
            while (this.prototypeCache.size > this.prototypeCacheLimit) {
                this.prototypeCache.delete(this.prototypeCache.keys().next().value);
            }
            return prototypeRoot;
        } finally {
            if (this.prototypeFlights.get(key) === flight) this.prototypeFlights.delete(key);
        }
    }

    async loadStaticPrototype(resource) {
        try {
            return preparePrototype(await this.loadGltf(resource.sourceUrl), 'STATIC_MODEL_LOAD_FAILED');
        } catch (error) {
            if (error?.code === 'STATIC_MODEL_LOAD_FAILED') throw error;
            throw pipelineError(
                'STATIC_MODEL_LOAD_FAILED',
                sanitizedMessage(error, 'Static model load failed'),
                error,
            );
        }
    }

    async fetchOptimizationJson(url) {
        if (this.optimizationJsonCache.has(url)) return this.optimizationJsonCache.get(url);
        const fetchJson = this.apiClient.fetchContentJson?.bind(this.apiClient)
            ?? this.apiClient.fetchJson?.bind(this.apiClient);
        if (!fetchJson) throw new Error('Material optimization JSON transport is unavailable');
        const flight = fetchJson(url);
        this.optimizationJsonCache.set(url, flight);
        try {
            return await flight;
        } catch (error) {
            if (this.optimizationJsonCache.get(url) === flight) {
                this.optimizationJsonCache.delete(url);
            }
            throw error;
        }
    }

    async resolveMaterialDescriptors(convertedMaterials) {
        const codes = contentMaterialCodes(convertedMaterials);
        const missing = codes.filter(code => !this.materialDescriptorCache.has(code));
        if (missing.length > 0) {
            const flight = (async () => {
                try {
                    const response = await this.apiClient.getMaterialDetails(missing);
                    return resolveContentMaterialDetails(response?.items, {
                        fetchJson: url => this.fetchOptimizationJson(url),
                    });
                } catch (error) {
                    this.logger.warn('[ContentLoader] PT material details unavailable', {
                        code: failureCode(error, 'NETWORK_ERROR'),
                        message: sanitizedMessage(error, 'PT material details unavailable'),
                    });
                    return new Map();
                }
            })();
            for (const code of missing) {
                const descriptorFlight = flight.then(descriptors => descriptors.get(code) ?? null);
                this.materialDescriptorCache.set(code, descriptorFlight);
                descriptorFlight.then(descriptor => {
                    if (!descriptor && this.materialDescriptorCache.get(code) === descriptorFlight) {
                        this.materialDescriptorCache.delete(code);
                    }
                });
            }
        }
        const descriptors = new Map();
        await Promise.all(codes.map(async code => {
            const descriptor = await this.materialDescriptorCache.get(code);
            if (descriptor) descriptors.set(code, descriptor);
        }));
        return descriptors;
    }

    async loadParametricPrototype(resource, parameters) {
        let converted;
        try {
            converted = await this.apiClient.convertModel(resource.sourceUrl, parameters);
        } catch (error) {
            throw pipelineError(
                failureCode(error, 'PARAMETRIC_CONVERSION_FAILED'),
                sanitizedMessage(error, 'Parameterized model conversion failed'),
                error,
            );
        }
        const content = extractObjContent(converted);
        if (!content) throw pipelineError('MODEL_PARSE_FAILED', 'Model response contains no OBJ data');
        try {
            const prototypeRoot = this.parseObj(content);
            const materialDescriptors = await this.resolveMaterialDescriptors(converted?.material);
            applyContentMaterialSemantics(
                prototypeRoot,
                converted?.material,
                materialDescriptors,
            );
            return preparePrototype(prototypeRoot, 'MODEL_PARSE_FAILED');
        } catch (error) {
            if (error?.code === 'MODEL_PARSE_FAILED') throw error;
            throw pipelineError(
                'MODEL_PARSE_FAILED',
                sanitizedMessage(error, 'OBJ model parse failed'),
                error,
            );
        }
    }

    async load(instances, sceneGroup, options = {}) {
        const sourceInstances = Array.isArray(instances) ? instances : [];
        const failures = [];
        const validInstances = [];
        const groups = [];
        let fallbackVisible = 0;
        let staticSelected = 0;
        let parametricSelected = 0;
        const recordFailure = (instance, selection, resourceKind, errorCode) => {
            failures.push(failureFor(instance, selection, resourceKind, errorCode));
            if (hasVisibleFallback(options, instance)) fallbackVisible += 1;
        };

        await this.templateResolver.load(options.templatePath);
        for (const currentInstance of sourceInstances) {
            if (!isValidInstance(currentInstance)) {
                recordFailure(currentInstance, null, null, 'CONTENT_INPUT_INVALID');
                continue;
            }
            validInstances.push(currentInstance);
        }

        const classification = classifyContentCandidates(validInstances, this.templateResolver);
        const { selectedRecords, localGeometry, openingOnly } = classification;

        const uniqueResIds = [...new Set(selectedRecords.map(record => String(record.selection.resId)))];
        let details = new Map();
        let detailLookupFailed = false;
        if (uniqueResIds.length > 0) {
            try {
                details = indexGoodsDetails(await this.apiClient.getGoodsDetails(uniqueResIds));
            } catch (error) {
                const code = failureCode(error, 'RESOURCE_DETAIL_MISSING');
                for (const record of selectedRecords) {
                    recordFailure(record.instance, record.selection, null, code);
                }
                detailLookupFailed = true;
            }
        }

        const resourceByResId = new Map();
        for (const resId of uniqueResIds) {
            const detail = details.get(resId);
            if (!detail) continue;
            resourceByResId.set(resId, this.resolveResource(resId, detail));
        }

        const loadRecords = [];
        for (const record of detailLookupFailed ? [] : selectedRecords) {
            const resId = String(record.selection.resId);
            const detail = details.get(resId);
            if (!detail) {
                recordFailure(
                    record.instance, record.selection, null, 'RESOURCE_DETAIL_MISSING',
                );
                continue;
            }
            const resource = resourceByResId.get(resId);
            if (resource?.errorCode) {
                recordFailure(record.instance, record.selection, null, resource.errorCode);
                continue;
            }
            if (resource.kind === 'static-glb') staticSelected += 1;
            else parametricSelected += 1;
            loadRecords.push({ ...record, resource });
        }

        await mapWithConcurrency(loadRecords, options.concurrency ?? 3, async record => {
            try {
                const parameters = record.resource.kind === 'parametric-obj'
                    ? this.resolveParameters(record.instance, record.selection)
                    : [];
                const model = await this.getPrototype(
                    record.resource,
                    parameters,
                );
                const placementInstance = record.resource.kind === 'parametric-obj'
                    ? { ...record.instance, modelParams: parameters }
                    : record.instance;
                const root = this.placeModel(
                    model,
                    placementInstance,
                    record.selection,
                    record.resource,
                );
                if (!root?.isObject3D) {
                    throw pipelineError('MODEL_SIZE_UNRESOLVED', 'Placed model root is invalid');
                }
                const placementTarget = typeof options.getPlacementTarget === 'function'
                    ? options.getPlacementTarget(record.instance)
                    : sceneGroup;
                if (!placementTarget?.isObject3D) {
                    throw pipelineError(
                        'MODEL_SIZE_UNRESOLVED',
                        'Content placement target is invalid',
                    );
                }
                placementTarget.add(root);
                groups.push(root);
                if (typeof options.onInstancePlaced === 'function') {
                    try {
                        await options.onInstancePlaced(record.instance, root);
                    } catch {
                        // Placement is already complete; observer failures must not remove the model.
                    }
                }
                if (typeof options.onProgress === 'function') {
                    try {
                        await options.onProgress(groups.length, loadRecords.length);
                    } catch {
                        // Progress reporting is not part of model loading or placement.
                    }
                }
            } catch (error) {
                const code = failureCode(error, 'MODEL_SIZE_UNRESOLVED');
                recordFailure(
                    record.instance, record.selection, record.resource.kind, code,
                );
            }
        });

        const summary = {
            discovered: new Set(sourceInstances.map(sourceIdentity)).size,
            localGeometry: localGeometry.length,
            staticSelected,
            parametricSelected,
            placed: groups.length,
            fallbackVisible,
            openingOnly: openingOnly.length,
            failed: failures.length,
        };
        if (options.logSummary !== false) {
            this.logger.log(
                `[ContentLoader] discovered=${summary.discovered} `
                + `localGeometry=${summary.localGeometry} staticSelected=${summary.staticSelected} `
                + `parametricSelected=${summary.parametricSelected} placed=${summary.placed} `
                + `fallbackVisible=${summary.fallbackVisible} openingOnly=${summary.openingOnly} `
                + `failed=${summary.failed}`,
            );
            if (failures.length > 0) {
                this.logger.warn('[ContentLoader] failures', groupedFailureCounts(failures));
            }
        }
        return {
            groups,
            summary,
            failures,
            selections: selectedRecords.map(record => record.selection),
        };
    }
}

export const contentModelLoader = new ContentModelLoader();

export function loadContentModels(instances, sceneGroup, options = {}) {
    if (options.loader) return options.loader.load(instances, sceneGroup, options);
    const hasDependencyOverride = DEPENDENCY_OPTIONS.some(key => options[key] !== undefined);
    const loader = hasDependencyOverride ? new ContentModelLoader(options) : contentModelLoader;
    return loader.load(instances, sceneGroup, options);
}
