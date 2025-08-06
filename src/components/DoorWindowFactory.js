import * as THREE from 'three';

/**
 * 门窗工厂类 - 负责创建门窗的3D模型
 */
export class DoorWindowFactory {
    /**
     * 创建门窗mesh的统一接口
     * @param {Array} points - 点数组，格式: [{x, y, z, bulge}, ...]
     * @param {number} height - 拉伸高度（原始高度，会被调整为合适的比例）
     * @param {number} groundHeight - 离地高度 (默认0)
     * @param {Object} options - 配置选项
     * @returns {THREE.Mesh} 门窗mesh对象
     */
    static createDoorWindow(points, height, groundHeight = 0, options = {}) {
        const {
            materialType = 'door'   // 'door' 或 'window'
        } = options;
        
        // 根据材质类型设置默认值
        const {
            color = materialType === 'window' ? 0x87CEEB : 0x654321,  // 窗户用天空蓝，门用深木色
            opacity = materialType === 'window' ? 0.3 : 1.0,          // 窗户透明，门不透明
            transparent = materialType === 'window'                    // 窗户透明，门不透明
        } = options;

        // 验证输入参数
        if (!points || points.length < 3) {
            console.error('门窗创建失败：至少需要3个点来形成封闭形状');
            return null;
        }

        console.log('门窗创建参数:', { height, groundHeight, points: points.length });
        
        if (height <= 0) {
            console.error('门窗创建失败：高度必须大于0，当前高度:', height);
            return null;
        }

        try {
            // 创建THREE.js Shape
            const shape = new THREE.Shape();
            
            // 转换第一个点并移动到起点
            const firstPoint = points[0];
            shape.moveTo(firstPoint.x, firstPoint.y);
            
            // 服务端已经处理过弧形采样，直接连接所有点
            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                shape.lineTo(point.x, point.y);
            }
            
            // 闭合形状
            shape.lineTo(points[0].x, points[0].y);

            // 使用ExtrudeGeometry创建3D几何体（增加厚度避免被基础mesh遮挡）
            const extrudeSettings = {
                steps: 1,
                depth: height, // 增加20mm厚度，确保突出基础mesh
                bevelEnabled: false
            };

            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geometry.computeVertexNormals();

            // 创建材质
            const material = this.createMaterial(materialType, color, opacity, transparent);

            // 创建主体mesh
            const mesh = new THREE.Mesh(geometry, material);
            
            // 设置离地高度
            mesh.position.z = groundHeight;
        
            // 检查是否包含弧形段
            const hasArc = points.some(point => point.bulge && Math.abs(point.bulge) > 0.001);
            
            // 添加用户数据
            mesh.userData = {
                type: materialType,
                wallType: hasArc ? 'arc' : 'straight', // 添加wallType供WallSelector使用
                height: height,
                groundHeight: groundHeight,
                pointCount: points.length,
                hasArc: hasArc
            };

            return mesh;

        } catch (error) {
            console.error('门窗创建失败:', error);
            return null;
        }
    }

    /**
     * 创建门mesh
     * @param {Array} points - 门的轮廓点
     * @param {number} height - 门的高度
     * @param {Object} options - 配置选项
     * @returns {THREE.Mesh} 门mesh
     */
    static createDoor(points, height, options = {}) {
        const doorOptions = {
            color: 0x654321,        // 深木色，更现代的门
            opacity: 1.0,
            transparent: false,
            materialType: 'door',
            ...options
        };
        
        return this.createDoorWindow(points, height, 0, doorOptions);
    }

    /**
     * 创建窗mesh
     * @param {Array} points - 窗的轮廓点
     * @param {number} height - 窗的高度
     * @param {number} groundHeight - 窗的离地高度
     * @param {Object} options - 配置选项
     * @returns {THREE.Mesh} 窗mesh
     */
    static createWindow(points, height, groundHeight, options = {}) {
        const windowOptions = {
            color: 0x87CEEB,        // 天蓝色玻璃，现代玻璃风格
            opacity: 0.3,          // 更高透明度
            transparent: true,
            materialType: 'window',
            ...options
        };
        
        return this.createDoorWindow(points, height, groundHeight, windowOptions);
    }


    /**
     * 创建材质
     * @param {string} type - 类型 ('door' 或 'window')
     * @param {number} color - 颜色
     * @param {number} opacity - 透明度
     * @param {boolean} transparent - 是否透明
     * @returns {THREE.Material} 材质对象
     */
    static createMaterial(type, color, opacity, transparent) {
        // 创建基础材质
        const material = new THREE.MeshLambertMaterial({
            color: color,
            transparent: transparent,
            opacity: opacity,
            side: THREE.DoubleSide
        });

        return material;
    }

    /**
     * 批量创建门窗
     * @param {Array} doorData - 门数据数组
     * @param {Array} windowData - 窗数据数组
     * @returns {Object} {doors: Array, windows: Array}
     */
    static createDoorWindowBatch(doorData = [], windowData = []) {
        const doors = [];
        const windows = [];

        // 创建门
        doorData.forEach((door, index) => {
            try {
                console.log(`创建门 ${index}:`, { height: door.height, points: door.points?.length });
                const doorMesh = this.createDoor(door.points, door.height, {
                    userData: { doorIndex: index, typeId: door.typeId }
                });
                if (doorMesh) {
                    doorMesh.userData.doorIndex = index;
                    doorMesh.userData.typeId = door.typeId;
                    doors.push(doorMesh);
                }
            } catch (error) {
                console.error(`门 ${index} 创建失败:`, error);
            }
        });

        // 创建窗
        windowData.forEach((window, index) => {
            try {
                console.log(`创建窗 ${index}:`, { height: window.height, groundHeight: window.groundHeight, points: window.points?.length });
                const windowMesh = this.createWindow(
                    window.points, 
                    window.height, 
                    window.groundHeight,
                    {
                        userData: { windowIndex: index, typeId: window.typeId }
                    }
                );
                if (windowMesh) {
                    windowMesh.userData.windowIndex = index;
                    windowMesh.userData.typeId = window.typeId;
                    windows.push(windowMesh);
                }
            } catch (error) {
                console.error(`窗 ${index} 创建失败:`, error);
            }
        });

        return { doors, windows };
    }
}