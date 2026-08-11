import { pointInPolygon } from './PanoramaPointModel.js';

function xy(point) {
    return {
        x: Number(Array.isArray(point) ? point[0] : point?.x),
        y: Number(Array.isArray(point) ? point[1] : point?.y),
        z: Number(Array.isArray(point) ? point[2] : point?.z),
    };
}

export function pointToSegmentDistance(pointValue, startValue, endValue) {
    const point = xy(pointValue);
    const start = xy(startValue);
    const end = xy(endValue);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!Number.isFinite(lengthSquared) || lengthSquared === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }
    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function findContainingRoom(point, roomPoints) {
    if (!Array.isArray(roomPoints)) return -1;
    return roomPoints.findIndex(room => pointInPolygon(point.x, point.y, room));
}

function nearestWallDistance(point, polygon) {
    let nearest = Infinity;
    for (let index = 0; index < polygon.length; index += 1) {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        nearest = Math.min(nearest, pointToSegmentDistance(point, start, end));
    }
    return nearest;
}

function obstacleBounds(obstacle) {
    const minX = Number(obstacle?.minX ?? obstacle?.min?.x);
    const minY = Number(obstacle?.minY ?? obstacle?.min?.y);
    const minZ = Number(obstacle?.minZ ?? obstacle?.min?.z);
    const maxX = Number(obstacle?.maxX ?? obstacle?.max?.x);
    const maxY = Number(obstacle?.maxY ?? obstacle?.max?.y);
    const maxZ = Number(obstacle?.maxZ ?? obstacle?.max?.z);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    const bounds = {
        minX: Math.min(minX, maxX),
        minY: Math.min(minY, maxY),
        maxX: Math.max(minX, maxX),
        maxY: Math.max(minY, maxY),
    };
    if (Number.isFinite(minZ) && Number.isFinite(maxZ)) {
        bounds.minZ = Math.min(minZ, maxZ);
        bounds.maxZ = Math.max(minZ, maxZ);
    }
    return bounds;
}

function overlappingObstacle(point, obstacles, cameraRadius) {
    for (const obstacle of obstacles) {
        const bounds = obstacleBounds(obstacle);
        if (!bounds) continue;
        const overlapsPlan = point.x >= bounds.minX - cameraRadius
            && point.x <= bounds.maxX + cameraRadius
            && point.y >= bounds.minY - cameraRadius
            && point.y <= bounds.maxY + cameraRadius;
        const hasVerticalBounds = Number.isFinite(bounds.minZ) && Number.isFinite(bounds.maxZ);
        const overlapsHeight = !hasVerticalBounds || !Number.isFinite(point.z)
            || (point.z >= bounds.minZ - cameraRadius
                && point.z <= bounds.maxZ + cameraRadius);
        if (overlapsPlan && overlapsHeight) {
            return obstacle;
        }
    }
    return null;
}

export function validatePanoramaPoint(pointValue, {
    roomPoints = [],
    roomNames = [],
    obstacles = null,
    minWallDistance = 100,
    cameraRadius = 100,
} = {}) {
    const point = xy(pointValue);
    const degraded = !Array.isArray(obstacles);
    const roomIndex = findContainingRoom(point, roomPoints);
    if (roomIndex < 0) {
        return {
            valid: false,
            code: 'OUTSIDE_ROOM',
            roomIndex: -1,
            roomName: '',
            degraded,
        };
    }

    const roomName = String(roomNames[roomIndex] ?? '');
    const requiredClearance = Math.max(0, Number(minWallDistance) || 0)
        + Math.max(0, Number(cameraRadius) || 0);
    const distance = nearestWallDistance(point, roomPoints[roomIndex]);
    if (distance < requiredClearance) {
        return {
            valid: false,
            code: 'TOO_CLOSE_TO_WALL',
            roomIndex,
            roomName,
            degraded,
            distance,
            requiredClearance,
        };
    }

    if (!degraded) {
        const obstacle = overlappingObstacle(point, obstacles, Math.max(0, Number(cameraRadius) || 0));
        if (obstacle) {
            return {
                valid: false,
                code: 'BLOCKED',
                roomIndex,
                roomName,
                degraded: false,
                obstacleId: String(obstacle.id ?? obstacle.name ?? ''),
            };
        }
    }

    return {
        valid: true,
        code: 'OK',
        roomIndex,
        roomName,
        degraded,
    };
}
