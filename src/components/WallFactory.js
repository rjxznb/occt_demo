import * as THREE from 'three';

/**
 * 墙面工厂类 - 负责创建各种类型的墙面
 */
export class WallFactory {
// 创建矩形几何体，包含更多细分点
static createStraightWall(startPoint, endPoint, options = {}) {
    const {
        color = 0xffffff,
        height = 10,
        opacity = 1.0,
        subdivisions = 8 // 添加细分参数
    } = options;

    // 验证输入参数
    if (!this.validatePoints([startPoint, endPoint])) {
        console.error('墙面创建失败：无效的点坐标');
        return null;
    }

    // 创建细分后的顶点
    const vertices = [];
    const indices = [];
    
    // 计算底部和顶部的细分点
    const bottomVertices = [];
    const topVertices = [];
    
    // 生成细分点（包括端点）
    for (let i = 0; i <= subdivisions + 1; i++) {
        const t = i / (subdivisions + 1);
        
        // 底部点
        const bottomX = startPoint[0] + t * (endPoint[0] - startPoint[0]);
        const bottomY = startPoint[1] + t * (endPoint[1] - startPoint[1]);
        const bottomZ = startPoint[2];
        bottomVertices.push([bottomX, bottomY, bottomZ]);
        
        // 顶部点
        const topX = bottomX;
        const topY = bottomY;
        const topZ = bottomZ + height;
        topVertices.push([topX, topY, topZ]);
    }
    
    // 添加所有顶点到数组
    bottomVertices.forEach(vertex => vertices.push(...vertex));
    topVertices.forEach(vertex => vertices.push(...vertex));
    
    const bottomVertexCount = bottomVertices.length;
    
    // 创建面索引（三角形）
    for (let i = 0; i < subdivisions + 1; i++) {
        const bottomLeft = i;
        const bottomRight = i + 1;
        const topLeft = bottomVertexCount + i;
        const topRight = bottomVertexCount + i + 1;
        
        // 每个四边形分割成两个三角形
        indices.push(
            bottomLeft, bottomRight, topRight,  // 第一个三角形
            bottomLeft, topRight, topLeft       // 第二个三角形
        );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    
    // 生成对应的UV坐标
    const uvs = [];
    
    // 底部UV坐标
    for (let i = 0; i < bottomVertexCount; i++) {
        const u = i / (bottomVertexCount - 1);
        uvs.push(u, 0);
    }
    
    // 顶部UV坐标
    for (let i = 0; i < bottomVertexCount; i++) {
        const u = i / (bottomVertexCount - 1);
        uvs.push(u, 1);
    }
    
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: opacity < 1.0,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.wallType = 'straight';
    mesh.userData.subdivisions = subdivisions;
    mesh.renderOrder = 1;
    
    return mesh;
}
/**
 * 创建弧形墙面（由多个点组成的连续墙面，每段之间添加细分点）
 * @param {Array} points - 点数组，每个点为 [x, y, z]
 * @param {Object} options - 配置选项
 * @returns {THREE.Mesh} 弧形墙面mesh对象
 */
static createArcWall(points, options = {}) {
    const {
        color = 0xffffff,
        height = 10,
        opacity = 1.0,
        subdivisions = 8 // 添加细分参数
    } = options;

    if (!points || points.length < 2) {
        console.error('弧形墙创建失败：至少需要2个点');
        return null;
    }

    // 标准化点格式
    const normalizedPoints = points.map(p => {
        if (Array.isArray(p) && p.length >= 2) {
            return [p[0], p[1], p[2] || 0];
        }
        console.error('无效的点格式:', p);
        return [0, 0, 0];
    });

    const vertices = [];
    const indices = [];

    // 创建细分后的底部和顶部顶点
    const bottomVertices = [];
    const topVertices = [];

    // 对每一段进行细分处理
    for (let i = 0; i < normalizedPoints.length - 1; i++) {
        const startPoint = normalizedPoints[i];
        const endPoint = normalizedPoints[i + 1];
        
        // 生成细分点（包括起点，但不包括终点，避免重复）
        for (let j = 0; j <= subdivisions; j++) {
            const t = j / subdivisions;
            
            // 线性插值计算中间点（实际应用中可能需要真正的弧形插值）
            const x = startPoint[0] + t * (endPoint[0] - startPoint[0]);
            const y = startPoint[1] + t * (endPoint[1] - startPoint[1]);
            const z = startPoint[2] + t * (endPoint[2] - startPoint[2]);
            
            bottomVertices.push([x, y, z]);
            
            // 顶部点
            topVertices.push([x, y, z + height]);
        }
    }

    // 添加所有顶点到数组
    bottomVertices.forEach(vertex => vertices.push(...vertex));
    topVertices.forEach(vertex => vertices.push(...vertex));

    const bottomVertexCount = bottomVertices.length;
    const segmentVertexCount = subdivisions + 1; // 每段的顶点数

    // 创建面索引
    for (let i = 0; i < bottomVertexCount - 1; i++) {
        // 避免在段与段之间创建面
        if ((i + 1) % segmentVertexCount === 0) {
            continue;
        }
        
        const bottomLeft = i;
        const bottomRight = i + 1;
        const topLeft = bottomVertexCount + i;
        const topRight = bottomVertexCount + i + 1;

        indices.push(
            bottomLeft, bottomRight, topRight,
            bottomLeft, topRight, topLeft
        );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    
    // 生成正确的UV坐标
    const uvs = [];
    
    // 计算每个顶点的U坐标
    for (let i = 0; i < bottomVertexCount; i++) {
        const segmentIndex = Math.floor(i / segmentVertexCount);
        const localIndex = i % segmentVertexCount;
        const u = localIndex / subdivisions;
        uvs.push(u, 0);
    }
    
    // 顶部UV坐标
    for (let i = 0; i < bottomVertexCount; i++) {
        const segmentIndex = Math.floor(i / segmentVertexCount);
        const localIndex = i % segmentVertexCount;
        const u = localIndex / subdivisions;
        uvs.push(u, 1);
    }
    
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: opacity < 1.0,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.wallType = 'arc';
    mesh.userData.segmentCount = normalizedPoints.length - 1;
    mesh.userData.subdivisions = subdivisions;
    mesh.renderOrder = 1;
    
    return mesh;
    }
    /**
     * 验证点坐标的有效性
     * @param {Array} points - 点数组
     * @returns {boolean} 是否有效
     */
    static validatePoints(points) {
        if (!Array.isArray(points)) return false;

        return points.every(point => {
            if (!Array.isArray(point) || point.length < 2) return false;
            return point.slice(0, 3).every(coord => !isNaN(coord));
        });
    }

    /**
     * 分析房间边界点，区分直线段和弧形段
     * @param {Array} roomPoints - 房间边界点数组，格式：[x, y, z, bulge]
     * @returns {Array} 墙面段数组
     */
    static analyzeWallSegments(roomPoints) {
        const segments = [];
        let i = 0;

        while (i < roomPoints.length) {
            const currentPoint = roomPoints[i];

            if (!Array.isArray(currentPoint) || currentPoint.length < 4) {
                console.error(`点 ${i} 数据格式错误:`, currentPoint);
                i++;
                continue;
            }

            const bulge = currentPoint[3];

            if (Math.abs(bulge) > 0.001) {
                // 弧形段：收集所有连续的弧形点
                const arcPoints = [currentPoint];
                let j = i + 1;

                while (j < roomPoints.length) {
                    const nextPoint = roomPoints[j];
                    if (!Array.isArray(nextPoint) || nextPoint.length < 4) break;
                    
                    arcPoints.push(nextPoint);
                    
                    if (Math.abs(nextPoint[3]) <= 0.001) break;
                    j++;
                }

                segments.push({
                    type: 'arc',
                    points: arcPoints.map(point => [point[0], point[1], point[2] || 0]),
                    startIndex: i,
                    endIndex: j
                });

                i = j;
            } else {
                // 直线段
                const nextIndex = (i + 1) % roomPoints.length;
                const nextPoint = roomPoints[nextIndex];

                if (Array.isArray(nextPoint) && nextPoint.length >= 2) {
                    segments.push({
                        type: 'straight',
                        startPoint: [currentPoint[0], currentPoint[1], currentPoint[2] || 0],
                        endPoint: [nextPoint[0], nextPoint[1], nextPoint[2] || 0],
                        startIndex: i,
                        endIndex: nextIndex
                    });
                }

                i++;
            }
        }

        return segments;
    }
}