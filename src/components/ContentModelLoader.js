import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { ContentTemplateResolver } from './ContentTemplateResolver.js';
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
    'placeModel', 'resolveResource', 'logger',
];

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

function failureFor(instance, selection, errorCode, message) {
    return {
        instanceId: instance?.instanceId ?? instance?.id ?? null,
        sourceList: instance?.sourceList ?? null,
        sourceIndex: instance?.sourceIndex ?? null,
        typeId: instance?.typeId == null ? null : String(instance.typeId),
        resId: selection?.resId == null ? null : String(selection.resId),
        errorCode: FAILURE_CODES.has(errorCode) ? errorCode : 'INVALID_RESPONSE',
        message: sanitizedMessage({ message }, 'Content model could not be loaded'),
    };
}

function groupedFailureCounts(failures) {
    const counts = {};
    for (const failure of failures) {
        counts[failure.errorCode] = (counts[failure.errorCode] ?? 0) + 1;
    }
    return counts;
}

function isFallbackInstance(instance) {
    return instance?.sourceList === 'door_list' || instance?.sourceList === 'window_list';
}

function isValidInstance(instance) {
    return Boolean(instance && typeof instance === 'object'
        && String(instance.typeId ?? '').trim());
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
        logger = console,
    } = {}) {
        const gltfLoader = loadGltf ? null : new GLTFLoader();
        const objLoader = parseObj ? null : new OBJLoader();
        this.loadGltf = loadGltf ?? (async url => (await gltfLoader.loadAsync(url)).scene);
        this.parseObj = parseObj ?? (content => objLoader.parse(content));
        this.templateResolver = templateResolver;
        this.apiClient = apiClient;
        this.placeModel = placeModel;
        this.resolveResource = resolveResource;
        this.logger = logger;
        this.prototypeCache = new Map();
        this.prototypeFlights = new Map();
        this.runPrototypeLoad = createLimiter(3);
    }

    async getPrototype(resource, parameters) {
        const key = resource.kind === 'static-glb'
            ? staticCacheKey(resource)
            : parametricCacheKey(resource, parameters);
        if (this.prototypeCache.has(key)) return this.prototypeCache.get(key);
        if (this.prototypeFlights.has(key)) return this.prototypeFlights.get(key);

        const flight = this.runPrototypeLoad(() => resource.kind === 'static-glb'
            ? this.loadStaticPrototype(resource)
            : this.loadParametricPrototype(resource, parameters));
        this.prototypeFlights.set(key, flight);
        try {
            const prototypeRoot = await flight;
            this.prototypeCache.set(key, prototypeRoot);
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
            return preparePrototype(this.parseObj(content), 'MODEL_PARSE_FAILED');
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
        const selectedRecords = [];
        const groups = [];
        let skipped = 0;
        let failed = 0;
        let fallbackVisible = 0;
        let detailsResolved = 0;
        let staticLoaded = 0;
        let parametricLoaded = 0;

        await this.templateResolver.load(options.templatePath);
        for (const currentInstance of sourceInstances) {
            if (!isValidInstance(currentInstance)) {
                failures.push(failureFor(
                    currentInstance, null, 'CONTENT_INPUT_INVALID', 'Content model instance is invalid',
                ));
                skipped += 1;
                if (isFallbackInstance(currentInstance)) fallbackVisible += 1;
                continue;
            }
            let selected;
            try {
                selected = this.templateResolver.select(currentInstance);
            } catch (error) {
                failures.push(failureFor(
                    currentInstance,
                    null,
                    failureCode(error, 'TEMPLATE_TYPE_NOT_FOUND'),
                    sanitizedMessage(error, 'Template selection failed'),
                ));
                skipped += 1;
                if (isFallbackInstance(currentInstance)) fallbackVisible += 1;
                continue;
            }
            if (selected?.errorCode) {
                failures.push(failureFor(
                    currentInstance,
                    selected,
                    selected.errorCode,
                    selected.message ?? 'Template resource selection failed',
                ));
                skipped += 1;
                if (isFallbackInstance(currentInstance)) fallbackVisible += 1;
                continue;
            }
            selectedRecords.push({ instance: currentInstance, selection: selected });
        }

        const uniqueResIds = [...new Set(selectedRecords.map(record => String(record.selection.resId)))];
        let details = new Map();
        let detailLookupFailed = false;
        if (uniqueResIds.length > 0) {
            try {
                details = indexGoodsDetails(await this.apiClient.getGoodsDetails(uniqueResIds));
            } catch (error) {
                const code = failureCode(error, 'RESOURCE_DETAIL_MISSING');
                for (const record of selectedRecords) {
                    failures.push(failureFor(
                        record.instance,
                        record.selection,
                        code,
                        sanitizedMessage(error, 'Resource detail lookup failed'),
                    ));
                    skipped += 1;
                    if (isFallbackInstance(record.instance)) fallbackVisible += 1;
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
                failures.push(failureFor(
                    record.instance,
                    record.selection,
                    'RESOURCE_DETAIL_MISSING',
                    'Resource detail is missing',
                ));
                skipped += 1;
                if (isFallbackInstance(record.instance)) fallbackVisible += 1;
                continue;
            }
            detailsResolved += 1;
            const resource = resourceByResId.get(resId);
            if (resource?.errorCode) {
                failures.push(failureFor(
                    record.instance,
                    record.selection,
                    resource.errorCode,
                    resource.message ?? 'Model resource could not be resolved',
                ));
                skipped += 1;
                if (isFallbackInstance(record.instance)) fallbackVisible += 1;
                continue;
            }
            loadRecords.push({ ...record, resource });
        }

        await mapWithConcurrency(loadRecords, options.concurrency ?? 3, async record => {
            try {
                const model = await this.getPrototype(
                    record.resource,
                    record.instance.modelParams ?? [],
                );
                const root = this.placeModel(
                    model,
                    record.instance,
                    record.selection,
                    record.resource,
                );
                if (!root?.isObject3D) {
                    throw pipelineError('MODEL_SIZE_UNRESOLVED', 'Placed model root is invalid');
                }
                sceneGroup.add(root);
                groups.push(root);
                if (record.resource.kind === 'static-glb') staticLoaded += 1;
                else parametricLoaded += 1;
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
                failures.push(failureFor(
                    record.instance,
                    record.selection,
                    code,
                    sanitizedMessage(error, 'Content model placement failed'),
                ));
                failed += 1;
                if (isFallbackInstance(record.instance)) fallbackVisible += 1;
            }
        });

        const summary = {
            instances: sourceInstances.length,
            selected: selectedRecords.length,
            detailsResolved,
            staticLoaded,
            parametricLoaded,
            fallbackVisible,
            skipped,
            failed,
        };
        this.logger.log('[ContentLoader] summary', summary);
        this.logger.warn('[ContentLoader] failures', groupedFailureCounts(failures));
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
