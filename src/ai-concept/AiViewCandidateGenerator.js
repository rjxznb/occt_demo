import { classifyAiRoom, normalizeAiView } from './AiViewModel.js';
import { validatePanoramaPoint } from '../panorama/PanoramaPointValidator.js';

const DEFAULT_CAMERA_HEIGHT = 1500;
const DEFAULT_HORIZONTAL_FOV = 86;
const RULE_PRIORITY = Object.freeze({
    entrance: 4,
    'wall-inset': 3,
    corner: 2,
    center: 1,
});
const RULE_NAMES = Object.freeze({
    entrance: '入口纵深',
    'wall-inset': '主墙构图',
    corner: '角部广角',
    center: '空间中心',
});

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function point(value) {
    return {
        x: finite(Array.isArray(value) ? value[0] : value?.x),
        y: finite(Array.isArray(value) ? value[1] : value?.y),
    };
}

function polygonArea(polygon) {
    let twiceArea = 0;
    for (let index = 0; index < polygon.length; index += 1) {
        const current = point(polygon[index]);
        const next = point(polygon[(index + 1) % polygon.length]);
        twiceArea += current.x * next.y - next.x * current.y;
    }
    return Math.abs(twiceArea) / 2;
}

function polygonCentroid(polygon) {
    let crossSum = 0;
    let xSum = 0;
    let ySum = 0;
    for (let index = 0; index < polygon.length; index += 1) {
        const current = point(polygon[index]);
        const next = point(polygon[(index + 1) % polygon.length]);
        const cross = current.x * next.y - next.x * current.y;
        crossSum += cross;
        xSum += (current.x + next.x) * cross;
        ySum += (current.y + next.y) * cross;
    }
    if (Math.abs(crossSum) > 1e-8) {
        return { x: xSum / (3 * crossSum), y: ySum / (3 * crossSum) };
    }
    const points = polygon.map(point);
    return {
        x: points.reduce((sum, item) => sum + item.x, 0) / Math.max(1, points.length),
        y: points.reduce((sum, item) => sum + item.y, 0) / Math.max(1, points.length),
    };
}

function polygonIsConcave(polygon) {
    let sign = 0;
    for (let index = 0; index < polygon.length; index += 1) {
        const a = point(polygon[index]);
        const b = point(polygon[(index + 1) % polygon.length]);
        const c = point(polygon[(index + 2) % polygon.length]);
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-8) continue;
        const nextSign = Math.sign(cross);
        if (sign && nextSign !== sign) return true;
        sign = nextSign;
    }
    return false;
}

function normalizeDirection(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
}

function yawTo(from, to) {
    const yaw = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    return yaw < 0 ? yaw + 360 : yaw;
}

function circularYawDifference(a, b) {
    const distance = Math.abs(a - b) % 360;
    return Math.min(distance, 360 - distance);
}

function extractAnchor(record) {
    for (const candidate of [record?.center, record?.Center, record?.basePoint, record?.BasePoint]) {
        if (Array.isArray(candidate) && candidate.length >= 2) return point(candidate);
        if (candidate && Number.isFinite(Number(candidate.x ?? candidate.X))) {
            return { x: finite(candidate.x ?? candidate.X), y: finite(candidate.y ?? candidate.Y) };
        }
        if (typeof candidate === 'string') {
            const x = /X\s*=\s*(-?[\d.]+)/i.exec(candidate);
            const y = /Y\s*=\s*(-?[\d.]+)/i.exec(candidate);
            if (x && y) return { x: Number(x[1]), y: Number(y[1]) };
        }
    }
    const basePoints = record?.base_points ?? record?.BasePoints;
    if (Array.isArray(basePoints) && basePoints.length) {
        const points = basePoints.map(point);
        return {
            x: points.reduce((sum, item) => sum + item.x, 0) / points.length,
            y: points.reduce((sum, item) => sum + item.y, 0) / points.length,
        };
    }
    return null;
}

function anchorsFrom(doorWindows, keys) {
    return keys.flatMap(key => Array.isArray(doorWindows?.[key]) ? doorWindows[key] : [])
        .map(extractAnchor)
        .filter(Boolean);
}

