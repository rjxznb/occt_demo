export function decideRoomPanelAction(activeRoomIndex, panelVisible, clickedRoomIndex) {
    if (clickedRoomIndex == null || (panelVisible && activeRoomIndex === clickedRoomIndex)) {
        return { action: 'hide', roomIndex: null };
    }
    return { action: 'show', roomIndex: clickedRoomIndex };
}

export function findParametricSoftlistRoot(object) {
    let current = object;
    while (current) {
        if (current.userData?.type === 'parametric-softlist' && current.userData?.debugInfo) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

export function classifySceneClick(object) {
    const modelRoot = findParametricSoftlistRoot(object);
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

export function isSceneDebugEnabled(hash) {
    return hash === '#debug';
}

export function logParametricSoftlistDebug(root, hash, logger = console) {
    if (!isSceneDebugEnabled(hash) || !root?.userData?.debugInfo) return false;

    const info = root.userData.debugInfo;
    logger.groupCollapsed(
        `[软装调试] TypeId=${info.typeId ?? 'unknown'} 实例=${info.softlistId ?? 'unknown'}`,
    );
    logger.log('模型信息', info);
    logger.groupEnd();
    return true;
}
