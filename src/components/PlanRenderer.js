import * as THREE from 'three';

/**
 * 2D彩平图渲染器 - 使用Three.js渲染2D平面图
 */
export class PlanRenderer {
    constructor() {
        
        // 2D平面对象组
        this.planGroup = new THREE.Group();
        this.labelGroup = new THREE.Group();
        
        // 房间mesh数组，用于选择器
        this.roomMeshes = [];
        
        // 颜色配置
        this.colors = {
            outline: 0xE8E8E8,
            rooms: 0xFFE4B5,
            roomStroke: 0xDDD8B5,
            door: 0x8B4513,
            window: 0x87CEEB,
            text: 0x333333
        };
        
        // 数据缓存
        this.outlineData = null;
        this.roomsData = null;
        this.doorsData = [];
        this.windowsData = [];
    }

    /**
     * 渲染2D彩平图
     * @param {Object} data - 数据对象，包含outline、rooms、doorWindows
     * @param {THREE.Scene} scene - Three.js场景对象
     * @returns {Object} 包含创建的mesh对象
     */
    async render(data, scene) {
        try {
            // 处理数据
            this.processData(data);
            
            // 如果已经渲染过，直接返回现有对象
            if (this.planGroup.children.length > 0) {
                console.log('2D彩平图已存在缓存，使用现有渲染结果');
                return {
                    planGroup: this.planGroup,
                    labelGroup: this.labelGroup
                };
            }
            
            // 首次渲染：清空现有的2D对象
            this.clearPlanObjects(scene);

            // 户型底板：外轮廓为 shape，房间/门/窗作为 holes 一次性挖出。
            // 这些图形都是零厚度的平面，用 CSG 做布尔是退化情形（平面没有内外之分），
            // 引擎会在其中空转；Shape.holes 由 ShapeGeometry 一次三角化即可得到同样结果。
            const outlineShape = this.createShape(this.outlineData);
            if (outlineShape) {
                const holes = [
                    ...this.roomsData,
                    ...this.doorsData.map(door => door.points),
                    ...this.windowsData.map(win => win.points)
                ];

                for (const holePoints of holes) {
                    const path = this.createPath(holePoints);
                    if (path) outlineShape.holes.push(path);
                }

                const outlineMesh = new THREE.Mesh(
                    new THREE.ShapeGeometry(outlineShape),
                    new THREE.MeshBasicMaterial({ color: this.colors.outline, side: THREE.DoubleSide })
                );
                outlineMesh.position.z = 0;
                this.planGroup.add(outlineMesh);
            }

            // 房间平面：单独成 mesh，供 Room2DSelector 拾取
            const roomMaterial = new THREE.MeshBasicMaterial({
                color: this.colors.rooms,
                side: THREE.DoubleSide
            });

            for (let i = 0; i < this.roomsData.length; i++) {
                const roomShape = this.createShape(this.roomsData[i]);
                if (!roomShape) continue;

                // 材质需各自独立：选中房间时会改它的颜色
                const roomMesh = new THREE.Mesh(
                    new THREE.ShapeGeometry(roomShape),
                    roomMaterial.clone()
                );
                roomMesh.position.z = 0.1;
                roomMesh.userData = {
                    type: '2d-room',
                    roomIndex: i,
                    isSelectable: true,
                    roomData: this.roomsData[i]
                };

                this.planGroup.add(roomMesh);
                this.roomMeshes.push(roomMesh);
            }

            // 创建标签
            // this.createLabels();


            // 添加到场景
            scene.add(this.planGroup);
            scene.add(this.labelGroup);
            
            console.log('2D彩平图渲染完成');
            
            return {
                planGroup: this.planGroup,
                labelGroup: this.labelGroup
            };
            
        } catch (error) {
            console.error('2D彩平图渲染失败:', error);
            throw error;
        }
    }

