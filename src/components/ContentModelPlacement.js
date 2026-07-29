import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { describeBulgeArc } from './ArcWindowGeometry.js';

const SIZE_EPSILON = 1e-9;
const FOOTPRINT_AREA_RATIO_EPSILON = 1e-8;

function modelSizeError(message = 'Content model size could not be resolved') {
    const error = new Error(message);
    error.code = 'MODEL_SIZE_UNRESOLVED';
    return error;
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > SIZE_EPSILON ? number : 0;
}

function basePointOf(instance) {
    return instance?.basePoint ?? instance?.basepoint ?? {};
}

function rotationDegreesOf(instance) {
    return finiteNumber(instance?.rotationDegrees ?? instance?.rotate);
}

function resolveCornerWindowPlacement(instance) {
    const footprint = footprintMetrics(
        instance?.footprint,
        rotationDegreesOf(instance),
        basePointOf(instance),
    );
    const sizeX = positiveNumber(instance?.size?.x);
    const sizeY = positiveNumber(instance?.size?.y);
    const wallThickness = positiveNumber(instance?.externalWallThickness);
    if (!footprint?.boundsCenter || !sizeX || !sizeY || !wallThickness) return null;

    const rotation = THREE.MathUtils.degToRad(rotationDegreesOf(instance));
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const halfX = (sizeX + wallThickness) / 2;
    const halfY = (sizeY + wallThickness) / 2;
    const rotatedHalfX = halfX * cosine - halfY * sine;
    const rotatedHalfY = halfX * sine + halfY * cosine;
    const sourceBasePoint = basePointOf(instance);

    return {
        ...instance,
        basePoint: {
            x: footprint.boundsCenter.x - rotatedHalfX,
            y: footprint.boundsCenter.y - rotatedHalfY,
            z: finiteNumber(sourceBasePoint.z),
        },
        footprint: [],
    };
}

function resolveCornerDoorPlacement(instance, horizontalFlip, verticalFlip) {
    const sourceRotation = rotationDegreesOf(instance);
    const footprint = footprintMetrics(
        instance?.footprint,
        sourceRotation,
        basePointOf(instance),
    );
    const sizeX = positiveNumber(instance?.size?.x);
    const sizeY = positiveNumber(instance?.size?.y);
    if (!footprint?.boundsCenter || !sizeX || !sizeY) return null;

    const rotationDegrees = sourceRotation - 90;
    const rotation = THREE.MathUtils.degToRad(rotationDegrees);
    const localCenterX = sizeX / 2 * (horizontalFlip ? -1 : 1);
    const localCenterY = sizeY / 2 * (verticalFlip ? -1 : 1);
    const rotatedCenterX = localCenterX * Math.cos(rotation)
        - localCenterY * Math.sin(rotation);
    const rotatedCenterY = localCenterX * Math.sin(rotation)
        + localCenterY * Math.cos(rotation);
    const sourceBasePoint = basePointOf(instance);

    return {
        ...instance,
        basePoint: {
            x: footprint.boundsCenter.x - rotatedCenterX,
            y: footprint.boundsCenter.y - rotatedCenterY,
            z: finiteNumber(sourceBasePoint.z),
        },
        footprint: [],
        rotationDegrees,
    };
}

