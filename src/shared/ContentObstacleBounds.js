import * as THREE from 'three';

export function collectContentObstacleBounds(sceneGroup) {
    if (!sceneGroup?.traverse) return null;
    const obstacles = [];
    sceneGroup.updateMatrixWorld?.(true);
    sceneGroup.traverse(object => {
        if (object?.userData?.contentModelRoot !== true) return;
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        obstacles.push({
            id: String(
                object.userData.instanceId
                ?? object.userData.sourceIndex
                ?? object.uuid
                ?? obstacles.length,
            ),
            minX: box.min.x,
            minY: box.min.y,
            minZ: box.min.z,
            maxX: box.max.x,
            maxY: box.max.y,
            maxZ: box.max.z,
        });
    });
    return obstacles;
}
