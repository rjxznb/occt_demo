const CAMERA_TYPE_IDS = new Set(['27d2', '27d202']);
const DEFAULT_CAMERA_HEIGHT = 1500;

function finiteCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

export function parseCadVector(value) {
    if (value && typeof value === 'object') {
        return {
            x: finiteCoordinate(value.x ?? value.X),
            y: finiteCoordinate(value.y ?? value.Y),
            z: finiteCoordinate(value.z ?? value.Z),
        };
    }
    const text = String(value ?? '');
    const numberFor = axis => {
        const match = text.match(new RegExp(`${axis}=([-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?)`, 'i'));
        return match ? Number(match[1]) : 0;
    };
    return { x: numberFor('X'), y: numberFor('Y'), z: numberFor('Z') };
}

function hasPlanCoordinates(value) {
    if (value && typeof value === 'object') {
        return Number.isFinite(Number(value.x ?? value.X))
            && Number.isFinite(Number(value.y ?? value.Y));
    }
    const text = String(value ?? '');
    return /X=[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i.test(text)
        && /Y=[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i.test(text);
}

function pointXY(point) {
    return {
        x: Number(Array.isArray(point) ? point[0] : point?.x),
        y: Number(Array.isArray(point) ? point[1] : point?.y),
    };
}

function pointOnSegment(point, a, b, tolerance = 1e-6) {
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    if (Math.abs(cross) > tolerance) return false;
    const dot = (point.x - a.x) * (point.x - b.x) + (point.y - a.y) * (point.y - b.y);
    return dot <= tolerance;
}

export function pointInPolygon(x, y, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    const point = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const a = pointXY(polygon[j]);
        const b = pointXY(polygon[i]);
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
        if (pointOnSegment(point, a, b)) return true;
        const intersects = ((a.y > point.y) !== (b.y > point.y))
            && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

function hashText(value) {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function explicitRecordId(record) {
    return record.Id ?? record.ID ?? record.id
        ?? record.ObjectId ?? record.objectId
        ?? record.Guid ?? record.GUID ?? record.guid
        ?? record.InstanceId ?? record.instanceId;
}

function stablePointId(record, facts, duplicateIndex) {
    const explicit = explicitRecordId(record);
    if (explicit != null && String(explicit).trim()) return `camera:${String(explicit).trim()}`;
    const fingerprint = hashText([
        facts.typeId,
        facts.x,
        facts.y,
        facts.z,
        facts.name,
    ].join('|'));
    return `camera:${fingerprint}${duplicateIndex ? `-${duplicateIndex + 1}` : ''}`;
}

function roomForPoint(x, y, roomPoints, roomNames) {
    if (!Array.isArray(roomPoints) || roomPoints.length === 0) {
        return { roomIndex: -1, roomName: '', valid: true, invalidReason: null };
    }
    const roomIndex = roomPoints.findIndex(room => pointInPolygon(x, y, room));
    if (roomIndex < 0) {
        return { roomIndex: -1, roomName: '', valid: false, invalidReason: 'OUTSIDE_ROOM' };
    }
    return {
        roomIndex,
        roomName: String(roomNames?.[roomIndex] ?? ''),
        valid: true,
        invalidReason: null,
    };
}

export function normalizePanoramaPoints(cameraList, {
    roomPoints = [],
    roomNames = [],
} = {}) {
    if (!Array.isArray(cameraList)) return [];
    const duplicateCounts = new Map();

    return cameraList.flatMap((record, sourceIndex) => {
        if (!record || typeof record !== 'object') return [];
        const typeId = String(record.TypeId ?? record.typeId ?? '').toLowerCase();
        if (typeId && !CAMERA_TYPE_IDS.has(typeId)) return [];

        const baseValue = record.BasePoint ?? record.basePoint;
        if (!hasPlanCoordinates(baseValue)) return [];
        const basePoint = parseCadVector(baseValue);
        const block = record.BlockInnerInfo ?? record.blockInnerInfo ?? {};
        const rotationValue = block.Rotation ?? record.Rotation;
        const rotation = parseCadVector(rotationValue);
        const hasRotationVector = rotationValue != null;
        const height = Number(block['离地高度'] ?? block.liftoffHeight ?? basePoint.z);
        const yaw = hasRotationVector
            ? rotation.y
            : Number(block['旋转角度'] ?? block.rotationAngle ?? record.OutRotateRadian ?? 0);
        const pitch = hasRotationVector ? rotation.x : Number(block.Pitch ?? 0);
        const fov = Number(block.FOV ?? block.fov ?? record.FOV ?? 90);
        const facts = {
            typeId: typeId || '27d2',
            name: String(record.DisplayName ?? record.Name ?? `点位 ${sourceIndex + 1}`),
            x: basePoint.x,
            y: basePoint.y,
            z: Number.isFinite(height) && height > 0 ? height : DEFAULT_CAMERA_HEIGHT,
        };
        const duplicateKey = `${facts.typeId}|${facts.x}|${facts.y}|${facts.z}|${facts.name}`;
        const duplicateIndex = duplicateCounts.get(duplicateKey) ?? 0;
        duplicateCounts.set(duplicateKey, duplicateIndex + 1);
        const room = roomForPoint(facts.x, facts.y, roomPoints, roomNames);

        return [{
            id: stablePointId(record, facts, duplicateIndex),
            sourceIndex,
            ...facts,
            yaw: Number.isFinite(yaw) ? yaw : 0,
            pitch: Number.isFinite(pitch) ? pitch : 0,
            fov: Number.isFinite(fov) ? Math.min(150, Math.max(30, fov)) : 90,
            ...room,
            raw: record,
        }];
    });
}

export function normalizeCameraPresets(cameraList) {
    return normalizePanoramaPoints(cameraList);
}

export function selectInitialPanoramaPoint(points, {
    initialPointId = null,
    lastActivePointId = null,
} = {}) {
    const validPoints = Array.isArray(points)
        ? points.filter(point => point && point.valid !== false && point.deleted !== true)
        : [];
    if (!validPoints.length) return null;
    return validPoints.find(point => point.id === initialPointId)
        ?? validPoints.find(point => point.id === lastActivePointId)
        ?? validPoints[0];
}