function resolveUWindowPlacement(instance, horizontalFlip, verticalFlip) {
    const sourceRotation = rotationDegreesOf(instance);
    const footprint = footprintMetrics(
        instance?.footprint,
        sourceRotation,
        basePointOf(instance),
    );
    const sizeX = positiveNumber(instance?.size?.x);
    const sizeY = positiveNumber(instance?.size?.y);
    const wallThickness = positiveNumber(instance?.externalWallThickness);
    if (!footprint?.boundsCenter || !sizeX || !sizeY || !wallThickness) return null;

    const correctedX = sizeX + wallThickness * 2;
    const correctedY = sizeY + wallThickness;
    const localBoxMin = {
        x: -correctedX / 2,
        y: correctedY - wallThickness,
    };
    const localBoxMax = {
        x: correctedX / 2,
        y: -wallThickness,
    };
    const localCenterX = (localBoxMin.x + localBoxMax.x) / 2
        * (horizontalFlip ? -1 : 1);
    const localCenterY = (localBoxMin.y + localBoxMax.y) / 2
        * (verticalFlip ? -1 : 1);
    const rotation = THREE.MathUtils.degToRad(sourceRotation);
    const rotatedCenterX = localCenterX * Math.cos(rotation)
        - localCenterY * Math.sin(rotation);
    const rotatedCenterY = localCenterX * Math.sin(rotation)
        + localCenterY * Math.cos(rotation);
    const sourceBasePoint = basePointOf(instance);

    return {
        ...instance,
        basePoint: {
            x: footprint.boundsCenter.x - rotatedCenterX,
            y: footprint.boundsCenter.y - rotatedCenterY,
            z: finiteNumber(sourceBasePoint.z),
        },
        footprint: [],
    };
}

function resolvePlacementPlan(instance, selection) {
    if (String(instance?.typeId ?? '').trim() === '140c') {
        const path = Array.isArray(instance?.cadPath) ? instance.cadPath : [];
        const arc = path.length === 4 ? describeBulgeArc(path[3], path[0]) : null;
        if (!arc) throw modelSizeError('Arc-window placement geometry is invalid');
        const sourceBasePoint = basePointOf(instance);
        return {
            instance: {
                ...instance,
                basePoint: {
                    x: arc.apex.x,
                    y: arc.apex.y,
                    z: finiteNumber(sourceBasePoint.z),
                },
                footprint: [],
                // The imported 140c asset faces opposite the apex-to-center
                // direction. Rotating its local +Y to that outward heading
                // requires adding 90 degrees to the geometric heading.
                rotationDegrees: arc.headingDegrees + 90,
                horizontalFlip: false,
                verticalFlip: false,
            },
            effectiveHorizontalFlip: false,
            anchor: 'model-origin',
            arc,
        };
    }

    const effectiveHorizontalFlip = Boolean(instance?.horizontalFlip)
        !== Boolean(selection?.xMirror);
    if (String(instance?.typeId ?? '').trim() === '1408') {
        const verticalFlip = Boolean(instance?.verticalFlip);
        const uWindowInstance = resolveUWindowPlacement(
            instance,
            effectiveHorizontalFlip,
            verticalFlip,
        );
        if (uWindowInstance) {
            return {
                instance: {
                    ...uWindowInstance,
                    horizontalFlip: effectiveHorizontalFlip,
                    verticalFlip,
                },
                effectiveHorizontalFlip,
                anchor: 'model-origin',
                arc: null,
            };
        }
    }
    if (String(instance?.typeId ?? '').trim() === '1313') {
        const cornerInstance = resolveCornerDoorPlacement(
            instance,
            effectiveHorizontalFlip,
            Boolean(instance?.verticalFlip),
        );
        if (cornerInstance) {
            return {
                instance: {
                    ...cornerInstance,
                    horizontalFlip: effectiveHorizontalFlip,
                },
                effectiveHorizontalFlip,
                anchor: 'model-origin',
                arc: null,
            };
        }
    }
    if (String(instance?.typeId ?? '').trim() === '1407') {
        const cornerInstance = resolveCornerWindowPlacement(instance);
        if (cornerInstance) {
            return {
                instance: {
                    ...cornerInstance,
                    horizontalFlip: effectiveHorizontalFlip,
                    verticalFlip: !Boolean(instance?.verticalFlip),
                },
                effectiveHorizontalFlip,
                anchor: 'model-origin',
                arc: null,
            };
        }
    }
    return {
        instance: { ...instance, horizontalFlip: effectiveHorizontalFlip },
        effectiveHorizontalFlip,
        anchor: 'bounds-center',
        arc: null,
    };
}

function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function vectorToPlain(vector) {
    return {
        x: finiteNumber(vector?.x),
        y: finiteNumber(vector?.y),
        z: finiteNumber(vector?.z),
    };
}