function analyzeRoom(polygon, roomInfo = {}) {
    const points = polygon.map(point);
    const xs = points.map(item => item.x);
    const ys = points.map(item => item.y);
    const bounds = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
    };
    const walls = points.map((start, index) => {
        const end = points[(index + 1) % points.length];
        return {
            index,
            start,
            end,
            midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
            length: Math.hypot(end.x - start.x, end.y - start.y),
        };
    }).sort((a, b) => b.length - a.length || a.index - b.index);
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxY - bounds.minY;
    return {
        polygon,
        points,
        area: polygonArea(polygon),
        centroid: polygonCentroid(polygon),
        bounds,
        width,
        depth,
        aspect: Math.max(width, depth) / Math.max(1, Math.min(width, depth)),
        concave: polygonIsConcave(polygon),
        longestWall: walls[0],
        walls,
        roomInfo,
    };
}

function roomCandidateLimit(analysis) {
    if (analysis.concave || analysis.area >= 25_000_000 || analysis.aspect >= 2) return 4;
    if (analysis.area < 9_000_000) return 2;
    return 3;
}

function withinExpandedBounds(anchor, bounds, margin = 300) {
    return anchor.x >= bounds.minX - margin && anchor.x <= bounds.maxX + margin
        && anchor.y >= bounds.minY - margin && anchor.y <= bounds.maxY + margin;
}

function enumerateStations(analysis, doorAnchors) {
    const { centroid } = analysis;
    const inset = Math.min(900, Math.max(450, Math.min(analysis.width, analysis.depth) * 0.22));
    const stations = [];

    for (const anchor of doorAnchors.filter(item => withinExpandedBounds(item, analysis.bounds))) {
        const direction = normalizeDirection(anchor, centroid);
        stations.push({
            x: anchor.x + direction.x * inset,
            y: anchor.y + direction.y * inset,
            target: centroid,
            rule: 'entrance',
        });
    }

    for (const wall of analysis.walls) {
        const direction = normalizeDirection(wall.midpoint, centroid);
        stations.push({
            x: wall.midpoint.x + direction.x * inset,
            y: wall.midpoint.y + direction.y * inset,
            target: centroid,
            rule: 'wall-inset',
            wall,
        });
    }

    for (const corner of analysis.points) {
        const direction = normalizeDirection(corner, centroid);
        stations.push({
            x: corner.x + direction.x * inset,
            y: corner.y + direction.y * inset,
            target: centroid,
            rule: 'corner',
        });
    }

    stations.push({
        x: centroid.x,
        y: centroid.y,
        target: analysis.longestWall?.midpoint ?? centroid,
        rule: 'center',
    });
    return stations;
}

function scoreCandidate(candidate, analysis, windowAnchors) {
    const ruleScore = { entrance: 100, 'wall-inset': 88, corner: 78, center: 72 }[candidate.rule] ?? 0;
    const centerDistance = Math.hypot(candidate.x - analysis.centroid.x, candidate.y - analysis.centroid.y);
    const roomScale = Math.max(1, Math.hypot(analysis.width, analysis.depth));
    const depthScore = Math.min(12, centerDistance / roomScale * 18);
    const daylightScore = windowAnchors.length
        ? Math.max(0, 6 - Math.min(...windowAnchors.map(anchor => circularYawDifference(
            candidate.yaw,
            yawTo(candidate, anchor),
        ))) / 30)
        : 0;
    return Math.round((ruleScore + depthScore + daylightScore) * 1000) / 1000;
}

function dedupeCandidates(candidates) {
    const kept = [];
    for (const candidate of candidates) {
        const duplicate = kept.some(existing => (
            Math.hypot(candidate.x - existing.x, candidate.y - existing.y) < 350
            && circularYawDifference(candidate.yaw, existing.yaw) < 20
        ));
        if (!duplicate) kept.push(candidate);
    }
    return kept;
}

