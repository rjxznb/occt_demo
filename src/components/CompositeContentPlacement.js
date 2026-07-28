import * as THREE from 'three';

function fallbackKey(instance) {
    if (!instance?.sourceList || instance?.sourceIndex == null) return null;
    return `${instance.sourceList}:${instance.sourceIndex}`;
}

function fallbackFor(fallbacks, instance) {
    const key = fallbackKey(instance);
    return key ? fallbacks?.get(key) ?? null : null;
}

function isCompositeChild(instance) {
    return instance?.generatedFromTypeId === '140d02'
        && typeof instance?.parentInstanceId === 'string'
        && instance.parentInstanceId.length > 0;
}

function hideFallback(fallbacks, instance) {
    const fallback = fallbackFor(fallbacks, instance);
    if (!fallback) return false;
    fallback.visible = false;
    return true;
}

function markPlacedRoot(root) {
    if (root?.isObject3D) root.userData.contentModelRoot = true;
}

function expectedIds(parentInstanceId, count) {
    return Array.from(
        { length: count },
        (_, index) => `${parentInstanceId}#segment:${index}`,
    );
}

function createCompositeStates(instances) {
    const states = new Map();
    for (const instance of instances) {
        if (!isCompositeChild(instance)) continue;
        const parentInstanceId = instance.parentInstanceId;
        const count = Number(instance.compositeSegmentCount);
        const index = Number(instance.compositeSegmentIndex);
        const validCount = Number.isInteger(count) && count > 0;
        let state = states.get(parentInstanceId);
        if (!state) {
            const stage = new THREE.Group();
            stage.name = `contentComposite:${parentInstanceId}`;
            stage.userData = {
                type: 'content-model-composite',
                parentInstanceId,
            };
            state = {
                parentInstanceId,
                count: validCount ? count : 0,
                expectedIds: validCount ? expectedIds(parentInstanceId, count) : [],
                candidateIds: new Set(),
                placedRoots: new Map(),
                representative: instance,
                stage,
                valid: validCount,
            };
            states.set(parentInstanceId, state);
        }
        if (!validCount || count !== state.count || !Number.isInteger(index)
            || index < 0 || index >= count
            || instance.instanceId !== `${parentInstanceId}#segment:${index}`
            || state.candidateIds.has(instance.instanceId)) {
            state.valid = false;
        }
        state.candidateIds.add(instance.instanceId);
    }
    return states;
}

export function createCompositeContentPlacement(instances, sceneGroup, fallbacks) {
    const sourceInstances = Array.isArray(instances) ? instances : [];
    const states = createCompositeStates(sourceInstances);
    const stateFor = instance => isCompositeChild(instance)
        ? states.get(instance.parentInstanceId) ?? null
        : null;

    return {
        getPlacementTarget(instance) {
            return stateFor(instance)?.stage ?? sceneGroup;
        },

        onInstancePlaced(instance, root) {
            const state = stateFor(instance);
            if (state) {
                if (root?.isObject3D) state.placedRoots.set(instance.instanceId, root);
                return;
            }
            markPlacedRoot(root);
            hideFallback(fallbacks, instance);
        },

        hasFallback(instance) {
            if (stateFor(instance)) return false;
            return Boolean(fallbackFor(fallbacks, instance));
        },

        finalize(loadResult = {}) {
            const result = loadResult && typeof loadResult === 'object' ? loadResult : {};
            if (states.size === 0) return result;
            const groups = Array.isArray(result.groups) ? result.groups : [];
            const rolledBackRoots = new Set();
            let failedCompositeFallbacks = 0;

            for (const state of states.values()) {
                const completeCandidates = state.expectedIds.every(id =>
                    state.candidateIds.has(id));
                const completePlacements = state.expectedIds.every(id =>
                    state.placedRoots.has(id));
                const success = state.valid && completeCandidates && completePlacements;
                if (success) {
                    state.stage.clear();
                    for (const id of state.expectedIds) {
                        const root = state.placedRoots.get(id);
                        markPlacedRoot(root);
                        state.stage.add(root);
                    }
                    sceneGroup.add(state.stage);
                    hideFallback(fallbacks, state.representative);
                    continue;
                }

                for (const root of state.stage.children) rolledBackRoots.add(root);
                for (const root of state.placedRoots.values()) rolledBackRoots.add(root);
                state.stage.clear();
                if (fallbackFor(fallbacks, state.representative)) {
                    failedCompositeFallbacks += 1;
                }
            }

            result.groups = groups.filter(root => !rolledBackRoots.has(root));
            result.summary = result.summary && typeof result.summary === 'object'
                ? result.summary : {};
            result.summary.placed = result.groups.length;
            const loaderFallbacks = Number(result.summary.fallbackVisible);
            result.summary.fallbackVisible = (Number.isFinite(loaderFallbacks)
                ? loaderFallbacks : 0) + failedCompositeFallbacks;
            if (!Array.isArray(result.failures)) result.failures = [];
            return result;
        },
    };
}
