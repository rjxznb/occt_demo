import * as THREE from 'three';

/**
 * 门窗工厂类 - 负责创建门窗的3D模型
 */
export class FloorFactory {
/**
     * 创建地板meshes（用于CSG布尔运算）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @returns {Array} 地板mesh数组
     */
    static createFloorMeshes(roomPointsArray, height) {
        const FloorMeshes = [];

        roomPointsArray.forEach((roomPoints, index) => {
            try {
                const convertedPoints = roomPoints.map(point => {
                    if (Array.isArray(point) && point.length >= 2) {
                        return { x: point[0], y: point[1], z: point[2] || 0 };
                    }
                    return { x: 0, y: 0, z: 0 };
                });

                const shape = new THREE.Shape();
                const firstPoint = convertedPoints[0];
                shape.moveTo(firstPoint.x, firstPoint.y);

                for (let i = 1; i < convertedPoints.length; i++) {
                    const point = convertedPoints[i];
                    shape.lineTo(point.x, point.y);
                }

                shape.lineTo(firstPoint.x, firstPoint.y);

                const extrudeSettings = {
                                    steps: 1,
                                    depth: height,  // 设置为200mm厚度
                                    bevelEnabled: false
                                };
                
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geometry.computeVertexNormals();

                // 使用红色材质用于CSG运算（与旧版本保持一致）
                const material = new THREE.MeshLambertMaterial({
                    color: 0xffffff,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor:-1,
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.roomIndex = index;
                FloorMeshes.push(mesh);

            } catch (error) {
                console.error(`地板 ${index} 创建失败:`, error);
            }
        });

        return FloorMeshes;
    }
}

export default FloorFactory;