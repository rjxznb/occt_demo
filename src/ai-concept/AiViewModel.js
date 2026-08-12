const SOURCES = new Set(['auto', 'custom']);
const STATUSES = new Set(['available', 'adjusted', 'excluded', 'disabled']);
const SECONDARY_ROOM_PATTERN = /卫生间|卫浴|客卫|主卫|过道|走廊|玄关|阳台|露台|储物|设备/;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeYaw(value) {
    const yaw = finite(value, 0) % 360;
    return yaw < 0 ? yaw + 360 : yaw;
}

function quantize(value) {
    return Math.round(finite(value, 0) * 100) / 100;
}

function fingerprint(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function classifyAiRoom(roomName) {
    return SECONDARY_ROOM_PATTERN.test(String(roomName ?? '')) ? 'secondary' : 'primary';
}

export function createAiViewId({
    planId = '', version = '', roomId = '', rule = 'candidate',
    x = 0, y = 0, z = 1500, yaw = 0,
} = {}) {
    const key = [
        String(planId), String(version), String(roomId), String(rule),
        quantize(x), quantize(y), quantize(z), quantize(normalizeYaw(yaw)),
    ].join('|');
    return `ai-view:${fingerprint(key)}`;
}

export function normalizeAiView(candidate = {}, context = {}) {
    const roomIndex = Math.trunc(finite(candidate.roomIndex, -1));
    const roomId = String(candidate.roomId ?? `room-${roomIndex}`);
    const planId = String(candidate.planId ?? context.planId ?? '');
    const planVersion = String(candidate.planVersion ?? candidate.version ?? context.version ?? '');
    const source = SOURCES.has(candidate.source) ? candidate.source : 'auto';
    const status = STATUSES.has(candidate.status) ? candidate.status : 'available';
    const normalized = {
        id: String(candidate.id ?? ''),
        planId,
        planVersion,
        roomId,
        roomIndex,
        roomName: String(candidate.roomName ?? ''),
        roomType: String(candidate.roomType ?? classifyAiRoom(candidate.roomName)),
        name: String(candidate.name ?? candidate.viewName ?? '候选视角'),
        x: finite(candidate.x),
        y: finite(candidate.y),
        z: finite(candidate.z, 1500),
        yaw: normalizeYaw(candidate.yaw),
        pitch: clamp(finite(candidate.pitch), -89, 89),
        fov: clamp(finite(candidate.fov, 86), 55, 100),
        source,
        status,
        selected: Boolean(candidate.selected) && !['excluded', 'disabled'].includes(status),
        generationReason: String(candidate.generationReason ?? candidate.rule ?? ''),
        score: finite(candidate.score),
        valid: candidate.valid !== false,
        invalidReason: candidate.invalidReason == null ? null : String(candidate.invalidReason),
        validationMode: String(candidate.validationMode ?? 'full'),
        taskIds: Array.isArray(candidate.taskIds) ? candidate.taskIds.map(String) : [],
        resultIds: Array.isArray(candidate.resultIds) ? candidate.resultIds.map(String) : [],
        createdAt: String(candidate.createdAt ?? ''),
        updatedAt: String(candidate.updatedAt ?? ''),
    };
    normalized.id ||= createAiViewId({
        ...normalized,
        version: planVersion,
        rule: normalized.generationReason || source,
    });
    return normalized;
}