function footprintMetrics(footprint, rotationDegrees = 0, basePoint = {}) {
    if (!Array.isArray(footprint) || footprint.length < 3) return null;
    const points = footprint.filter(point =>
        Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
    if (points.length < 3) return null;

    const center = points.reduce((sum, point) => {
        sum.x += finiteNumber(point.x);
        sum.y += finiteNumber(point.y);
        return sum;
    }, { x: 0, y: 0 });
    center.x /= points.length;
    center.y /= points.length;

    const originX = Number.isFinite(Number(basePoint?.x))
        ? Number(basePoint.x) : center.x;
    const originY = Number.isFinite(Number(basePoint?.y))
        ? Number(basePoint.y) : center.y;
    const angle = THREE.MathUtils.degToRad(-finiteNumber(rotationDegrees));
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const localPoints = [];
    for (const point of points) {
        const worldX = finiteNumber(point.x) - originX;
        const worldY = finiteNumber(point.y) - originY;
        const localX = worldX * cosine - worldY * sine;
        const localY = worldX * sine + worldY * cosine;
        localPoints.push({ x: localX, y: localY });
        minX = Math.min(minX, localX);
        minY = Math.min(minY, localY);
        maxX = Math.max(maxX, localX);
        maxY = Math.max(maxY, localY);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (!(spanX > SIZE_EPSILON) || !(spanY > SIZE_EPSILON)) return null;

    let twiceArea = 0;
    for (let index = 0; index < localPoints.length; index++) {
        const current = localPoints[index];
        const next = localPoints[(index + 1) % localPoints.length];
        twiceArea += current.x * next.y - next.x * current.y;
    }
    const area = Math.abs(twiceArea) / 2;
    const footprintScaleSquared = Math.max(spanX, spanY) ** 2;
    if (!(area > footprintScaleSquared * FOOTPRINT_AREA_RATIO_EPSILON)) return null;
    const localBoundsCenter = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
    };
    const forwardAngle = THREE.MathUtils.degToRad(finiteNumber(rotationDegrees));
    const forwardCosine = Math.cos(forwardAngle);
    const forwardSine = Math.sin(forwardAngle);
    const boundsCenter = {
        x: originX + localBoundsCenter.x * forwardCosine
            - localBoundsCenter.y * forwardSine,
        y: originY + localBoundsCenter.x * forwardSine
            + localBoundsCenter.y * forwardCosine,
    };
    return { x: spanX, y: spanY, center, boundsCenter };
}

function validatedBoxSize(modelBox) {
    if (!modelBox || modelBox.isEmpty()) throw modelSizeError('Content model bounds are empty');
    const values = [
        modelBox.min.x, modelBox.min.y, modelBox.min.z,
        modelBox.max.x, modelBox.max.y, modelBox.max.z,
    ];
    if (!values.every(Number.isFinite)) {
        throw modelSizeError('Content model bounds contain non-finite values');
    }
    const size = modelBox.getSize(new THREE.Vector3());
    if (![size.x, size.y, size.z].every(value => value > SIZE_EPSILON)) {
        throw modelSizeError('Content model bounds contain a degenerate dimension');
    }
    return size;
}

function targetSceneSize(instance, selection) {
    const footprint = footprintMetrics(
        instance?.footprint,
        rotationDegreesOf(instance),
        basePointOf(instance),
    );
    const size = instance?.size ?? {};
    const outScale = instance?.outScale ?? {};
    const reference = selection?.referenceSize ?? {};
    const useLocalSize = !footprint;
    const localScale = (axis) => useLocalSize
        ? Math.abs(finiteNumber(outScale?.[axis], 1))
        : 1;
    const fromCadOrReference = (axis, cadValue) => {
        const cad = positiveNumber(cadValue);
        if (cad) return cad * localScale(axis);
        const referenceCm = positiveNumber(reference?.[axis]);
        return referenceCm ? referenceCm * 10 : 0;
    };

    return new THREE.Vector3(
        footprint?.x ?? fromCadOrReference('x', size.x),
        footprint?.y ?? fromCadOrReference('y', size.y),
        fromCadOrReference('z', size.z),
    );
}

function inferParametricUnitScale(modelSize, referenceSize) {
    const axes = ['x', 'y', 'z'].filter(axis => positiveNumber(referenceSize?.[axis]));
    if (axes.length === 0) {
        throw modelSizeError('Parameterized model has no reference dimensions for unit normalization');
    }

    const candidates = [1, 10, 1000];
    let bestScale = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        const score = axes.reduce((total, axis) => {
            const expectedMillimeters = positiveNumber(referenceSize[axis]) * 10;
            const actualMillimeters = modelSize[axis] * candidate;
            return total + Math.abs(Math.log(actualMillimeters / expectedMillimeters));
        }, 0);
        if (score < bestScore) {
            bestScore = score;
            bestScale = candidate;
        }
    }
    return bestScale;
}

