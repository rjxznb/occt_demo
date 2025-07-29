import * as THREE from 'three';

// 创建单个墙面（优化版createFace）
export function createSingleWallFace(points, color=0xff6600, height=240) {
    // 输入验证
    if (!points || points.length !== 2) {
        console.error("createSingleWallFace需要包含两个点的数组");
        return null;
    }
    
    const p1 = points[0];
    const p2 = points[1];
    
    // 验证点数据
    if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 3 || p2.length < 3) {
        console.error("点数据格式错误，需要[x,y,z]格式:", p1, p2);
        return null;
    }
    
    // 验证坐标值
    for (let i = 0; i < 3; i++) {
        if (isNaN(p1[i]) || isNaN(p2[i])) {
            console.error("点包含无效的坐标值:", p1, p2);
            return null;
        }
    }
    
    // 创建矩形的四个顶点（线段向上拉伸形成矩形）
    const vertices = [
        // 底边两个点
        p1[0], p1[1], p1[2],           // 顶点0: 起点
        p2[0], p2[1], p2[2],           // 顶点1: 终点
        // 顶边两个点（向上拉伸height）
        p2[0], p2[1], p2[2] + height,  // 顶点2: 终点上方
        p1[0], p1[1], p1[2] + height   // 顶点3: 起点上方
    ];
    
    // 定义两个三角形组成矩形面
    const indices = [
        0, 1, 2,  // 第一个三角形
        0, 2, 3   // 第二个三角形
    ];
    
    // 创建BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    
    // 创建材质
    const material = new THREE.MeshLambertMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });
    
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
}


// 根据点数组创建围墙（相邻点连线并向上拉伸）
export function createWallsFromPoints(points, color=0x00ff00, height=240, closed=false) {
    if (points.length < 2) {
        console.error("至少需要2个点来创建墙体");
        return null;
    }
    
    const wallGroup = new THREE.Group();
    const segmentCount = closed ? points.length : points.length - 1;
    
    // 为每个线段创建一个墙面
    for (let i = 0; i < segmentCount; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length]; // 闭合时最后一个点连接第一个点
        
        // 确保点格式正确（添加z坐标如果缺失）
        const point1 = p1.length === 2 ? [p1[0], p1[1], 0] : p1;
        const point2 = p2.length === 2 ? [p2[0], p2[1], 0] : p2;
        
        // 创建单个墙面
        const wallFace = createSingleWallFace([point1, point2], color, height);
        
        if (wallFace) {
            wallGroup.add(wallFace);
        }
    }
    
    return wallGroup;
}