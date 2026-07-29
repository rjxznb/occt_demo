const BULGE_EPSILON = 1e-6;
const DISTANCE_EPSILON = 1e-9;

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function finitePoint(value) {
    if (!value || typeof value !== 'object') return null;
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    const z = finiteNumber(value.z) ?? 0;
    return x === null || y === null ? null : { x, y, z };
}

export function describeBulgeArc(start, end) {
    const normalizedStart = finitePoint(start);
    const normalizedEnd = finitePoint(end);
    const bulge = finiteNumber(start?.bulge);
    if (!normalizedStart || !normalizedEnd || bulge === null
        || Math.abs(bulge) <= BULGE_EPSILON) return null;

    const dx = normalizedEnd.x - normalizedStart.x;
    const dy = normalizedEnd.y - normalizedStart.y;
    const chordLength = Math.hypot(dx, dy);
    if (!(chordLength > DISTANCE_EPSILON)) return null;

    const leftNormal = { x: -dy / chordLength, y: dx / chordLength };
    const midpoint = {
        x: (normalizedStart.x + normalizedEnd.x) / 2,
        y: (normalizedStart.y + normalizedEnd.y) / 2,
    };
    const signedSweepRadians = 4 * Math.atan(bulge);
    const radius = chordLength * (1 + bulge * bulge) / (4 * Math.abs(bulge));
    const sagitta = Math.abs(bulge * chordLength / 2);
    const centerOffset = chordLength * (1 - bulge * bulge) / (4 * bulge);
    const center = {
        x: midpoint.x + leftNormal.x * centerOffset,
        y: midpoint.y + leftNormal.y * centerOffset,
    };
    const apex = {
        x: midpoint.x - leftNormal.x * bulge * chordLength / 2,
        y: midpoint.y - leftNormal.y * bulge * chordLength / 2,
    };
    const arcLength = radius * Math.abs(signedSweepRadians);
    const headingDegrees = Math.atan2(
        center.y - apex.y,
        center.x - apex.x,
    ) * 180 / Math.PI;

    const finiteFacts = [
        chordLength, signedSweepRadians, radius, sagitta, arcLength,
        center.x, center.y, apex.x, apex.y, headingDegrees,
    ];
    if (!finiteFacts.every(Number.isFinite)) return null;

    return {
        start: { ...normalizedStart, bulge },
        end: { ...normalizedEnd, bulge: finiteNumber(end?.bulge) ?? 0 },
        chordLength,
        signedSweepRadians,
        radius,
        sagitta,
        arcLength,
        center,
        apex,
        headingDegrees,
    };
}

export function offsetBulgeArc(arc, targetRadius) {
    const radius = finiteNumber(targetRadius);
    const sourceRadius = finiteNumber(arc?.radius);
    const center = finitePoint(arc?.center);
    const start = finitePoint(arc?.start);
    const end = finitePoint(arc?.end);
    const bulge = finiteNumber(arc?.start?.bulge);
    if (!(radius > DISTANCE_EPSILON) || !(sourceRadius > DISTANCE_EPSILON)
        || !center || !start || !end || bulge === null) return null;

    const moveToRadius = point => ({
        x: center.x + (point.x - center.x) * radius / sourceRadius,
        y: center.y + (point.y - center.y) * radius / sourceRadius,
        z: point.z,
    });
    return {
        start: { ...moveToRadius(start), bulge },
        end: { ...moveToRadius(end), bulge: 0 },
    };
}