    /**
     * 处理数据 - 参考RoomRenderer的数据处理方式
     * @param {Object} data - 原始数据
     */
    processData(data) {
        if (data.outline && Array.isArray(data.outline.outlinePoints)) {
            this.outlineData = this.convertPointFormat(data.outline.outlinePoints);
        } else if (Array.isArray(data.outline)) {
            this.outlineData = this.convertPointFormat(data.outline);
        } else {
            console.warn('无法处理外轮廓数据');
            this.outlineData = null;
        }

        if (data.rooms && Array.isArray(data.rooms.roomPoints)) {
            this.roomsData = data.rooms.roomPoints.map(roomPoints => this.convertPointFormat(roomPoints));
        } else {
            console.warn('未找到有效的房间数据');
            this.roomsData = [];
        }

        // 处理门窗数据
        if (data.doorWindows) {
            // 处理门数据
            this.doorsData = Array.isArray(data.doorWindows.doors) ? 
                data.doorWindows.doors.map(door => ({
                    ...door,
                    points: door.points ? this.convertPointFormat(door.points) : []
                })) : [];
            
            // 处理窗数据
            this.windowsData = Array.isArray(data.doorWindows.windows) ? 
                data.doorWindows.windows.map(window => ({
                    ...window,
                    points: window.points ? this.convertPointFormat(window.points) : []
                })) : [];
        } else {
            this.doorsData = [];
            this.windowsData = [];
        }
        
        console.log('✅ 2D数据处理完成:', {
            outline: this.outlineData ? `${this.outlineData.length} points` : 'empty',
            rooms: this.roomsData.length,
            doors: this.doorsData.length,
            windows: this.windowsData.length
        });
        console.log('========= PlanRenderer 数据处理结束 =========');
    }

    /**
     * 获取房间mesh数组
     * @returns {Array} 房间mesh数组，每个元素包含 {mesh, roomIndex}
     */
    getRoomMeshes() {
        return this.roomMeshes.map(mesh => ({
            mesh: mesh,
            roomIndex: mesh.userData.roomIndex
        }));
    }

    /**
     * 根据房间索引获取房间mesh
     * @param {number} roomIndex - 房间索引
     * @returns {THREE.Mesh|null} 房间mesh
     */
    getRoomMeshByIndex(roomIndex) {
        return this.roomMeshes.find(mesh => 
            mesh.userData.roomIndex === roomIndex
        ) || null;
    }

    /**
     * 获取房间总数
     * @returns {number} 房间数量
     */
    getRoomCount() {
        return this.roomMeshes.length;
    }

    /**
     * 转换点格式 - 参考RoomRenderer.convertPointFormat
     * @param {Array} points - 原始点数组
     * @returns {Array} 转换后的点数组
     */
    convertPointFormat(points) {
        if (!Array.isArray(points)) return [];
        
        return points.map(point => {
            if (Array.isArray(point) && point.length >= 2) {
                return { x: point[0], y: point[1], z: point[2] || 0 };
            } else if (typeof point === 'object' && point.x !== undefined && point.y !== undefined) {
                return { x: point.x, y: point.y, z: point.z || 0 };
            }
            return { x: 0, y: 0, z: 0 };
        });
    }

    // /**
    //  * 创建2D平面网格（使用Shape holes挖洞）
    //  * @returns {THREE.Mesh|null} 创建的平面mesh
    //  */
    // async createPlanMesh() {
    //     try {
    //         console.log('开始创建2D平面...');
            
    //         // 创建户型；
    //         const shapeWithHoles = this.createShapeWithHoles();
    //         if (!shapeWithHoles) {
    //             throw new Error('无法创建带洞的形状');
    //         }
            
            
    //         // 添加边框
    //         const edges = new THREE.EdgesGeometry(geometry);
    //         const lineMaterial = new THREE.LineBasicMaterial({ 
    //             color: this.colors.roomStroke,
    //             linewidth: 1
    //         });
    //         const wireframe = new THREE.LineSegments(edges, lineMaterial);
    //         mesh.add(wireframe);
            