function clonePrototype(prototype) {
    const clone = cloneSkeleton(prototype);
    clone.traverse(child => {
        if (!child.isMesh) return;
        if (child.geometry?.clone) child.geometry = child.geometry.clone();
        if (Array.isArray(child.material)) {
            child.material = child.material.map(material => material?.clone?.() ?? material);
        } else if (child.material?.clone) {
            child.material = child.material.clone();
        }
    });
    return clone;
}

function markDoubleSide(root) {
    root.traverse(child => {
        if (!child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => {
            if (material) material.side = THREE.DoubleSide;
        });
    });
}

export function createYUpToZUpTransform() {
    return new THREE.Matrix4().makeRotationX(Math.PI / 2);
}

export function createPlanTransform(instance) {
    const basePoint = basePointOf(instance);
    const position = new THREE.Vector3(
        finiteNumber(basePoint.x),
        finiteNumber(basePoint.y),
        finiteNumber(basePoint.z),
    );
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(rotationDegreesOf(instance)),
    );
    const scale = new THREE.Vector3(
        instance?.horizontalFlip === true ? -1 : 1,
        instance?.verticalFlip === true ? -1 : 1,
        1,
    );
    return new THREE.Matrix4().compose(position, quaternion, scale);
}

export function computeTargetScale(instance, selection, modelBox, resourceKind) {
    const modelSize = validatedBoxSize(modelBox);
    if (resourceKind === 'parametric-obj') {
        const unitScale = inferParametricUnitScale(modelSize, selection?.referenceSize);
        return new THREE.Vector3(unitScale, unitScale, unitScale);
    }

    const targetSize = targetSceneSize(instance, selection);
    if (![targetSize.x, targetSize.y, targetSize.z].every(value => value > SIZE_EPSILON)) {
        throw modelSizeError('Static model target dimensions could not be resolved');
    }
    const result = new THREE.Vector3(
        targetSize.x / modelSize.x,
        targetSize.y / modelSize.y,
        targetSize.z / modelSize.z,
    );
    if (![result.x, result.y, result.z].every(value => Number.isFinite(value) && value > 0)) {
        throw modelSizeError('Content model scale is invalid');
    }
    return result;
}

export function computeModelPlacementOffset(instance, modelBox, scale = 1) {
    validatedBoxSize(modelBox);
    const basePoint = basePointOf(instance);
    const footprint = footprintMetrics(
        instance?.footprint,
        rotationDegreesOf(instance),
        basePoint,
    );
    const footprintCenter = footprint?.center ?? {
        x: finiteNumber(basePoint.x),
        y: finiteNumber(basePoint.y),
    };
    const targetWorld = new THREE.Vector3(
        footprintCenter.x,
        footprintCenter.y,
        finiteNumber(basePoint.z),
    );
    const targetLocal = targetWorld.applyMatrix4(createPlanTransform(instance).invert());
    const modelCenter = modelBox.getCenter(new THREE.Vector3());
    const scaleVector = scale?.isVector3
        ? scale
        : new THREE.Vector3(
            Number.isFinite(scale) && scale !== 0 ? scale : 1,
            Number.isFinite(scale) && scale !== 0 ? scale : 1,
            Number.isFinite(scale) && scale !== 0 ? scale : 1,
        );
    const safeScale = new THREE.Vector3(
        Number.isFinite(scaleVector.x) && scaleVector.x !== 0 ? scaleVector.x : 1,
        Number.isFinite(scaleVector.y) && scaleVector.y !== 0 ? scaleVector.y : 1,
        Number.isFinite(scaleVector.z) && scaleVector.z !== 0 ? scaleVector.z : 1,
    );

    return new THREE.Vector3(
        targetLocal.x / safeScale.x - modelCenter.x,
        targetLocal.y / safeScale.y - modelCenter.y,
        -modelBox.min.z,
    );
}

