import {
    describeBulgeArc,
    offsetBulgeArc,
} from './ArcWindowGeometry.js';

const DISTANCE_EPSILON = 1e-9;
const BULGE_EPSILON = 1e-6;
const ARC_SAMPLE_RADIANS = Math.PI / 18;

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizePath(path) {
    if (!Array.isArray(path)) return null;
    const result = [];
    for (const point of path) {
        const x = finiteNumber(point?.x);
        const y = finiteNumber(point?.y);
        const z = finiteNumber(point?.z) ?? 0;
        const bulge = finiteNumber(point?.bulge) ?? 0;
        if (x === null || y === null) return null;
        result.push({ x, y, z, bulge });
    }
    return result;
}

function distance(left, right) {
    return Math.hypot(right.x - left.x, right.y - left.y);
}

function midpoint(left, right) {
    return {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
        z: (left.z + right.z) / 2,
        bulge: 0,
    };
}

function move(point, direction, amount) {
    return {
        x: point.x + direction.x * amount,
        y: point.y + direction.y * amount,
        z: point.z,
        bulge: 0,
    };
}

function distanceToLine(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const length = Math.hypot(dx, dy);
    if (!(length > DISTANCE_EPSILON)) return null;
    return Math.abs(dx * (lineStart.y - point.y) - (lineStart.x - point.x) * dy)
        / length;
}

function adjustStraightSegment(v1, v2, v3, v4) {
    const frontLength = distance(v1, v2);
    if (!(frontLength > DISTANCE_EPSILON)) return null;
    const thickness = distanceToLine(midpoint(v1, v2), v3, v4);
    if (!(thickness > DISTANCE_EPSILON)) return null;

    const direction = {
        x: (v2.x - v1.x) / frontLength,
        y: (v2.y - v1.y) / frontLength,
    };
    let normal = { x: direction.y, y: -direction.x };
    const originalNormal = { x: v4.x - v1.x, y: v4.y - v1.y };
    if (normal.x * originalNormal.x + normal.y * originalNormal.y < 0) {
        normal = { x: -normal.x, y: -normal.y };
    }

    const middle14 = midpoint(v1, v4);
    const middle23 = midpoint(v2, v3);
    return [
        move(middle14, normal, -thickness),
        move(middle23, normal, -thickness),
        move(middle23, normal, thickness),
        move(middle14, normal, thickness),
    ];
}

function adjustArcSegment(v1, v2, v3, v4) {
    const inner = describeBulgeArc(v1, v2);
    const outer = describeBulgeArc(v3, v4);
    if (!inner || !outer) return null;

    const thickness = Math.abs(inner.radius - outer.radius);
    if (!(thickness > DISTANCE_EPSILON)) return null;
    const radiusCandidates = [inner.radius + thickness, inner.radius - thickness]
        .filter(radius => radius > DISTANCE_EPSILON);
    const targetRadius = radiusCandidates.reduce((closest, radius) => (
        Math.abs(radius - outer.radius) < Math.abs(closest - outer.radius)
            ? radius : closest
    ));
    const offset = offsetBulgeArc(inner, targetRadius);
    if (!offset) return null;

    return [
        { ...v2, bulge: 0 },
        { ...offset.end, bulge: -v1.bulge },
        { ...offset.start, bulge: 0 },
        { ...v1, bulge: v1.bulge },
    ];
}

function sampleCadPath(cadPath) {
    const footprint = [];
    for (let index = 0; index < cadPath.length; index += 1) {
        const start = cadPath[index];
        const end = cadPath[(index + 1) % cadPath.length];
        const arc = Math.abs(start.bulge) > BULGE_EPSILON
            ? describeBulgeArc(start, end)
            : null;
        if (!arc) {
            footprint.push({ x: start.x, y: start.y });
            continue;
        }
        const startAngle = Math.atan2(
            start.y - arc.center.y,
            start.x - arc.center.x,
        );
        const steps = Math.max(2, Math.ceil(
            Math.abs(arc.signedSweepRadians) / ARC_SAMPLE_RADIANS,
        ));
        for (let step = 0; step < steps; step += 1) {
            const angle = startAngle + arc.signedSweepRadians * step / steps;
            footprint.push({
                x: arc.center.x + Math.cos(angle) * arc.radius,
                y: arc.center.y + Math.sin(angle) * arc.radius,
            });
        }
    }
    return footprint;
}

