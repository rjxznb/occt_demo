import * as THREE from 'three';

/**
 * 墙面点击选择器
 * 提供墙面点击检测和蓝色轮廓高亮功能
 */
export class WallClickSelector {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Raycaster相关
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // 墙面管理
        this.wallMeshes = []; // 存储所有可点击的墙面mesh
        this.selectedWallMesh = null; // 当前选中的墙面
        this.highlightEdges = null; // 高亮边缘线
        
        // 绑定鼠标事件
        this.bindEvents();
    }
    
    /**
     * 绑定鼠标事件
     */
    bindEvents() {
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.addEventListener('click', this.onWallClick.bind(this));
        }
    }
    
    /**
     * 添加墙面到可选择列表
     * @param {THREE.Mesh} wallMesh - 墙面mesh对象
     */
    addWallMesh(wallMesh) {
        if (wallMesh && !this.wallMeshes.includes(wallMesh)) {
            this.wallMeshes.push(wallMesh);
        }
    }
    
    /**
     * 批量添加墙面
     * @param {Array<THREE.Mesh>} wallMeshes - 墙面mesh数组
     */
    addWallMeshes(wallMeshes) {
        if (Array.isArray(wallMeshes)) {
            wallMeshes.forEach(mesh => this.addWallMesh(mesh));
        }
    }
    
    /**
     * 创建墙面轮廓高亮（使用EdgesGeometry方法）
     * @param {THREE.Mesh} wallMesh - 墙面mesh对象
     * @returns {THREE.Group} 轮廓线条组对象
     */
    createWallEdgeHighlight(wallMesh) {
        console.log('开始创建墙面轮廓高亮:', wallMesh);
        
        // 使用Three.js的EdgesGeometry自动计算边缘
        const edgesGeometry = new THREE.EdgesGeometry(wallMesh.geometry);
        
        console.log('EdgesGeometry边缘数量:', edgesGeometry.attributes.position.count / 2);
        
        // 创建多条线段来加粗效果
        const lineGroup = new THREE.Group();
        
        // 创建多个轮廓线条来模拟加粗效果，使用不同的偏移
        const offsets = [
            { x: 0, y: 0, z: 0.3 },      // 主线条
            { x: 0.1, y: 0, z: 0.35 },   // 右偏移
            { x: -0.1, y: 0, z: 0.35 },  // 左偏移
            { x: 0, y: 0.1, z: 0.35 },   // 上偏移
            { x: 0, y: -0.1, z: 0.35 },  // 下偏移
            { x: 0.05, y: 0.05, z: 0.32 }, // 右上偏移
            { x: -0.05, y: 0.05, z: 0.32 }, // 左上偏移
            { x: 0.05, y: -0.05, z: 0.32 }, // 右下偏移
            { x: -0.05, y: -0.05, z: 0.32 }  // 左下偏移
        ];
        
        offsets.forEach((offset, index) => {
            // 克隆EdgesGeometry并应用偏移
            const offsetGeometry = edgesGeometry.clone();
            const positions = offsetGeometry.attributes.position.array;
            
            // 对所有顶点应用偏移
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += offset.x;     // X偏移
                positions[i + 1] += offset.y; // Y偏移
                positions[i + 2] += offset.z; // Z偏移
            }
            
            // 更新几何体
            offsetGeometry.attributes.position.needsUpdate = true;
            
            // 创建线条材质
            const edgeMaterial = new THREE.LineBasicMaterial({ 
                color: 0x0000ff, // 蓝色
                transparent: true,
                opacity: index === 0 ? 1.0 : 0.4, // 主线条不透明，其他半透明
                depthTest: false, // 禁用深度测试，确保显示在最前面
                depthWrite: false,
                linewidth: index === 0 ? 4 : 2
            });
            
            // 创建线段对象
            const edgeLine = new THREE.LineSegments(offsetGeometry, edgeMaterial);
            edgeLine.renderOrder = 1000 + index; // 设置高渲染优先级
            
            lineGroup.add(edgeLine);
        });
        
        // 复制墙面的变换
        lineGroup.position.copy(wallMesh.position);
        lineGroup.rotation.copy(wallMesh.rotation);
        lineGroup.scale.copy(wallMesh.scale);
        
        console.log('墙面轮廓高亮创建完成');
        
        return lineGroup;
    }
    
    /**
     * 创建弧形墙group的整体高亮
     * @param {THREE.Group} arcWallGroup - 弧形墙group对象
     * @returns {THREE.Group} 整体高亮线条组对象
     */
    createArcWallGroupHighlight(arcWallGroup) {
        console.log('开始创建弧形墙group整体高亮:', arcWallGroup);
        
        const highlightGroup = new THREE.Group();
        
        // 为弧形墙group中的每个子墙面创建高亮
        arcWallGroup.children.forEach((childWall, index) => {
            if (childWall.geometry) {
                console.log(`为弧形墙子墙面 ${index} 创建高亮`);
                
                // 使用EdgesGeometry为每个子墙面创建边缘
                const edgesGeometry = new THREE.EdgesGeometry(childWall.geometry);
                
                // 创建多条线段来加粗效果（比单个墙面稍微少一些，避免太密集）
                const offsets = [
                    { x: 0, y: 0, z: 0.3 },      // 主线条
                    { x: 0.08, y: 0, z: 0.35 },  // 右偏移
                    { x: -0.08, y: 0, z: 0.35 }, // 左偏移
                    { x: 0, y: 0.08, z: 0.35 },  // 上偏移
                    { x: 0, y: -0.08, z: 0.35 }  // 下偏移
                ];
                
                offsets.forEach((offset, offsetIndex) => {
                    // 克隆EdgesGeometry并应用偏移
                    const offsetGeometry = edgesGeometry.clone();
                    const positions = offsetGeometry.attributes.position.array;
                    
                    // 对所有顶点应用偏移
                    for (let i = 0; i < positions.length; i += 3) {
                        positions[i] += offset.x;     // X偏移
                        positions[i + 1] += offset.y; // Y偏移
                        positions[i + 2] += offset.z; // Z偏移
                    }
                    
                    // 更新几何体
                    offsetGeometry.attributes.position.needsUpdate = true;
                    
                    // 创建线条材质（弧形墙使用不同的颜色 - 蓝绿色）
                    const edgeMaterial = new THREE.LineBasicMaterial({ 
                        color: 0x00aaff, // 蓝绿色，区别于直线墙的纯蓝色
                        transparent: true,
                        opacity: offsetIndex === 0 ? 1.0 : 0.4,
                        depthTest: false,
                        depthWrite: false,
                        linewidth: offsetIndex === 0 ? 4 : 2
                    });
                    
                    // 创建线段对象
                    const edgeLine = new THREE.LineSegments(offsetGeometry, edgeMaterial);
                    edgeLine.renderOrder = 1000 + offsetIndex;
                    
                    // 应用子墙面的变换
                    edgeLine.position.copy(childWall.position);
                    edgeLine.rotation.copy(childWall.rotation);
                    edgeLine.scale.copy(childWall.scale);
                    
                    highlightGroup.add(edgeLine);
                });
            }
        });
        
        // 应用弧形墙group的变换
        highlightGroup.position.copy(arcWallGroup.position);
        highlightGroup.rotation.copy(arcWallGroup.rotation);
        highlightGroup.scale.copy(arcWallGroup.scale);
        
        console.log(`弧形墙group整体高亮创建完成，包含 ${highlightGroup.children.length} 个高亮线条`);
        
        return highlightGroup;
    }
    
    /**
     * 清除之前的高亮
     */
    clearWallHighlight() {
        if (this.highlightEdges) {
            this.scene.remove(this.highlightEdges);
            
            // 如果是Group，需要清理所有子对象
            if (this.highlightEdges.children) {
                this.highlightEdges.children.forEach(child => {
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                    if (child.material) {
                        child.material.dispose();
                    }
                });
                this.highlightEdges.clear(); // 清空Group
            } else {
                // 单个对象的清理
                if (this.highlightEdges.geometry) {
                    this.highlightEdges.geometry.dispose();
                }
                if (this.highlightEdges.material) {
                    this.highlightEdges.material.dispose();
                }
            }
            
            this.highlightEdges = null;
        }
        this.selectedWallMesh = null;
    }
    
    /**
     * 检查是否点击的是墙面正面
     * @param {Object} intersection - Raycaster交互结果
     * @returns {boolean} 是否为正面点击
     */
    isFrontFaceClick(intersection) {
        // 获取交叉点的面法向量
        const faceNormal = intersection.face.normal.clone();
        
        // 将法向量转换到世界坐标系
        const worldNormal = faceNormal.transformDirection(intersection.object.matrixWorld).normalize();
        
        // 获取射线方向（从相机指向交叉点）
        const rayDirection = this.raycaster.ray.direction.clone().normalize();
        
        // 计算射线方向与面法向量的点积
        const dotProduct = rayDirection.dot(worldNormal);
        
        console.log('射线方向:', rayDirection);
        console.log('面法向量:', worldNormal);
        console.log('点积值:', dotProduct.toFixed(3));
        
        // 如果点积为正，说明射线方向与法向量同向，即点击的是正面
        // 添加一个小的容差值来处理数值精度问题
        const isFrontFace = dotProduct > 0.1;
        
        console.log('是否为正面点击:', isFrontFace ? '是' : '否');
        
        return isFrontFace;
    }
    
    /**
     * 处理墙面点击事件
     * @param {Event} event - 鼠标点击事件
     */
    onWallClick(event) {
        // 计算鼠标位置
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // 检测与墙面的交互
        const intersects = this.raycaster.intersectObjects(this.wallMeshes);
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            const intersectedWall = intersection.object;
            
            // 检查是否点击的是正面
            if (!this.isFrontFaceClick(intersection)) {
                console.log('点击的是背面，忽略此次点击');
                return;
            }
            
            // 检查是否点击的是弧形墙的一部分
            let targetWall = intersectedWall;
            if (intersectedWall.userData.isArcWallPart && intersectedWall.userData.parentArcWall) {
                console.log('检测到弧形墙部分，选择整个弧形墙group');
                targetWall = intersectedWall.userData.parentArcWall;
            }
            
            // 清除之前的高亮
            this.clearWallHighlight();
            
            // 高亮当前选中的墙面
            this.selectedWallMesh = targetWall;
            
            if (targetWall.userData.isArcWall) {
                // 弧形墙：高亮整个group
                console.log('创建弧形墙整体高亮');
                this.highlightEdges = this.createArcWallGroupHighlight(targetWall);
            } else {
                // 单个墙面：使用原有逻辑
                console.log('创建单个墙面高亮');
                this.highlightEdges = this.createWallEdgeHighlight(targetWall);
            }
            
            this.scene.add(this.highlightEdges);
            
            console.log('选中墙面:', targetWall);
            console.log('墙面类型:', targetWall.userData.wallType || 'line');
            console.log('墙面位置:', targetWall.position);
            console.log('交叉点位置:', intersection.point);
            
            // 触发自定义事件
            this.onWallSelected(targetWall);
        } else {
            // 点击空白处，清除高亮
            this.clearWallHighlight();
            this.onWallDeselected();
        }
    }
    
    /**
     * 墙面选中回调（可被重写）
     * @param {THREE.Mesh} wallMesh - 选中的墙面mesh
     */
    onWallSelected(wallMesh) {
        // 子类可以重写此方法来处理墙面选中事件
    }
    
    /**
     * 墙面取消选中回调（可被重写）
     */
    onWallDeselected() {
        // 子类可以重写此方法来处理墙面取消选中事件
    }
    
    /**
     * 获取当前选中的墙面
     * @returns {THREE.Mesh|null} 当前选中的墙面mesh
     */
    getSelectedWall() {
        return this.selectedWallMesh;
    }
    
    /**
     * 获取所有墙面数量
     * @returns {number} 墙面数量
     */
    getWallCount() {
        return this.wallMeshes.length;
    }
    
    /**
     * 清理资源
     */
    dispose() {
        this.clearWallHighlight();
        
        // 移除事件监听器
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('click', this.onWallClick.bind(this));
        }
        
        // 清空数组
        this.wallMeshes = [];
    }
}