import { describeBulgeArc } from './ArcWindowGeometry.js';
import { contentTypeRuleFor } from './ContentTypeRules.js';

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

function setText(target, name, value) {
    if (!name || typeof value !== 'string' || value.length === 0) return;
    target.set(name, value);
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

function addBayWindowParameters(target, instance, blockInnerInfo) {
    addStandardWindowParameters(target, blockInnerInfo);
    if (String(instance?.typeId ?? '').trim() !== '140302') return;
    const left = instance?.verticalFlip === true;
    setText(target, '\u7a97\u6237\u7c7b\u578b', left
        ? '\u5de6\u4fa7\u73bb\u7483'
        : '\u53f3\u4fa7\u73bb\u7483');
    setText(target, '\u6321\u677f', left
        ? '\u5de6\u4fa7\u6321\u677f'
        : '\u53f3\u4fa7\u6321\u677f');
}

function addDoorWindowParameters(target, blockInnerInfo) {
    const type = blockInnerInfo['\u7c7b\u578b'];
    const doorHeight = finiteNumber(blockInnerInfo['\u95e8\u9ad8']);
    const windowHeight = finiteNumber(blockInnerInfo['\u7a97\u9ad8']);
    setText(target, '\u7c7b\u578b', type);
    setFinite(target, '\u95e8\u9ad8', doorHeight);
    setFinite(target, '\u7a97\u9ad8', windowHeight);
    setFinite(target, '\u526f\u7a97\u9ad8\u5ea6', blockInnerInfo['\u526f\u7a97\u9ad8\u5ea6']);
    setFinite(target, '\u5916\u8fb9\u957f', blockInnerInfo['\u5916\u8fb9\u957f']);
    setFinite(target, '\u957f\u5ea6', blockInnerInfo['\u957f']);
    if (doorHeight === null || windowHeight === null || typeof type !== 'string') return;
    setFinite(target, '\u603b\u9ad8\u5ea6', type.includes('\u65e0\u526f\u7a97')
        ? doorHeight
        : doorHeight + windowHeight);
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

function addArcRailingParameters(target, instance, blockInnerInfo) {
    const path = Array.isArray(instance?.cadPath) ? instance.cadPath : [];
    const arc = path.length === 4 ? describeBulgeArc(path[3], path[0]) : null;
    if (!arc) return;
    setFinite(target, '\u5f26\u957f', arc.chordLength);
    setFinite(target, '\u62f1\u9ad8', arc.sagitta);
    setFinite(target, '\u7a97\u6247\u6570\u91cf', Math.max(1, Math.ceil(arc.arcLength / 600)));
    setFinite(target, '\u534a\u5f84', arc.radius + 25);
    setText(target, '\u4f18\u52a3\u5f27', Math.abs(arc.signedSweepRadians) > Math.PI
        ? '\u4f18\u5f27'
        : '\u52a3\u5f27');
    setFinite(target, '\u9ad8\u5ea6', blockInnerInfo['\u9ad8\u5ea6']);
}

function addUWindowParameters(target, instance, blockInnerInfo) {
    setFinite(target, '宽度', blockInnerInfo.长);
    setFinite(target, '深度', blockInnerInfo.下厚);
    setFinite(target, '左深', blockInnerInfo.左厚);
    setFinite(target, '右深', blockInnerInfo.右厚);
    setFinite(target, '左宽', blockInnerInfo.左宽);
    setFinite(target, '右宽', blockInnerInfo.右宽);
    setFinite(target, '高度', blockInnerInfo.高度);
    setFinite(target, '离地', blockInnerInfo.离地高度);

    const explicitWallThickness = finiteNumber(blockInnerInfo.墙厚);
    setFinite(target, '墙厚', explicitWallThickness === null
        ? instance?.externalWallThickness
        : explicitWallThickness);
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

function addCornerOpeningParameters(target, instance, blockInnerInfo, includeGroundHeight) {
    const sides = resolveCornerSides(instance, blockInnerInfo);
    setFinite(target, '右宽', sides.rightWidth);
    setFinite(target, '左宽', sides.leftWidth);
    setFinite(target, '高度', blockInnerInfo.高度);
    if (includeGroundHeight) setFinite(target, '离地', blockInnerInfo.离地高度);
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
    const family = contentTypeRuleFor(typeId)?.family ?? null;
    const hasTypeAdapter = typeId === '1313'
        || typeId === '1401'
        || typeId === '1407'
        || typeId === '1408'
        || typeId === '140c'
        || family === 'standard-window'
        || family === 'bay-window'
        || family === 'arc-bay-window'
        || family === 'corner-bay-window'
        || family === 'arc-railing'
        || family === 'door-window';

    if (typeId === '1313') addCornerOpeningParameters(target, instance, blockInnerInfo, false);
    if (typeId === '1401') addStandardWindowParameters(target, blockInnerInfo);
    if (typeId === '1407') addCornerOpeningParameters(target, instance, blockInnerInfo, true);
    if (typeId === '1408') addUWindowParameters(target, instance, blockInnerInfo);
    if (typeId === '140c') addArcWindowParameters(target, instance, blockInnerInfo);
    if (family === 'standard-window' || family === 'arc-bay-window') {
        addStandardWindowParameters(target, blockInnerInfo);
    }
    if (family === 'bay-window') addBayWindowParameters(target, instance, blockInnerInfo);
    if (family === 'corner-bay-window') {
        addCornerOpeningParameters(target, instance, blockInnerInfo, true);
    }
    if (family === 'arc-railing') addArcRailingParameters(target, instance, blockInnerInfo);
    if (family === 'door-window') addDoorWindowParameters(target, blockInnerInfo);
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
