import * as THREE from 'three';

/**
 * 2D房间选择器 - 处理2D平面图中房间的点击选择和高亮显示
 */
export class Room2DSelector {
    constructor(sceneManager2D) {
        this.sceneManager = sceneManager2D;
        this.scene = sceneManager2D.getScene();
        this.renderer = sceneManager2D.getRenderer();
        
        // 射线投射器
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // 房间管理
        this.roomMeshes = [];
        this.selectedRoom = null;
        this.highlightObject = null;
        this.hoverObject = null; // 悬停高亮对象
        this.currentHoverRoom = null; // 当前悬停的房间
        this.enabled = true; // 控制是否启用选择功能
        
        // 高亮样式配置
        this.highlightConfig = {
            color: 0x00AAFF,
            opacity: 0.6,
            strokeColor: 0x0088DD,
            strokeWidth: 3,
            hoverColor: 0x44DDFF, // 悬停时的颜色
            hoverOpacity: 0.3,
            hoverStrokeColor: 0x66EEFF,
            hoverStrokeWidth: 2
        };
        
        this.bindEvents();
    }

    /**
     * 绑定鼠标事件
     */
    bindEvents() {
        this.handleMouseDownBound = this.handleRoomMouseDown.bind(this);
        this.handleMouseMoveBound = this.handleRoomMouseMove.bind(this);
        this.renderer.domElement.addEventListener('mousedown', this.handleMouseDownBound);
        this.renderer.domElement.addEventListener('mousemove', this.handleMouseMoveBound);
    }

    /**
     * 设置选择器启用状态
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled && this.selectedRoom) {
            // 禁用时清除当前选择
            this.clearSelection();
        }
        console.log('2D房间选择器', enabled ? '已启用' : '已禁用');
    }

    /**
     * 添加可选择的房间mesh
     * @param {THREE.Mesh} roomMesh - 房间mesh对象
     * @param {number} roomIndex - 房间索引
     */
    addRoom(roomMesh, roomIndex) {
        if (roomMesh && !this.roomMeshes.includes(roomMesh)) {
            // 为房间mesh添加标识信息
            roomMesh.userData = {
                ...roomMesh.userData,
                type: '2d-room',
                roomIndex: roomIndex,
                isSelectable: true
            };
            this.roomMeshes.push(roomMesh);
        }
    }

    /**
     * 批量添加房间meshes
     * @param {Array} roomMeshes - 房间mesh数组，每个元素包含 {mesh, roomIndex}
     */
    addRooms(roomMeshes) {
        if (Array.isArray(roomMeshes)) {
            roomMeshes.forEach(({mesh, roomIndex}) => {
                this.addRoom(mesh, roomIndex);
            });
        }
    }

    /**
     * 处理房间鼠标按下事件
     * @param {Event} event - 鼠标按下事件
     */
    handleRoomMouseDown(event) {
        console.log('房间选择器: 接收到鼠标按下事件 (冒泡阶段)');
        
        if (!this.enabled) {
            console.log('房间选择器: 未启用，跳过');
            return; // 禁用状态下不处理点击
        }
        
        // 只处理左键按下
        if (event.button !== 0) {
            return;
        }

        // 检查是否有其他选择器已经处理了这个事件
        if (window.__selectionHandled) {
            console.log('房间选择器: 检测到其他选择器已处理事件，跳过');
            return;
        }
        
        // 计算标准化鼠标坐标（相对于2D canvas）
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.getCamera());

        // 检测与房间的碰撞
        const intersects = this.raycaster.intersectObjects(this.roomMeshes);