    //         console.log('2D平面创建完成');
    //         return mesh;
            
    //     } catch (error) {
    //         console.error('创建2D平面失败:', error);
    //         throw error;
    //     }
    // }

    /**
     * 由点数组构建轮廓（Shape 或 Path）
     * @param {Array} points - 点数组 [{x, y}, ...]
     * @param {Function} Ctor - THREE.Shape 或 THREE.Path
     * @returns {THREE.Shape|THREE.Path|null}
     */
    buildContour(points, Ctor) {
        if (!Array.isArray(points) || points.length < 3) {
            return null;
        }

        const valid = points.filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');
        if (valid.length < 3) {
            console.warn('轮廓有效点不足3个，跳过');
            return null;
        }

        const contour = new Ctor();
        contour.moveTo(valid[0].x, valid[0].y);
        for (let i = 1; i < valid.length; i++) {
            contour.lineTo(valid[i].x, valid[i].y);
        }
        contour.closePath();

        return contour;
    }

    /** 构建外轮廓 Shape */
    createShape(points) {
        return this.buildContour(points, THREE.Shape);
    }

    /** 构建挖洞用的 Path */
    createPath(points) {
        return this.buildContour(points, THREE.Path);
    }

    // /**
    //  * 创建房间平面
    //  * @returns {THREE.Shape|null}
    //  */
    // createRooms(){
    //     const rooms = [];
    //     if (this.roomsData && this.roomsData.length > 0) {
    //         console.log(`添加${this.roomsData.length}个房间洞...`);
            
    //         this.roomsData.forEach((roomPoints, index) => {
    //             if (!Array.isArray(roomPoints) || roomPoints.length < 3) {
    //                 console.warn(`房间${index}数据无效，跳过`);
    //                 return;
    //             }
                
    //             try {
    //                 const shape = new THREE.Shape();
                    
    //                 const firstRoomPoint = roomPoints[0];
    //                 if (!firstRoomPoint || typeof firstRoomPoint.x !== 'number' || typeof firstRoomPoint.y !== 'number') {
    //                     console.warn(`房间${index}第一个点无效，跳过`);
    //                     return;
    //                 }
                    
    //                 shape.moveTo(firstRoomPoint.x, firstRoomPoint.y);
    //                 for (let i = 1; i < roomPoints.length; i++) {
    //                     const point = roomPoints[i];
    //                     if (point && typeof point.x === 'number' && typeof point.y === 'number') {
    //                         shape.lineTo(point.x, point.y);
    //                     }
    //                 }
    //                 shape.closePath();
                    
    //                 // let 

    //                 // rooms.push();
    //                 console.log(`✅ 房间${index}洞添加成功`);
                    
    //             } catch (error) {
    //                 console.warn(`房间${index}洞添加失败:`, error);
    //             }
    //         });
    //     }
    // }


    /**
     * 创建门窗线条
     */
    createDoorWindowLines() {
        console.log('创建门窗线条...');
        console.log('门数据:', this.doorsData.length);
        console.log('窗数据:', this.windowsData.length);
        
        // 创建门线条
        this.doorsData.forEach((door, index) => {
            if (!door.points || door.points.length < 2) {
                console.warn(`门${index}数据无效:`, door);
                return;
            }
            
            try {
                const points = [];
                door.points.forEach(point => {
                    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                        points.push(new THREE.Vector3(point.x, point.y, 1));
                    }
                });
                
                if (points.length >= 2) {
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({
                        color: this.colors.door,
                        linewidth: 6
                    });
                    
                    const doorLine = new THREE.Line(geometry, material);
                    this.planGroup.add(doorLine);
                    console.log(`门${index}线条创建成功`);
                }
            } catch (error) {
                console.warn(`门${index}线条创建失败:`, error);
            }
        });
        