function failureReason(failures) {
    return [...failures.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
        ?? 'NO_VALID_STATION';
}

export function generateAiViewCandidates({
    context = {},
    rooms = {},
    doorWindows = {},
    obstacles = null,
    validator = validatePanoramaPoint,
    cameraHeight = DEFAULT_CAMERA_HEIGHT,
} = {}) {
    const roomPoints = Array.isArray(rooms.roomPoints) ? rooms.roomPoints : [];
    const roomNames = Array.isArray(rooms.roomNames) ? rooms.roomNames : [];
    const roomInfo = Array.isArray(rooms.roomInfo) ? rooms.roomInfo : [];
    const doorAnchors = anchorsFrom(doorWindows, ['doors', 'processed_doors']);
    const windowAnchors = anchorsFrom(doorWindows, ['windows', 'processed_windows']);
    const candidates = [];
    const roomResults = [];

    roomPoints.forEach((polygon, roomIndex) => {
        const roomName = String(roomNames[roomIndex] ?? roomInfo[roomIndex]?.name ?? `房间 ${roomIndex + 1}`);
        const roomId = String(roomInfo[roomIndex]?.id ?? roomInfo[roomIndex]?.roomId ?? `room-${roomIndex}`);
        const roomType = classifyAiRoom(roomName);
        if (!Array.isArray(polygon) || polygon.length < 3) {
            roomResults.push({ roomIndex, roomId, roomName, status: 'empty', reason: 'INVALID_POLYGON', degraded: obstacles == null });
            return;
        }

        const analysis = analyzeRoom(polygon, roomInfo[roomIndex]);
        const failures = new Map();
        const roomCandidates = [];
        for (const station of enumerateStations(analysis, doorAnchors)) {
            const candidatePoint = { x: station.x, y: station.y, z: finite(cameraHeight, DEFAULT_CAMERA_HEIGHT) };
            const validation = validator(candidatePoint, {
                roomPoints,
                roomNames,
                obstacles,
                minWallDistance: 80,
                cameraRadius: 80,
            });
            if (!validation?.valid || validation.roomIndex !== roomIndex) {
                const code = validation?.valid ? 'OUTSIDE_ROOM' : String(validation?.code ?? 'INVALID');
                failures.set(code, (failures.get(code) ?? 0) + 1);
                continue;
            }

            const target = station.rule === 'center' && windowAnchors.length
                ? windowAnchors.reduce((nearest, anchor) => (
                    Math.hypot(anchor.x - station.x, anchor.y - station.y)
                        < Math.hypot(nearest.x - station.x, nearest.y - station.y)
                        ? anchor : nearest
                ), windowAnchors[0])
                : station.target;
            const raw = {
                planId: context.planId,
                planVersion: context.version,
                roomId,
                roomIndex,
                roomName,
                roomType,
                name: RULE_NAMES[station.rule] ?? '候选视角',
                x: candidatePoint.x,
                y: candidatePoint.y,
                z: candidatePoint.z,
                yaw: yawTo(candidatePoint, target),
                pitch: 0,
                fov: analysis.aspect >= 1.8 ? 90 : DEFAULT_HORIZONTAL_FOV,
                source: 'auto',
                status: 'available',
                selected: false,
                generationReason: station.rule,
                valid: true,
                invalidReason: null,
                validationMode: validation.degraded ? 'degraded' : 'full',
                rule: station.rule,
            };
            raw.score = scoreCandidate(raw, analysis, windowAnchors);
            roomCandidates.push(normalizeAiView(raw, context));
        }

        roomCandidates.sort((a, b) => (
            b.score - a.score
            || (RULE_PRIORITY[b.generationReason] ?? 0) - (RULE_PRIORITY[a.generationReason] ?? 0)
            || a.y - b.y
            || a.x - b.x
            || a.yaw - b.yaw
        ));
        const selected = dedupeCandidates(roomCandidates).slice(0, roomCandidateLimit(analysis));
        if (roomType === 'primary' && selected.length) selected[0] = { ...selected[0], selected: true };
        candidates.push(...selected);
        roomResults.push({
            roomIndex,
            roomId,
            roomName,
            status: selected.length ? 'ready' : 'empty',
            reason: selected.length ? null : failureReason(failures),
            degraded: obstacles == null,
        });
    });

    return { candidates, roomResults };
}