export function createContentDebugInfo(instance, selection = {}, resource = {}, placement = {}) {
    const worldBox = placement.worldBox;
    const worldSize = worldBox?.getSize?.(new THREE.Vector3()) ?? new THREE.Vector3();
    const effectiveHorizontalFlip = typeof placement.effectiveHorizontalFlip === 'boolean'
        ? placement.effectiveHorizontalFlip
        : Boolean(instance?.horizontalFlip) !== Boolean(selection?.xMirror);
    const effectiveVerticalFlip = typeof placement.effectiveVerticalFlip === 'boolean'
        ? placement.effectiveVerticalFlip
        : instance?.verticalFlip === true;
    const arc = placement.arc;
    return {
        instanceId: instance?.instanceId ?? null,
        sourceList: instance?.sourceList ?? null,
        sourceIndex: instance?.sourceIndex ?? null,
        category: instance?.category ?? null,
        typeId: String(instance?.typeId ?? ''),
        composite: {
            parentInstanceId: instance?.parentInstanceId ?? null,
            segmentIndex: instance?.compositeSegmentIndex ?? null,
            segmentCount: instance?.compositeSegmentCount ?? null,
            generatedFromTypeId: instance?.generatedFromTypeId ?? null,
            generatedTypeId: instance?.generatedFromTypeId
                ? String(instance?.typeId ?? '') : null,
        },
        selection: {
            typeId: selection?.typeId == null ? null : String(selection.typeId),
            typeName: selection?.typeName ?? null,
            resId: selection?.resId == null ? null : String(selection.resId),
            referenceSize: clonePlain(selection?.referenceSize ?? null),
            selection: selection?.selection ?? null,
            xMirror: Boolean(selection?.xMirror),
            groundDist: finiteNumber(selection?.groundDist),
        },
        resource: {
            kind: resource?.kind ?? null,
            resourceType: resource?.resourceType ?? null,
            modelType: resource?.modelType ?? null,
            contentHash: resource?.contentHash ?? null,
        },
        source: {
            basePoint: clonePlain(basePointOf(instance)),
            footprint: clonePlain(instance?.footprint ?? []),
            size: clonePlain(instance?.size ?? null),
            outScale: clonePlain(instance?.outScale ?? null),
            groundHeight: instance?.groundHeight ?? null,
            modelParams: clonePlain(instance?.modelParams ?? []),
        },
        transform: {
            rotationDegrees: finiteNumber(
                placement.rotationDegrees,
                rotationDegreesOf(instance),
            ),
            horizontalFlip: effectiveHorizontalFlip,
            verticalFlip: effectiveVerticalFlip,
            templateXMirror: selection?.xMirror === true,
        },
        placement: {
            rawSize: vectorToPlain(placement.rawSize),
            targetScale: vectorToPlain(placement.targetScale),
            modelOffset: vectorToPlain(placement.modelOffset),
            worldPosition: vectorToPlain(placement.worldPosition),
            worldBounds: {
                min: vectorToPlain(worldBox?.min),
                max: vectorToPlain(worldBox?.max),
                size: vectorToPlain(worldSize),
            },
            arc: arc ? {
                chordLength: finiteNumber(arc.chordLength),
                sagitta: finiteNumber(arc.sagitta),
                arcLength: finiteNumber(arc.arcLength),
                center: clonePlain(arc.center),
                apex: clonePlain(arc.apex),
                headingDegrees: finiteNumber(arc.headingDegrees),
            } : null,
        },
    };
}

