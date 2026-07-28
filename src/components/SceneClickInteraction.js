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

export function logContentModelDebug(root, hash, logger = console) {
    if (!isSceneDebugEnabled(hash) || !root?.userData?.debugInfo) return false;

    const info = root.userData.debugInfo;
    logger.groupCollapsed(
        `[ContentModel debug] TypeId=${info.typeId ?? 'unknown'} instance=${info.instanceId ?? info.softlistId ?? 'unknown'}`,
    );
    logger.log('模型信息', info);
    logger.groupEnd();
    return true;
}

export const findParametricSoftlistRoot = findContentModelRoot;
export const logParametricSoftlistDebug = logContentModelDebug;