        // 创建窗线条
        this.windowsData.forEach((window, index) => {
            if (!window.points || window.points.length < 2) {
                console.warn(`窗${index}数据无效:`, window);
                return;
            }
            
            try {
                const points = [];
                window.points.forEach(point => {
                    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                        points.push(new THREE.Vector3(point.x, point.y, 1));
                    }
                });
                
                if (points.length >= 2) {
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const material = new THREE.LineBasicMaterial({
                        color: this.colors.window,
                        linewidth: 4
                    });
                    
                    const windowLine = new THREE.Line(geometry, material);
                    this.planGroup.add(windowLine);
                    console.log(`窗${index}线条创建成功`);
                }
            } catch (error) {
                console.warn(`窗${index}线条创建失败:`, error);
            }
        });
    }

    /**
     * 创建房间标签
     */
    createLabels() {
        // 清空现有标签
        this.labelGroup.clear();
        
        if (!this.roomsData || this.roomsData.length === 0) return;
        
        this.roomsData.forEach((roomPoints, index) => {
            if (!Array.isArray(roomPoints) || roomPoints.length < 3) return;
            
            try {
                // 计算房间中心点
                let centerX = 0, centerY = 0;
                let validPointCount = 0;
                
                roomPoints.forEach(point => {
                    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                        centerX += point.x;
                        centerY += point.y;
                        validPointCount++;
                    }
                });
                
                if (validPointCount === 0) {
                    console.warn(`房间${index}没有有效点，跳过标签创建`);
                    return;
                }
                
                centerX /= validPointCount;
                centerY /= validPointCount;
                
                // 计算房间面积
                const area = this.calculateArea(roomPoints);
                
                // 创建文本精灵
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = 256;
                canvas.height = 128;
                
                context.fillStyle = '#333333';
                context.font = '24px Arial';
                context.textAlign = 'center';
                context.fillText(`房间${index + 1}`, 128, 40);
                context.font = '18px Arial';
                context.fillStyle = '#666666';
                context.fillText(`${(area / 1e6).toFixed(1)}m²`, 128, 70);
                
                const texture = new THREE.CanvasTexture(canvas);
                const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
                const sprite = new THREE.Sprite(spriteMaterial);
                
                sprite.position.set(centerX, centerY, 1);
                sprite.scale.set(100, 50, 1);
                
                this.labelGroup.add(sprite);
                
            } catch (error) {
                console.warn(`房间${index}标签创建失败:`, error);
            }
        });
    }

    /**
     * 计算多边形面积
     * @param {Array} points - 点数组
     * @returns {number} 面积
     */
    calculateArea(points) {
        if (!points || points.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            const currentPoint = points[i];
            const nextPoint = points[j];
            
            if (currentPoint && nextPoint && 
                typeof currentPoint.x === 'number' && typeof currentPoint.y === 'number' &&
                typeof nextPoint.x === 'number' && typeof nextPoint.y === 'number') {
                area += currentPoint.x * nextPoint.y;
                area -= nextPoint.x * currentPoint.y;
            }
        }
        return Math.abs(area) / 2;
    }

    /**
     * 清空场景中的2D平面对象
     * @param {THREE.Scene} scene - Three.js场景
     */
    clearPlanObjects(scene) {
        // 移除并清理现有的2D对象
        if (scene.getObjectByName) {
            scene.remove(this.planGroup);
            scene.remove(this.labelGroup);
        }
        
        // 清理几何体和材质
        this.planGroup.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        
        this.labelGroup.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        
        // 清空组
        this.planGroup.clear();
        this.labelGroup.clear();
        
        // 清空房间mesh数组
        this.roomMeshes = [];
    }

    /**
     * 设置标签显示状态
     * @param {boolean} visible - 是否显示标签
     */
    setLabelsVisible(visible) {
        this.labelGroup.visible = visible;
    }

    /**
     * 销毁渲染器
     * @param {THREE.Scene} scene - Three.js场景
     */
    dispose(scene) {
        this.clearPlanObjects(scene);
        
    }
}