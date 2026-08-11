const DIRECTIONS = new Set(['forward', 'backward', 'left', 'right']);

function finitePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function directionBasis(yaw, direction) {
    const radians = yaw * Math.PI / 180;
    const forward = { x: Math.cos(radians), y: Math.sin(radians) };
    const right = { x: Math.sin(radians), y: -Math.cos(radians) };
    if (direction === 'forward') return forward;
    if (direction === 'backward') return { x: -forward.x, y: -forward.y };
    if (direction === 'right') return right;
    return { x: -right.x, y: -right.y };
}

export function selectDirectionalPanoramaPoint({
    activePoint,
    points = [],
    yaw,
    direction,
    coneDegrees = 60,
} = {}) {
    const origin = finitePoint(activePoint);
    const liveYaw = Number(yaw);
    if (!origin || !Array.isArray(points) || !Number.isFinite(liveYaw)
        || !DIRECTIONS.has(direction)) return null;

    const cone = Math.max(0, Math.min(180, Number(coneDegrees) || 0));
    const minimumDot = Math.cos(cone * Math.PI / 180);
    const basis = directionBasis(liveYaw, direction);
    const activeId = activePoint?.id;
    const candidates = [];

    points.forEach((point, index) => {
        if (!point || point.valid === false || point === activePoint
            || (activeId != null && point.id === activeId)) return;
        const position = finitePoint(point);
        if (!position) return;
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const distanceSquared = dx * dx + dy * dy;
        if (!(distanceSquared > 0)) return;
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        const dot = (dx * basis.x + dy * basis.y) * inverseDistance;
        if (dot < minimumDot) return;
        candidates.push({ point, index, dot, distanceSquared });
    });

    candidates.sort((a, b) => (b.dot - a.dot)
        || (a.distanceSquared - b.distanceSquared)
        || (a.index - b.index));
    return candidates[0]?.point ?? null;
}

