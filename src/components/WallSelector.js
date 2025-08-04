import * as THREE from 'three';

/**
 * 墙面选择器 - 处理墙面点击选择和高亮显示
 */
export class WallSelector {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.getScene();
        this.camera = sceneManager.getCamera();
        this.renderer = sceneManager.getRenderer();
        
        // 射线投射器
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // 墙面管理
        this.wallMeshes = [];
        this.selectedWall = null;
        this.highlightObject = null;
        this.enabled = true; // 控制是否启用选择功能
        
        this.bindEvents();
    }

    /**
     * 绑定鼠标事件
     */
    bindEvents() {
        this.renderer.domElement.addEventListener('click', (event) => {
            this.handleWallClick(event);
        });
    }

    /**
     * 设置选择器启用状态
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled && this.selectedWall) {
            // 禁用时清除当前选择
            this.clearSelection();
        }
        console.log('墙面选择器', enabled ? '已启用' : '已禁用');
    }

    /**
     * 添加可选择的墙面
     * @param {THREE.Mesh} wallMesh - 墙面mesh对象
     */
    addWall(wallMesh) {
        if (wallMesh && !this.wallMeshes.includes(wallMesh)) {
            this.wallMeshes.push(wallMesh);
        }
    }

    /**
     * 批量添加墙面
     * @param {Array} wallMeshes - 墙面mesh数组
     */
    addWalls(wallMeshes) {
        if (Array.isArray(wallMeshes)) {
            wallMeshes.forEach(mesh => this.addWall(mesh));
        }
    }

    /**
     * 处理墙面点击事件
     * @param {Event} event - 鼠标点击事件
     */
    handleWallClick(event) {
        if (!this.enabled) {
            return; // 禁用状态下不处理点击
        }
        
        // 计算标准化鼠标坐标
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // 检测碰撞
        const intersects = this.raycaster.intersectObjects(this.wallMeshes);

        if (intersects.length > 0) {
            const intersection = intersects[0];
            
            // 检查是否点击正面
            if (this.isFrontFaceClick(intersection)) {
                this.selectWall(intersection.object);
            }
        } else {
            this.clearSelection();
        }
    }

    /**
     * 检查是否点击墙面正面
     * @param {Object} intersection - 射线碰撞结果
     * @returns {boolean} 是否为正面点击
     */
    isFrontFaceClick(intersection) {
        const meshType = intersection.object.userData.type;
        
        // 对门窗对象更宽松的选择条件
        if (meshType === 'door' || meshType === 'window') {
            return true; // 门窗对象可以从任意角度选择
        }
        
        const faceNormal = intersection.face.normal.clone();
        const worldNormal = faceNormal.transformDirection(intersection.object.matrixWorld).normalize();
        const rayDirection = this.raycaster.ray.direction.clone().normalize();
        
        return rayDirection.dot(worldNormal) > 0.1;
    }

    /**
     * 选择墙面
     * @param {THREE.Mesh} wallMesh - 要选择的墙面
     */
    selectWall(wallMesh) {
        this.clearSelection();
        
        this.selectedWall = wallMesh;
        this.highlightObject = this.createWallHighlight(wallMesh);
        
        if (this.highlightObject) {
            this.scene.add(this.highlightObject);
        }

        const meshType = wallMesh.userData.type;
        const objectType = meshType === 'door' ? '门' : 
                          meshType === 'window' ? '窗' : '墙面';
        console.log('选中对象:', objectType, wallMesh.userData.wallType || 'unknown');
        
        // 触发选择事件
        this.onWallSelected(wallMesh);
    }

    /**
     * 创建墙面高亮效果
     * @param {THREE.Mesh} wallMesh - 墙面对象
     * @returns {THREE.Group} 高亮对象
     */
    createWallHighlight(wallMesh) {
        const wallType = wallMesh.userData.wallType;
        let highlightGroup;
        
        if (wallType === 'arc') {
            highlightGroup = this.createArcWallHighlight(wallMesh);
        } else {
            highlightGroup = this.createStraightWallHighlight(wallMesh);
        }
        
        // 如果是门窗对象，需要应用离地高度
        const meshType = wallMesh.userData.type;
        if ((meshType === 'door' || meshType === 'window') && wallMesh.userData.groundHeight) {
            highlightGroup.position.z = wallMesh.userData.groundHeight;
        }
        
        return highlightGroup;
    }

    /**
     * 创建直线墙面高亮
     * @param {THREE.Mesh} wallMesh - 直线墙面
     * @returns {THREE.Group} 高亮对象
     */
    createStraightWallHighlight(wallMesh) {
        const edgesGeometry = new THREE.EdgesGeometry(wallMesh.geometry);
        return this.createHighlightLines(edgesGeometry, 0x0000ff);
    }

    /**
     * 创建弧形墙面高亮（外轮廓）
     * @param {THREE.Mesh} wallMesh - 弧形墙面
     * @returns {THREE.Group} 高亮对象
     */
    createArcWallHighlight(wallMesh) {
        const geometry = wallMesh.geometry;
        const positions = geometry.attributes.position.array;
        const vertexCount = positions.length / 3;
        const bottomVertexCount = vertexCount / 2;

        // 提取底部和顶部顶点
        const bottomVertices = [];
        const topVertices = [];

        for (let i = 0; i < bottomVertexCount; i++) {
            const bottomIndex = i * 3;
            const topIndex = (bottomVertexCount + i) * 3;

            bottomVertices.push(new THREE.Vector3(
                positions[bottomIndex], positions[bottomIndex + 1], positions[bottomIndex + 2]
            ));
            topVertices.push(new THREE.Vector3(
                positions[topIndex], positions[topIndex + 1], positions[topIndex + 2]
            ));
        }

        // 创建外轮廓
        const outlinePoints = [];

        // 底边
        for (let i = 0; i < bottomVertices.length - 1; i++) {
            outlinePoints.push(bottomVertices[i], bottomVertices[i + 1]);
        }

        // 右边
        outlinePoints.push(
            bottomVertices[bottomVertices.length - 1], 
            topVertices[topVertices.length - 1]
        );

        // 顶边（逆向）
        for (let i = topVertices.length - 1; i > 0; i--) {
            outlinePoints.push(topVertices[i], topVertices[i - 1]);
        }

        // 左边
        outlinePoints.push(topVertices[0], bottomVertices[0]);

        const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
        return this.createHighlightLines(outlineGeometry, 0x00aaff);
    }

    /**
     * 创建高亮线条组
     * @param {THREE.BufferGeometry} geometry - 线条几何体
     * @param {number} color - 线条颜色
     * @returns {THREE.Group} 线条组
     */
    createHighlightLines(geometry, color) {
        const lineGroup = new THREE.Group();
        
        // 创建多重线条实现加粗效果
        const offsets = [
            { x: 0, y: 0, z: 0.3 },
            { x: 0.1, y: 0, z: 0.35 },
            { x: -0.1, y: 0, z: 0.35 },
            { x: 0, y: 0.1, z: 0.35 },
            { x: 0, y: -0.1, z: 0.35 }
        ];

        offsets.forEach((offset, index) => {
            const offsetGeometry = geometry.clone();
            const positions = offsetGeometry.attributes.position.array;

            // 应用偏移
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += offset.x;
                positions[i + 1] += offset.y;
                positions[i + 2] += offset.z;
            }

            offsetGeometry.attributes.position.needsUpdate = true;

            const material = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: index === 0 ? 1.0 : 0.4,
                depthTest: false,
                depthWrite: false
            });

            const line = new THREE.LineSegments(offsetGeometry, material);
            line.renderOrder = 1000 + index;
            
            lineGroup.add(line);
        });

        return lineGroup;
    }

    /**
     * 清除选择
     */
    clearSelection() {
        if (this.highlightObject) {
            this.scene.remove(this.highlightObject);
            
            // 清理资源
            this.highlightObject.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            
            this.highlightObject = null;
        }
        
        this.selectedWall = null;
    }

    /**
     * 获取当前选中的墙面
     * @returns {THREE.Mesh|null} 选中的墙面
     */
    getSelectedWall() {
        return this.selectedWall;
    }

    /**
     * 墙面选中回调（可被重写）
     * @param {THREE.Mesh} wallMesh - 选中的墙面
     */
    onWallSelected(wallMesh) {
        // 子类可以重写此方法
    }

    /**
     * 销毁选择器
     */
    dispose() {
        this.clearSelection();
        this.wallMeshes = [];
        
        // 移除事件监听
        this.renderer.domElement.removeEventListener('click', this.handleWallClick);
    }
}