        if (intersects.length > 0) {
            const intersection = intersects[0];
            const roomMesh = intersection.object;
            
            // 检查是否点击的是已选中的房间
            if (this.selectedRoom === roomMesh) {
                console.log('再次点击已选中房间，取消选择');
                this.clearSelection();
            } else {
                console.log('选择房间:', roomMesh.userData.roomIndex);
                this.selectRoom(roomMesh);
            }

            // 阻止事件传播，防止其他选择器被触发
            event.stopPropagation();
            event.stopImmediatePropagation();
            
            // 设置全局标志，让其他选择器知道已经有对象被选中
            window.__selectionHandled = true;
            setTimeout(() => {
                window.__selectionHandled = false;
            }, 10);
        } else {
            // 点击空白处，取消选择
            this.clearSelection();
        }
    }

    /**
     * 处理房间鼠标移动事件（悬停效果）
     * @param {Event} event - 鼠标移动事件
     */
    handleRoomMouseMove(event) {
        if (!this.enabled) {
            return; // 禁用状态下不处理悬停
        }

        // 检查是否有其他选择器已经处理了悬停事件
        if (window.__hoverHandled) {
            // 如果其他选择器（如软装选择器）已经处理了悬停，清除房间悬停效果
            this.clearHover();
            return;
        }

        // 计算标准化鼠标坐标
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.getCamera());

        // 检测与房间的碰撞
        const intersects = this.raycaster.intersectObjects(this.roomMeshes);

        if (intersects.length > 0) {
            const roomMesh = intersects[0].object;
            
            // 如果是新的悬停房间或者当前没有悬停房间
            if (roomMesh !== this.currentHoverRoom) {
                this.clearHover(); // 清除之前的悬停效果
                
                // 如果不是已选中的房间，才显示悬停效果
                if (roomMesh !== this.selectedRoom) {
                    this.createHoverHighlight(roomMesh);
                    this.currentHoverRoom = roomMesh;
                }
            }
        } else {
            // 鼠标不在任何房间上，清除悬停效果
            this.clearHover();
        }
    }

    /**
     * 创建悬停高亮效果
     * @param {THREE.Mesh} roomMesh - 房间mesh
     */
    createHoverHighlight(roomMesh) {
        if (!roomMesh || !roomMesh.geometry) return;

        // 创建悬停高亮组
        this.hoverObject = new THREE.Group();

        // 创建悬停边框（只显示边框，不显示填充）
        const edgesGeometry = new THREE.EdgesGeometry(roomMesh.geometry);
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: this.highlightConfig.hoverStrokeColor,
            linewidth: this.highlightConfig.hoverStrokeWidth,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
            depthWrite: false
        });

        const edgesLine = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edgesLine.position.copy(roomMesh.position);
        edgesLine.position.z = roomMesh.position.z + 0.005; // 稍微高于地面
        edgesLine.rotation.copy(roomMesh.rotation);
        edgesLine.scale.copy(roomMesh.scale);
        edgesLine.renderOrder = 600; // 在选择高亮之后渲染

        this.hoverObject.add(edgesLine);

        // 添加到场景
        this.scene.add(this.hoverObject);
    }

    /**
     * 清除悬停高亮效果
     */
    clearHover() {
        if (this.hoverObject) {
            this.scene.remove(this.hoverObject);
            
            // 清理资源
            this.hoverObject.traverse(child => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            this.hoverObject = null;
        }
        
        this.currentHoverRoom = null;
    }

    /**
     * 选择房间
     * @param {THREE.Mesh} roomMesh - 要选择的房间mesh
     */
    selectRoom(roomMesh) {
        // 清除之前的选择
        this.clearSelection();
        
        // 设置新选择
        this.selectedRoom = roomMesh;
        
        // 创建高亮效果
        this.createRoomHighlight(roomMesh);
        
        console.log(`已选择房间 ${roomMesh.userData.roomIndex}`);
        
        // 触发选择回调
        if (this.onRoomSelected) {
            this.onRoomSelected(roomMesh, roomMesh.userData.roomIndex);
        }
    }

    /**
     * 创建房间高亮效果
     * @param {THREE.Mesh} roomMesh - 房间mesh
     */
    createRoomHighlight(roomMesh) {
        if (!roomMesh || !roomMesh.geometry) return;

        // 创建高亮组
        this.highlightObject = new THREE.Group();

        // 1. 创建高亮填充 - 降低Z位置，使其位于DXF图例下方
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: this.highlightConfig.color,
            transparent: true,
            opacity: this.highlightConfig.opacity,
            depthTest: false,
            depthWrite: false
        });

        const highlightGeometry = roomMesh.geometry.clone();
        const highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
        
        // 复制变换并降低Z位置，确保在DXF图例下方
        highlightMesh.position.copy(roomMesh.position);
        highlightMesh.position.z = roomMesh.position.z - 0.05; // 降低到房间地面下方
        highlightMesh.rotation.copy(roomMesh.rotation);
        highlightMesh.scale.copy(roomMesh.scale);
        highlightMesh.renderOrder = -100; // 负数确保在其他对象之前渲染

        this.highlightObject.add(highlightMesh);

        // 2. 创建高亮边框
        const edgesGeometry = new THREE.EdgesGeometry(roomMesh.geometry);
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: this.highlightConfig.strokeColor,
            linewidth: this.highlightConfig.strokeWidth,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
        });

        const edgesLine = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edgesLine.position.copy(roomMesh.position);
        edgesLine.position.z = roomMesh.position.z + 0.01; // 边框稍微高于地面
        edgesLine.rotation.copy(roomMesh.rotation);
        edgesLine.scale.copy(roomMesh.scale);
        edgesLine.renderOrder = 500; // 中等渲染顺序，在填充之后，DXF之前

        this.highlightObject.add(edgesLine);

        // 添加到场景
        this.scene.add(this.highlightObject);

        console.log('房间高亮效果已创建');
    }

    /**
     * 清除选择
     */
    clearSelection() {
        // 清除悬停效果
        this.clearHover();
        
        if (this.highlightObject) {
            this.scene.remove(this.highlightObject);
            
            // 清理资源
            this.highlightObject.traverse(child => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            this.highlightObject = null;
        }
        
        if (this.selectedRoom) {
            console.log(`取消选择房间 ${this.selectedRoom.userData.roomIndex}`);
            
            // 触发取消选择回调
            if (this.onRoomDeselected) {
                this.onRoomDeselected(this.selectedRoom, this.selectedRoom.userData.roomIndex);
            }
        }
        
        this.selectedRoom = null;
    }

    /**
     * 获取当前选中的房间
     * @returns {THREE.Mesh|null} 选中的房间mesh
     */
    getSelectedRoom() {
        return this.selectedRoom;
    }

    /**
     * 获取选中房间的索引
     * @returns {number|null} 房间索引
     */
    getSelectedRoomIndex() {
        return this.selectedRoom ? this.selectedRoom.userData.roomIndex : null;
    }

    /**
     * 根据房间索引选择房间
     * @param {number} roomIndex - 房间索引
     */
    selectRoomByIndex(roomIndex) {
        const roomMesh = this.roomMeshes.find(mesh => 
            mesh.userData.roomIndex === roomIndex
        );
        
        if (roomMesh) {
            this.selectRoom(roomMesh);
        } else {
            console.warn(`未找到索引为 ${roomIndex} 的房间`);
        }
    }

    /**
     * 设置高亮样式配置
     * @param {Object} config - 样式配置对象
     */
    setHighlightConfig(config) {
        this.highlightConfig = {
            ...this.highlightConfig,
            ...config
        };
    }

    /**
     * 房间选中回调（可被重写）
     * @param {THREE.Mesh} roomMesh - 选中的房间mesh
     * @param {number} roomIndex - 房间索引
     */
    onRoomSelected(roomMesh, roomIndex) {
        // 子类可以重写此方法
        console.log(`2D房间选择回调: 选中房间 ${roomIndex}`);
    }

    /**
     * 房间取消选择回调（可被重写）
     * @param {THREE.Mesh} roomMesh - 被取消选择的房间mesh
     * @param {number} roomIndex - 房间索引
     */
    onRoomDeselected(roomMesh, roomIndex) {
        // 子类可以重写此方法
        console.log(`2D房间选择回调: 取消选择房间 ${roomIndex}`);
    }

    /**
     * 销毁选择器
     */
    dispose() {
        this.clearSelection();
        this.roomMeshes = [];
        
        // 移除事件监听
        if (this.handleMouseDownBound) {
            this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDownBound);
        }
        if (this.handleMouseMoveBound) {
            this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMoveBound);
        }
    }
}