export function placeContentModel(prototype, instance, selection = {}, resource = {}) {
    if (!prototype?.isObject3D) throw modelSizeError('Content model prototype is missing');

    const placementPlan = resolvePlacementPlan(instance, selection);
    const effectiveInstance = placementPlan.instance;
    const effectiveHorizontalFlip = placementPlan.effectiveHorizontalFlip;
    const effectiveVerticalFlip = effectiveInstance?.verticalFlip === true;
    const clonedPrototype = clonePrototype(prototype);
    const axisConvertedPrototype = new THREE.Group();
    axisConvertedPrototype.name = 'axisConvertedPrototype';
    axisConvertedPrototype.add(clonedPrototype);
    axisConvertedPrototype.applyMatrix4(createYUpToZUpTransform());
    axisConvertedPrototype.updateMatrixWorld(true);

    const modelBox = new THREE.Box3().setFromObject(axisConvertedPrototype);
    const rawSize = validatedBoxSize(modelBox);
    const targetScale = computeTargetScale(
        effectiveInstance,
        selection,
        modelBox,
        resource?.kind,
    );
    const modelOffset = placementPlan.anchor === 'model-origin'
        ? new THREE.Vector3(0, 0, -modelBox.min.z)
        : computeModelPlacementOffset(effectiveInstance, modelBox, targetScale);
    axisConvertedPrototype.position.add(modelOffset);

    const sizeScale = new THREE.Group();
    sizeScale.name = 'sizeScale';
    sizeScale.scale.copy(targetScale);
    sizeScale.add(axisConvertedPrototype);

    const planFlip = new THREE.Group();
    planFlip.name = 'planFlip';
    planFlip.scale.set(
        effectiveHorizontalFlip ? -1 : 1,
        effectiveVerticalFlip ? -1 : 1,
        1,
    );
    planFlip.add(sizeScale);

    const planRotation = new THREE.Group();
    planRotation.name = 'planRotation';
    planRotation.rotation.z = THREE.MathUtils.degToRad(rotationDegreesOf(effectiveInstance));
    planRotation.add(planFlip);

    const basePoint = basePointOf(effectiveInstance);
    const hasCadGroundHeight = instance?.groundHeight != null
        && Number.isFinite(Number(instance.groundHeight));
    const groundHeight = hasCadGroundHeight
        ? Number(instance.groundHeight)
        : finiteNumber(selection?.groundDist);
    const contentRoot = new THREE.Group();
    contentRoot.name = 'contentRoot';
    contentRoot.position.set(
        finiteNumber(basePoint.x),
        finiteNumber(basePoint.y),
        finiteNumber(basePoint.z) + groundHeight,
    );
    contentRoot.add(planRotation);

    if (effectiveHorizontalFlip || effectiveVerticalFlip) {
        markDoubleSide(clonedPrototype);
    }

    const typeId = String(instance?.typeId ?? '');
    contentRoot.userData = {
        type: 'content-model',
        instanceId: instance?.instanceId ?? null,
        sourceList: instance?.sourceList ?? null,
        sourceIndex: instance?.sourceIndex ?? null,
        typeId,
    };
    clonedPrototype.traverse(child => {
        if (!child.isMesh) return;
        child.userData.type = child.userData.type || 'content-model';
        child.userData.instanceId = child.userData.instanceId ?? instance?.instanceId ?? null;
        child.userData.sourceList = child.userData.sourceList ?? instance?.sourceList ?? null;
        child.userData.sourceIndex = child.userData.sourceIndex ?? instance?.sourceIndex ?? null;
        child.userData.typeId = child.userData.typeId || typeId;
    });

    contentRoot.updateMatrixWorld(true);
    const placement = {
        rawSize,
        targetScale,
        modelOffset,
        worldPosition: contentRoot.getWorldPosition(new THREE.Vector3()),
        worldBox: new THREE.Box3().setFromObject(contentRoot),
        effectiveHorizontalFlip,
        effectiveVerticalFlip,
        rotationDegrees: rotationDegreesOf(effectiveInstance),
        arc: placementPlan.arc,
    };
    contentRoot.userData.debugInfo = createContentDebugInfo(
        instance, selection, resource, placement,
    );
    return contentRoot;
}
