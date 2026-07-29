import { describeBulgeArc } from './ArcWindowGeometry.js';

const MAX_PARAMETERS = 64;

const GENERIC_ALIASES = Object.freeze([
    ['长', '长度'],
    ['宽', '宽度'],
    ['高', '高度'],
    ['高度', '高度'],
    ['自身高度', '自身高度'],
    ['挡水条高度', '挡水条高度'],
]);

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function setFinite(target, name, value) {
    const number = finiteNumber(value);
    if (!name || number === null) return;
    target.set(name, number);
}

function addGenericAliases(target, blockInnerInfo) {
    for (const [sourceName, parameterName] of GENERIC_ALIASES) {
        if (!Object.prototype.hasOwnProperty.call(blockInnerInfo, sourceName)) continue;
        setFinite(target, parameterName, blockInnerInfo[sourceName]);
    }
}

function addNumericTemplateDefaults(target, selection, onlyWhenMissing = false) {
    const defaults = selection?.templateEntry?.ModelParamterMap;
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return;
    for (const [name, value] of Object.entries(defaults)) {
        if (typeof value !== 'number') continue;
        if (onlyWhenMissing && target.has(name)) continue;
        setFinite(target, name, value);
    }
}

function addStandardWindowParameters(target, blockInnerInfo) {
    setFinite(target, '宽度', blockInnerInfo.长);
    setFinite(target, '高度', blockInnerInfo.高度);
    setFinite(target, '离地', blockInnerInfo.离地高度);
    setFinite(target, '墙厚', blockInnerInfo.宽);
}

function addArcWindowParameters(target, instance, blockInnerInfo) {
    const path = Array.isArray(instance?.cadPath) ? instance.cadPath : [];
    const arc = path.length === 4 ? describeBulgeArc(path[3], path[0]) : null;
    if (!arc) return;
    setFinite(target, '弦长', arc.chordLength);
    setFinite(target, '拱高', arc.sagitta);
    setFinite(target, '窗扇数量', Math.max(1, Math.ceil(arc.arcLength / 600)));
    setFinite(target, '高度', blockInnerInfo.高度);
}

function point(value) {
    if (!value || typeof value !== 'object') return null;
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    return x === null || y === null ? null : { x, y };
}

function squaredDistance(left, right) {
    const x = left.x - right.x;
    const y = left.y - right.y;
    return x * x + y * y;
}

function edgeLength(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function signedArea(points) {
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        twiceArea += current.x * next.y - next.x * current.y;
    }
    return twiceArea / 2;
}

function normalizeFootprintAroundBasePoint(instance) {
    const basePoint = point(instance?.basePoint);
    const footprint = Array.isArray(instance?.footprint)
        ? instance.footprint.map(point).filter(Boolean)
        : [];
    if (!basePoint || footprint.length < 3) return null;

    if (footprint.length > 3
        && squaredDistance(footprint[0], footprint[footprint.length - 1]) <= 1e-12) {
        footprint.pop();
    }
    if (footprint.length < 3) return null;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    footprint.forEach((current, index) => {
        const distance = squaredDistance(current, basePoint);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });

    let ordered = [
        ...footprint.slice(nearestIndex),
        ...footprint.slice(0, nearestIndex),
    ];
    const area = signedArea(ordered);
    if (!Number.isFinite(area) || Math.abs(area) <= 1e-9) return null;
    if (area < 0) ordered = [ordered[0], ...ordered.slice(1).reverse()];
    return ordered;
}

function approximatelyMatches(actual, expected) {
    if (actual === null || expected === null) return false;
    const tolerance = Math.max(1, Math.abs(expected) * 0.001);
    return Math.abs(actual - expected) <= tolerance;
}

function resolveCornerSides(instance, blockInnerInfo) {
    const length = finiteNumber(blockInnerInfo.长);
    const width = finiteNumber(blockInnerInfo.宽);
    const outerLength = finiteNumber(blockInnerInfo.外边长);
    const outerWidth = finiteNumber(blockInnerInfo.外边宽);
    const fallback = {
        rightWidth: length,
        leftWidth: width,
        rightWallThickness: outerLength,
        leftWallThickness: outerWidth,
    };
    const footprint = normalizeFootprintAroundBasePoint(instance);
    if (!footprint) return fallback;

    const previousEdge = edgeLength(footprint[footprint.length - 1], footprint[0]);
    const nextEdge = edgeLength(footprint[0], footprint[1]);
    const lengthThenWidth = approximatelyMatches(previousEdge, length)
        && approximatelyMatches(nextEdge, width);
    const widthThenLength = approximatelyMatches(previousEdge, width)
        && approximatelyMatches(nextEdge, length);

    if (widthThenLength && !lengthThenWidth) {
        return {
            rightWidth: width,
            leftWidth: length,
            rightWallThickness: outerWidth,
            leftWallThickness: outerLength,
        };
    }
    return fallback;
}

function addCornerWindowParameters(target, instance, blockInnerInfo) {
    const sides = resolveCornerSides(instance, blockInnerInfo);
    setFinite(target, '右宽', sides.rightWidth);
    setFinite(target, '左宽', sides.leftWidth);
    setFinite(target, '高度', blockInnerInfo.高度);
    setFinite(target, '离地', blockInnerInfo.离地高度);
    setFinite(target, '右墙厚', sides.rightWallThickness);
    setFinite(target, '左墙厚', sides.leftWallThickness);
}

export function resolveParametricParameters(instance, selection) {
    const target = new Map();
    const blockInnerInfo = instance?.rawBlockInnerInfo
        && typeof instance.rawBlockInnerInfo === 'object'
        ? instance.rawBlockInnerInfo
        : {};
    const typeId = String(instance?.typeId ?? '').trim();
    const hasTypeAdapter = typeId === '1401' || typeId === '1407' || typeId === '140c';

    if (typeId === '1401') addStandardWindowParameters(target, blockInnerInfo);
    if (typeId === '1407') addCornerWindowParameters(target, instance, blockInnerInfo);
    if (typeId === '140c') addArcWindowParameters(target, instance, blockInnerInfo);
    if (hasTypeAdapter) {
        addNumericTemplateDefaults(target, selection, true);
    } else {
        addGenericAliases(target, blockInnerInfo);
        addNumericTemplateDefaults(target, selection);
    }

    return [...target.entries()]
        .slice(0, MAX_PARAMETERS)
        .map(([name, value]) => ({ name, value }));
}
