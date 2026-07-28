export function decideRoomPanelAction(activeRoomIndex, panelVisible, clickedRoomIndex) {
    if (clickedRoomIndex == null || (panelVisible && activeRoomIndex === clickedRoomIndex)) {
        return { action: 'hide', roomIndex: null };
    }
    return { action: 'show', roomIndex: clickedRoomIndex };
}

export function findContentModelRoot(object) {
    let current = object;
    while (current) {
        if ((current.userData?.contentModelRoot === true ||
            current.userData?.type === 'parametric-softlist') && current.userData?.debugInfo) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

export function classifySceneClick(object) {
    const modelRoot = findContentModelRoot(object);
    if (modelRoot) return { kind: 'model', modelRoot };

    if (object?.userData?.type === 'floor' || object?.userData?.type === 'roomLabel') {
        return {
            kind: 'room',
            roomIndex: object.userData.roomIndex ?? null,
            roomInfo: object.userData.roomInfo ?? null,
        };
    }
    return { kind: 'none' };
}

function isVisibleInHierarchy(object) {
    let current = object;
    while (current) {
        if (current.visible === false) return false;
        current = current.parent;
    }
    return true;
}

export function isSceneRaycastTarget(object) {
    if (!object || !isVisibleInHierarchy(object)) return false;
    const type = object.userData?.type;
    if (type === 'floor' || type === 'roomLabel') return true;
    if (!object.isMesh) return false;
    const root = findContentModelRoot(object);
    return root?.userData?.contentModelRoot === true;
}

export function isSceneDebugEnabled(hash) {
    return hash === '#debug';
}

function sanitizeDebugString(value) {
    return value
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/parameterizedJsonUrl/gi, '[redacted-parametric-field]')
        .replace(/webV2Url/gi, '[redacted-static-field]')
        .replace(/sourceUrl/gi, '[redacted-source-field]')
        .replace(/http/gi, '[redacted-protocol]');
}

function sanitizeDebugValue(value) {
    if (typeof value === 'string') return sanitizeDebugString(value);
    if (!value || typeof value !== 'object') return value;

    const clone = Array.isArray(value) ? [] : {};
    let changed = false;
    for (const [key, child] of Object.entries(value)) {
        const safeKey = sanitizeDebugString(key);
        const safeChild = sanitizeDebugValue(child);
        if (safeKey !== key || safeChild !== child) changed = true;
        let uniqueKey = safeKey;
        let suffix = 2;
        while (Object.prototype.hasOwnProperty.call(clone, uniqueKey)) {
            uniqueKey = `${safeKey}#${suffix}`;
            suffix += 1;
        }
        Object.defineProperty(clone, uniqueKey, {
            value: safeChild,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return changed ? clone : value;
}

export function logContentModelDebug(root, hash, logger = console) {
    if (!isSceneDebugEnabled(hash) || !root?.userData?.debugInfo) return false;

    const info = sanitizeDebugValue(root.userData.debugInfo);
    logger.groupCollapsed(
        `[ContentModel debug] TypeId=${info.typeId ?? 'unknown'} instance=${info.instanceId ?? info.softlistId ?? 'unknown'}`,
    );
    logger.log('模型信息', info);
    logger.groupEnd();
    return true;
}

export const findParametricSoftlistRoot = findContentModelRoot;
export const logParametricSoftlistDebug = logContentModelDebug;