function sourceHeight(instance) {
    return finiteNumber(instance?.rawBlockInnerInfo?.高度)
        ?? finiteNumber(instance?.size?.z)
        ?? 0;
}

function commonChildFields(instance, index, count, typeId, cadPath) {
    return {
        ...instance,
        instanceId: `${instance.instanceId}#segment:${index}`,
        parentInstanceId: instance.instanceId,
        compositeSegmentIndex: index,
        compositeSegmentCount: count,
        generatedFromTypeId: '140d02',
        typeId,
        cadPath,
        footprint: sampleCadPath(cadPath),
        outScale: { x: 1, y: 1, z: 1 },
        rotationDegrees: 0,
        horizontalFlip: false,
        verticalFlip: false,
        rawBlockInnerInfo: { ...(instance.rawBlockInnerInfo ?? {}) },
    };
}

function createStraightChild(instance, index, count, cadPath) {
    const width = distance(cadPath[0], cadPath[1]);
    const thickness = distance(cadPath[1], cadPath[2]);
    const height = sourceHeight(instance);
    const child = commonChildFields(instance, index, count, '1401', cadPath);
    child.basePoint = {
        x: cadPath[0].x,
        y: cadPath[0].y,
        z: cadPath[0].z,
    };
    child.rotationDegrees = Math.atan2(
        cadPath[1].y - cadPath[0].y,
        cadPath[1].x - cadPath[0].x,
    ) * 180 / Math.PI;
    child.size = { x: width, y: thickness, z: height };
    child.rawBlockInnerInfo = {
        ...child.rawBlockInnerInfo,
        长: width,
        宽: thickness,
        高度: height,
        离地高度: child.groundHeight,
    };
    return child;
}

function createArcChild(instance, index, count, cadPath) {
    const inner = describeBulgeArc(cadPath[3], cadPath[0]);
    const outer = describeBulgeArc(cadPath[1], cadPath[2]);
    if (!inner || !outer) return null;
    const child = commonChildFields(instance, index, count, '140c', cadPath);
    child.size = {
        x: inner.chordLength,
        y: Math.abs(inner.radius - outer.radius),
        z: sourceHeight(instance),
    };
    return child;
}

function expandFreeWindow(instance) {
    const path = normalizePath(instance?.cadPath);
    if (!path || path.length < 4 || path.length % 2 !== 0) return null;

    const half = path.length / 2;
    const front = path.slice(0, half);
    const back = path.slice(half).reverse();
    const adjusted = [];
    for (let index = 0; index < half - 1; index += 1) {
        const v1 = front[index];
        const v2 = front[index + 1];
        const v3 = back[index + 1];
        const v4 = back[index];
        const isArc = Math.abs(v1.bulge) > BULGE_EPSILON;
        const cadPath = isArc
            ? adjustArcSegment(v1, v2, v3, v4)
            : adjustStraightSegment(v1, v2, v3, v4);
        if (!cadPath) return null;
        adjusted.push({ isArc, cadPath });
    }

    const count = adjusted.length;
    if (count === 0) return null;
    const children = adjusted.map(({ isArc, cadPath }, index) => (
        isArc
            ? createArcChild(instance, index, count, cadPath)
            : createStraightChild(instance, index, count, cadPath)
    ));
    return children.every(Boolean) ? children : null;
}

export function expandFreeWindowInstances(instances) {
    if (!Array.isArray(instances)) return [];
    return instances.flatMap(instance => {
        if (String(instance?.typeId ?? '').trim() !== '140d02') return [instance];
        return expandFreeWindow(instance) ?? [instance];
    });
}
