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


// 根据点数组创建整体弧形墙面（作为一个单一mesh）
export function createWallsFromPoints(points, color=0x00ff00, height=240, closed=false) {
    if (points.length < 2) {
        console.error("至少需要2个点来创建墙体");
        return null;
    }
    
    console.log(`创建整体弧形墙面，点数: ${points.length}, 高度: ${height}`);
    
    // 确保所有点都有正确的格式
    const normalizedPoints = points.map(p => {
        if (p.length === 2) {
            return [p[0], p[1], 0];
        } else if (p.length >= 3) {
            return [p[0], p[1], p[2]];
        } else {
            console.error("点格式错误:", p);
            return [0, 0, 0];
        }
    });
    
    // 创建顶点数组和索引数组
    const vertices = [];
    const indices = [];
    
    const segmentCount = closed ? points.length : points.length - 1;
    
    // 先创建所有底部和顶部顶点（共享相邻线段的端点）
    const bottomVertices = [];
    const topVertices = [];
    
    for (let i = 0; i <= segmentCount; i++) {
        const pointIndex = i % normalizedPoints.length;
        const point = normalizedPoints[pointIndex];
        
        // 底部顶点
        bottomVertices.push([point[0], point[1], point[2]]);
        // 顶部顶点
        topVertices.push([point[0], point[1], point[2] + height]);
    }
    
    // 将所有顶点添加到vertices数组：先所有底部顶点，再所有顶部顶点
    bottomVertices.forEach(vertex => vertices.push(...vertex));
    topVertices.forEach(vertex => vertices.push(...vertex));
    
    const bottomVertexCount = bottomVertices.length;
    
    // 为每个线段创建面索引
    for (let i = 0; i < segmentCount; i++) {
        const bottomLeft = i;                    // 底部左点索引
        const bottomRight = i + 1;               // 底部右点索引
        const topLeft = bottomVertexCount + i;   // 顶部左点索引
        const topRight = bottomVertexCount + i + 1; // 顶部右点索引
        
        // 创建两个三角形组成矩形面（注意顶点顺序，确保正确的法向量）
        indices.push(
            bottomLeft, bottomRight, topRight,  // 第一个三角形
            bottomLeft, topRight, topLeft       // 第二个三角形
        );
    }
    
    console.log(`生成顶点数量: ${vertices.length / 3}, 三角形数量: ${indices.length / 3}`);
    
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
    
    // 创建单一的mesh对象
    const mesh = new THREE.Mesh(geometry, material);
    
    console.log('整体弧形墙面创建完成');
    
    return mesh;
}