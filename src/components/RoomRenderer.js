import * as THREE from 'three';
import { SUBTRACTION, ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { CSGMeshOperations } from '../utils/CSGMeshOperations.js';
import { WallFactory } from './WallFactory.js';
import { DoorWindowFactory } from './DoorWindowFactory.js';
import { FloorFactory } from './FloorFactory.js';

/**
 * CSG布尔运算操作类
 */
class CSGOperations {
    /**
     * 验证mesh是否有效
     * @param {THREE.Mesh} mesh - 要验证的mesh
     * @returns {boolean} 是否有效
     */
    static isValidMesh(mesh) {
        // 检查是否是Group类型（Group没有geometry）
        if (mesh instanceof THREE.Group) {
            console.warn("检测到Group对象，应该是Mesh对象");
            return false;
        }
        
        if (!mesh || !mesh.geometry) {
            return false;
        }
        
        const geometry = mesh.geometry;
        
        // 检查是否有position属性
        if (!geometry.attributes || !geometry.attributes.position) {
            return false;
        }
        
        // 检查position数据是否有效
        const positions = geometry.attributes.position;
        if (!positions.array || positions.count === 0) {
            return false;
        }
        
        // 检查是否有NaN或无穷大值
        for (let i = 0; i < positions.array.length; i++) {
            if (!isFinite(positions.array[i])) {
                return false;
            }
        }
        
        return true;
    }
    
    
    static subtract(meshA, meshB) {
        try {
            if (!this.isValidMesh(meshA) || !this.isValidMesh(meshB)) {
                throw new Error("输入几何体无效");
            }
            
            const evaluator = new Evaluator();
            const brushA = new Brush(meshA.geometry);
            const brushB = new Brush(meshB.geometry);
            
            const targetBrush = new Brush();
            evaluator.evaluate(brushA, brushB, SUBTRACTION, targetBrush);

            if (targetBrush.geometry && targetBrush.geometry.attributes.position.count > 0) {
                const resultMaterial = meshA.material.clone();
                const resultMesh = new THREE.Mesh(targetBrush.geometry, resultMaterial);
                
                // 保留原始mesh的userData（关键修复：解决挖洞后wallType丢失问题）
                if (meshA.userData) {
                    resultMesh.userData = { ...meshA.userData };
                    console.log('CSG减法（three-bvh-csg）：已保留原始mesh的userData:', resultMesh.userData);
                }
                
                return resultMesh;
            } else {
                throw new Error("CSG减法运算返回空几何体");
            }
            
        } catch (error) {
            console.error("CSG减法失败:", error);
            
            // 降级方案：返回原始meshA（不进行CSG操作）
            console.warn("CSG减法降级：返回原始meshA");
            return meshA;
        }
    }
    
    static union(meshA, meshB) {
        try {
            if (!this.isValidMesh(meshA) || !this.isValidMesh(meshB)) {
                console.error("CSG合并：输入几何体无效", {
                    meshA: !!meshA,
                    meshB: !!meshB,
                    meshAGeometry: !!meshA?.geometry,
                    meshBGeometry: !!meshB?.geometry,
                    meshAPositions: !!meshA?.geometry?.attributes?.position,
                    meshBPositions: !!meshB?.geometry?.attributes?.position
                });
                throw new Error("输入几何体无效");
            }
            
            const evaluator = new Evaluator();
            const brushA = new Brush(meshA.geometry);
            const brushB = new Brush(meshB.geometry);
            
            const targetBrush = new Brush();
            evaluator.evaluate(brushA, brushB, ADDITION, targetBrush);
            
            if (targetBrush.geometry && targetBrush.geometry.attributes.position.count > 0) {
                const resultMaterial = meshA.material.clone();
                const resultMesh = new THREE.Mesh(targetBrush.geometry, resultMaterial);
                
                // 保留原始mesh的userData
                if (meshA.userData) {
                    resultMesh.userData = { ...meshA.userData };
                    console.log('CSG并集（three-bvh-csg）：已保留原始mesh的userData:', resultMesh.userData);
                }
                
                return resultMesh;
            } else {
                throw new Error("CSG并集运算返回空几何体");
            }
            
        } catch (error) {
            console.error("CSG并集失败:", error);
            
            // 降级方案：返回原始meshA（不进行CSG操作）
            console.warn("CSG并集降级：返回原始meshA");
            return meshA;
        }
    }

    static Hollow_Intersection(meshA, meshB) {
        try {
            if (!this.isValidMesh(meshA) || !this.isValidMesh(meshB)) {
                throw new Error("输入几何体无效");
            }
            
            const evaluator = new Evaluator();
            const brushA = new Brush(meshA.geometry);
            const brushB = new Brush(meshB.geometry);
            
            const targetBrush = new Brush();
            evaluator.evaluate(brushA, brushB, HOLLOW_INTERSECTION , targetBrush);

            if (targetBrush.geometry && targetBrush.geometry.attributes.position.count > 0) {
                const resultMaterial = meshA.material.clone();
                return new THREE.Mesh(targetBrush.geometry, resultMaterial);
            } else {
                throw new Error("CSG减法运算返回空几何体");
            }
            
        } catch (error) {
            console.error("CSG减法失败:", error);
            
            // 降级方案：返回原始meshA（不进行CSG操作）
            console.warn("CSG减法降级：返回原始meshA");
            return meshA;
        }
    }


}

/**
 * 房间渲染器 - 负责渲染房间几何体和墙面
 */
export class RoomRenderer {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.getScene();
        
        // 全局变换参数
        this.globalScale = 1;
        this.globalCenterX = 0;
        this.globalCenterY = 0;
        this.isScaleSet = false;
        this.sceneGroup = null; // 用于整体缩放的场景组
        
        // CSG引擎配置
        this.csgEngine = options.csgEngine || 'three-bvh-csg'; // 'three-bvh-csg' 或 'three-csgmesh'
        this.csgEpsilon = options.csgEpsilon || 1e-5; // CSG运算误差
        
        // 初始化CSGMesh操作器（如果使用）
        if (this.csgEngine === 'three-csgmesh') {
            this.csgMeshOps = new CSGMeshOperations(this.csgEpsilon);
            console.log(`RoomRenderer使用THREE-CSGMesh引擎，epsilon=${this.csgEpsilon}`);
        } else {
            console.log('RoomRenderer使用three-bvh-csg引擎');
        }
    }

    /**
     * 设置CSG引擎配置
     * @param {string} engine - CSG引擎类型 ('three-bvh-csg' 或 'three-csgmesh')
     * @param {number} epsilon - CSG运算误差（仅对three-csgmesh有效）
     */
    setCSGEngine(engine, epsilon = 1e-5) {
        this.csgEngine = engine;
        this.csgEpsilon = epsilon;
        
        if (engine === 'three-csgmesh') {
            if (this.csgMeshOps) {
                this.csgMeshOps.setEpsilon(epsilon);
            } else {
                this.csgMeshOps = new CSGMeshOperations(epsilon);
            }
            console.log(`切换到THREE-CSGMesh引擎，epsilon=${epsilon}`);
        } else {
            console.log('切换到three-bvh-csg引擎');
        }
    }

    /**
     * 执行CSG减法运算（根据配置选择引擎）
     * @param {THREE.Mesh} meshA - 被减数mesh
     * @param {THREE.Mesh} meshB - 减数mesh
     * @returns {THREE.Mesh} 运算结果mesh
     */
    performCSGSubtraction(meshA, meshB) {
        if (this.csgEngine === 'three-csgmesh' && this.csgMeshOps) {
            return this.csgMeshOps.subtract(meshA, meshB);
        } else {
            return CSGOperations.subtract(meshA, meshB);
        }
    }

    /**
     * 执行CSG并集运算（根据配置选择引擎）
     * @param {THREE.Mesh} meshA - mesh A
     * @param {THREE.Mesh} meshB - mesh B
     * @returns {THREE.Mesh} 运算结果mesh
     */
    performCSGUnion(meshA, meshB) {
        if (this.csgEngine === 'three-csgmesh' && this.csgMeshOps) {
            return this.csgMeshOps.union(meshA, meshB);
        } else {
            return CSGOperations.union(meshA, meshB);
        }
    }

    /**
     * 执行批量CSG减法运算（根据配置选择引擎）
     * @param {THREE.Mesh} baseMesh - 基础mesh
     * @param {Array<THREE.Mesh>} subtractMeshes - 要减去的mesh数组
     * @returns {THREE.Mesh} 运算结果mesh
     */
    performBatchCSGSubtraction(baseMesh, subtractMeshes) {
        if (this.csgEngine === 'three-csgmesh' && this.csgMeshOps) {
            return this.csgMeshOps.batchSubtract(baseMesh, subtractMeshes);
        } else {
            // 使用原有的逐个减法方式
            let currentMesh = baseMesh;
            for (let i = 0; i < subtractMeshes.length; i++) {
                const subtractMesh = subtractMeshes[i];
                if (CSGOperations.isValidMesh(subtractMesh)) {
                    currentMesh = CSGOperations.subtract(currentMesh, subtractMesh);
                }
            }
            return currentMesh;
        }
    }

    /**
     * 渲染房间数据
     * @param {Object} data - 包含outline，rooms，doorwindows的数据
     * @param {Object} wallSelector - 墙面选择器实例
     * @returns {Promise<Object>} 渲染结果
     */
    async render(data, wallSelector) {
        try {
            const result = {
                outlineMesh: null,
                roomMeshes: [],
                wallMeshes: [],
                doorMeshes: [],
                windowMeshes: [],
                floorMeshes: []
            };

            // 如果场景组不存在，创建新的场景组用于整体缩放
            if (!this.sceneGroup) {
                this.sceneGroup = new THREE.Group();
                this.scene.add(this.sceneGroup);
            } else if (this.sceneGroup.children.length > 0) {
                // 如果场景组已存在且有内容，说明已经渲染过，直接返回
                console.log('3D场景已存在缓存，使用现有渲染结果');
                return result;
            }

            // 1. 创建外轮廓 mesh（但先不添加到场景）
            const outlinePoints = data.outline?.outlinePoints || data.outline;
            if (outlinePoints && outlinePoints.length > 0) {
                result.outlineMesh = this.createOutlineMesh(outlinePoints);
            }


            // 2. 创建真正的门窗mesh
            let doorWindowMeshes = { doors: [], windows: [] };
            if (data.doorWindows) {
                doorWindowMeshes = this.createDoorWindowMeshes(data.doorWindows.doors, data.doorWindows.windows);
                result.doorMeshes = doorWindowMeshes.doors;
                result.windowMeshes = doorWindowMeshes.windows;
            }
            console.log(result.windowMeshes);

            // 3. 创建用于挖门窗的 mesh，这里得到的mesh只用于挖洞，而不用于渲染，
            // 因为这里扩大了一定的宽度，避免有些墙体挖不透，因为float类型存在误差；
            let doorWindowSubMeshes = { doors: [], windows: [] };
            if (data.doorWindows) {
                doorWindowSubMeshes = this.createDoorWindowMeshes(data.doorWindows.processed_doors, data.doorWindows.processed_windows);
            }
            console.log(doorWindowSubMeshes);


            // 3. 创建房间 mesh 用于布尔运算
            let roomMeshes = [];
            if (data.rooms && data.rooms.roomPoints) {
                roomMeshes = this.createRoomMeshes(data.rooms.roomPoints, 2800);
                result.roomMeshes = roomMeshes;
            }

            // 创建地板mesh
            let floorMeshes = [];
            if (data.rooms && data.rooms.roomPoints) {
                floorMeshes = FloorFactory.createFloorMeshes(data.rooms.roomPoints, 0);
                result.floorMeshes = floorMeshes;
            }
            for(let i=0;i<floorMeshes.length;i++)
                this.sceneGroup.add(floorMeshes[i]);
            wallSelector.addWalls(floorMeshes);

            // 4. 显示基础场景，挖除门窗和房间；
            if (result.outlineMesh) {
                // 先挖去房间（这个通常很快）
                let baseMesh = result.outlineMesh;
                if (roomMeshes.length > 0) {
                    baseMesh = this.performCSGRoomSubtraction(baseMesh, roomMeshes);
                }
                
                if (baseMesh) {
                    // 同步执行门窗挖洞，逐个处理
                    if (doorWindowMeshes.doors.length > 0 || doorWindowMeshes.windows.length > 0) {
                        console.log(doorWindowMeshes);
                        const finalMesh = this.performSynchronousDoorWindowSubtraction(baseMesh, doorWindowMeshes);
                        if (finalMesh) {
                
                            this.sceneGroup.add(finalMesh);
                            result.finalMesh = finalMesh;
                        } else {
                            // 挖洞失败，使用原始mesh
                            this.sceneGroup.add(baseMesh);
                            result.finalMesh = baseMesh;
                        }
                    } else {
                        // 没有门窗需要挖洞
                        this.sceneGroup.add(baseMesh);
                        result.finalMesh = baseMesh;
                    }
                } else {
                    // 降级方案：显示原始几何体
                    this.sceneGroup.add(result.outlineMesh);
                    roomMeshes.forEach(mesh => {
                        if (mesh) this.sceneGroup.add(mesh);
                    });
                }
            }

            this.csgEngine = "three-bvh-csg";

            // 5. 渲染墙面
            if (data.rooms && data.rooms.roomPoints) {
                result.wallMeshes = this.createWallMeshes(data.rooms.roomPoints);
                
                // 从墙面挖除门窗     
                result.wallMeshes.forEach((wallMesh, wallIndex) => {
                    if (wallMesh) {
                        // 找到与当前墙面相交的门窗
                        const intersectingDoorWindows = this.findIntersectingDoorWindows(wallMesh, doorWindowSubMeshes);
                        
                        if (intersectingDoorWindows.doors.length > 0 || intersectingDoorWindows.windows.length > 0) {
                            const finalMesh = this.performWallDoorWindowSubtraction(wallMesh, intersectingDoorWindows);
                            if (finalMesh) {
                                this.sceneGroup.add(finalMesh);
                                wallSelector.addWall(finalMesh);
                            } else {
                                // 挖洞失败，使用原始mesh
                                this.sceneGroup.add(wallMesh);
                                wallSelector.addWall(wallMesh);
                            }
                        } else {
                            // 没有门窗需要挖洞
                            this.sceneGroup.add(wallMesh);
                            wallSelector.addWall(wallMesh);
                        }
                        // wallMesh.userData.type='wall';
                    }
                });
                
                // 单独添加门窗（不挖洞）
                if (doorWindowMeshes.doors) {
                    doorWindowMeshes.doors.forEach(mesh => {
                        if (mesh && CSGOperations.isValidMesh(mesh)) {
                            this.sceneGroup.add(mesh);
                            wallSelector.addWall(mesh);
                        }
                    });

                }
                if (doorWindowMeshes.windows) {
                    doorWindowMeshes.windows.forEach(mesh => {
                        if (mesh && CSGOperations.isValidMesh(mesh)) {
                            this.sceneGroup.add(mesh);
                            wallSelector.addWall(mesh);
                        }
                    });
                }
            }
            // 因为对外墙挖洞，返回的实例对象其实已经不是原来的mesh啦，
            // 所以之前的一些userData全都不存在啦，我们需要自己再设置；
            result.outlineMesh.userData.type="outWall";

            // 7. 调整相机视角
            this.adjustCamera();

            return result;

        } catch (error) {
            console.error('房间渲染失败:', error);
            throw error;
        }
    }

    /**
     * 创建外轮廓mesh
     * @param {Array} outlinePoints - 外轮廓点数组
     * @returns {THREE.Mesh} 外轮廓mesh
     */
    createOutlineMesh(outlinePoints) {
        try {
            const convertedPoints = this.convertPointFormat(outlinePoints);

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
                depth: 2800,  // 设置为200mm厚度，与墙体高度成比例
                bevelEnabled: false
            };

            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geometry.computeVertexNormals();

            const material = new THREE.MeshLambertMaterial({
                color: 0xcccccc,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            
            // 将outlineMesh稍微下移，确保wallMesh在其上方，避免Z-fighting
            mesh.position.z = -2;
            
            return mesh;

        } catch (error) {
            console.error('外轮廓创建失败:', error);
            return null;
        }
    }

    /**
     * 创建房间meshes（用于CSG布尔运算）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @returns {Array} 房间mesh数组
     */
    createRoomMeshes(roomPointsArray, height) {
        const roomMeshes = [];

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
                    polygonOffsetFactor:-2,
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.roomIndex = index;
                roomMeshes.push(mesh);

            } catch (error) {
                console.error(`房间 ${index} 创建失败:`, error);
            }
        });

        return roomMeshes;
    }

    /**
     * 执行CSG减法运算（从外轮廓中挖去所有房间）
     * @param {THREE.Mesh} outlineMesh - 外轮廓mesh
     * @param {Array} roomMeshes - 房间mesh数组
     * @returns {THREE.Mesh|null} 挖洞后的最终mesh
     */
    performCSGRoomSubtraction(outlineMesh, roomMeshes) {
        try {
            console.log(`开始CSG布尔运算，挖去${roomMeshes.length}个房间...`);
            

            for(let i=0;i<roomMeshes.length;i++){
                outlineMesh = this.performCSGSubtraction(outlineMesh, roomMeshes[i]);
            }
            if (outlineMesh) {
                console.log("户型Room挖洞成功");
                return outlineMesh;
            } else {
                    console.error("CSG减法运算失败");
                    return null;
                }
            } catch (error) {
            console.error("CSG布尔运算异常:", error);
            return null;
        }
    }

    /**
     * 合并所有门窗mesh为一个mesh
     * @param {Array} doorWindowMeshes - 门窗mesh数组
     * @returns {THREE.Mesh|null} 合并后的mesh
     */
    combineDoorWindowMeshes(doorWindowMeshes) {
        try {
            // 过滤出有效的mesh
            const validMeshes = doorWindowMeshes.filter(mesh => {
                const isValid = CSGOperations.isValidMesh(mesh);
                if (!isValid) {
                    console.warn("发现无效的门窗mesh，跳过", mesh);
                }
                return isValid;
            });
            
            if (validMeshes.length === 0) {
                console.warn("没有有效的门窗mesh");
                return null;
            }
            
            if (validMeshes.length === 1) {
                console.log("只有一个有效门窗mesh，直接返回");
                return validMeshes[0];
            }

            console.log(`开始合并${validMeshes.length}个有效门窗mesh...`);
            
            let combinedMesh = validMeshes[0];
            
            for (let i = 1; i < validMeshes.length; i++) {
                const doorWindowMesh = validMeshes[i];
                if (doorWindowMesh && combinedMesh) {
                    try {
                        const newCombined = this.performCSGUnion(combinedMesh, doorWindowMesh);
                        if (newCombined) {
                            combinedMesh = newCombined;
                            console.log(`合并门窗 ${i + 1}/${validMeshes.length}`);
                        } else {
                            console.warn(`门窗 ${i + 1} 合并失败，跳过`);
                        }
                    } catch (error) {
                        console.error(`门窗 ${i + 1} 合并出现异常，跳过:`, error);
                    }
                }
            }
            
            console.log(`门窗合并完成，原始数量: ${doorWindowMeshes.length}，有效数量: ${validMeshes.length}`);
            return combinedMesh;
            
        } catch (error) {
            console.error("门窗合并异常:", error);
            // 返回第一个有效的mesh作为降级方案
            const firstValid = doorWindowMeshes.find(mesh => CSGOperations.isValidMesh(mesh));
            return firstValid || null;
        }
    }


    /**
     * 同步门窗挖洞 - 逐个挖洞处理
     * @param {THREE.Mesh} baseMesh - 基础mesh
     * @param {Object} doorWindowMeshes - 门窗mesh对象 {doors: [], windows: []}
     * @returns {THREE.Mesh|null} 挖洞后的最终mesh
     */
    performSynchronousDoorWindowSubtraction(baseMesh, doorWindowMeshes) {
        try {
            console.log("开始同步门窗挖洞...");
            
            const allDoorWindowMeshes = [...doorWindowMeshes.doors, ...doorWindowMeshes.windows];
            console.log(`总共需要挖洞: ${allDoorWindowMeshes.length} 个门窗`);
            
            // 详细检查每个门窗mesh的位置信息
            allDoorWindowMeshes.forEach((mesh, index) => {
                console.log(`门窗 ${index + 1}:`, {
                    position: mesh.position,
                    geometryBounds: mesh.geometry.boundingBox,
                    type: mesh.userData?.type || 'unknown'
                });
            });
            
            let currentMesh = baseMesh;
            let successCount = 0;
            
            // 逐个进行挖洞操作
            for (let i = 0; i < allDoorWindowMeshes.length; i++) {
                const doorWindowMesh = allDoorWindowMeshes[i];
                
                if (!doorWindowMesh || !CSGOperations.isValidMesh(doorWindowMesh)) {
                    console.warn(`跳过无效的门窗mesh ${i + 1}`);
                    continue;
                }
                
                console.log(`挖洞进度: ${i + 1}/${allDoorWindowMeshes.length}`);
                
                try {
                    // 检查是否为弧形窗户（可能导致性能问题）
                    const isArcWindow = doorWindowMesh.userData?.hasArc || false;
                    const pointCount = doorWindowMesh.userData?.pointCount || 0;
                    if (isArcWindow) {
                        console.log(`门窗 ${i + 1} 是弧形窗户，点数: ${pointCount}，开始特殊处理...`);
                    }
                    
                    // 检查几何体复杂度
                    const vertexCount = doorWindowMesh.geometry.attributes.position.count;
                    const faceCount = doorWindowMesh.geometry.index ? doorWindowMesh.geometry.index.count / 3 : vertexCount / 3;
                    console.log(`门窗 ${i + 1} 几何体信息: 顶点数=${vertexCount}, 面数=${faceCount}, 是否弧形=${isArcWindow}`);
                    
                    const startTime = performance.now();
                    
                    // 检查门窗mesh是否需要应用变换
                    let transformedMesh = doorWindowMesh;
                    
                    // 如果mesh有位置偏移，需要将变换应用到几何体
                    if (doorWindowMesh.position.x !== 0 || doorWindowMesh.position.y !== 0 || doorWindowMesh.position.z !== 0) {
                        console.log(`门窗 ${i + 1} 需要应用位置变换:`, doorWindowMesh.position);
                        transformedMesh = this.applyMeshTransformToGeometry(doorWindowMesh);
                    }
                    
                    // 执行CSG操作，对于弧形窗户设置超时检测
                    const newMesh = this.performCSGSubtraction(currentMesh, transformedMesh);
                    const endTime = performance.now();
                    const operationTime = endTime - startTime;
                    
                    console.log(`门窗 ${i + 1} CSG操作耗时: ${operationTime.toFixed(2)}ms`);
                    
                    // 如果操作时间过长，记录警告
                    if (operationTime > 5000) { // 5秒
                        console.warn(`门窗 ${i + 1} CSG操作耗时过长: ${operationTime.toFixed(2)}ms`);
                    }
                    
                    if (newMesh && CSGOperations.isValidMesh(newMesh)) {
                        currentMesh = newMesh;
                        successCount++;
                        console.log(`门窗 ${i + 1} 挖洞成功`);
                    } else {
                        console.warn(`门窗 ${i + 1} 挖洞失败，继续下一个`);
                    }
                } catch (error) {
                    console.error(`门窗 ${i + 1} 挖洞异常:`, error);
                }
            }
            
            console.log(`门窗挖洞完成，成功: ${successCount}/${allDoorWindowMeshes.length}`);
            return currentMesh;
            
        } catch (error) {
            console.error("同步门窗挖洞异常:", error);
            return null;
        }
    }

    // /**
    //  * 渐进式对户型mesh门窗挖洞 - 异步逐步挖洞并实时更新显示 (已弃用)
    //  * @param {THREE.Mesh} baseMesh - 基础mesh
    //  * @param {Object} doorWindowMeshes - 门窗mesh对象
    //  * @param {Object} result - 渲染结果对象
    //  */
    // async performProgressiveDoorWindowSubtraction(baseMesh, doorWindowMeshes, result) {
    //     try {
    //         console.log("开始渐进式门窗挖洞...");
            
    //         const allDoorWindowMeshes = [...doorWindowMeshes.doors, ...doorWindowMeshes.windows];
    //         const batchSize = 3; // 每批处理3个门窗
            
    //         let currentMesh = baseMesh;
            
    //         // 分批异步处理
    //         for (let i = 0; i < allDoorWindowMeshes.length; i += batchSize) {
    //             // 使用setTimeout让出控制权，避免阻塞UI
    //             await new Promise(resolve => setTimeout(resolve, 10));

    //             const batch = allDoorWindowMeshes.slice(i, i + batchSize);
    //             console.log(`渐进式挖洞: 处理第 ${Math.floor(i/batchSize) + 1} 批，包含 ${batch.length} 个门窗`);
    //             let newMesh = {};
    //             for (let j = 0; j < batch.length; j++) { 
    //                 newMesh = CSGOperations.subtract(currentMesh, batch[j]);
    //                 currentMesh = newMesh;
    //             }
    //             if (newMesh) {
    //                 // 从场景中移除旧mesh，添加新mesh
    //                 this.sceneGroup.remove(result.finalMesh);
    //                 this.sceneGroup.add(newMesh);
                    
    //                 currentMesh = newMesh;
    //                 result.finalMesh = newMesh;
                    
    //                 console.log(`渐进式挖洞: 批次 ${Math.floor(i/batchSize) + 1} 完成，已挖洞 ${Math.min(i + batchSize, allDoorWindowMeshes.length)}/${allDoorWindowMeshes.length} 个门窗`);
                    
    //                 // 通知外部更新进度（如果需要）
    //                 this.onProgressUpdate?.(Math.min(i + batchSize, allDoorWindowMeshes.length), allDoorWindowMeshes.length);
    //             } else {
    //                 console.warn(`渐进式挖洞: 批次 ${Math.floor(i/batchSize) + 1} 失败，跳过`);
    //             }
    //         }
            
    //         // 通知完成
    //         console.log("门窗挖洞全部完成");
    //         this.onProgressUpdate?.(allDoorWindowMeshes.length, allDoorWindowMeshes.length);
    //         this.onRenderComplete?.();
            
    //     } catch (error) {
    //         console.error("渐进式门窗挖洞异常:", error);
    //         this.onRenderComplete?.();
    //     }
    // }

    /**
     * 找到与指定墙面相交的门窗（两级检测：边界框预筛选 + CSG交集精确验证）
     * @param {THREE.Mesh} wallMesh - 墙面mesh
     * @param {Object} allDoorWindows - 所有门窗 {doors: [], windows: []}
     * @returns {Object} 相交的门窗 {doors: [], windows: []}
     */
    findIntersectingDoorWindows(wallMesh, allDoorWindows) {
        const intersectingDoors = [];
        const intersectingWindows = [];
        
        try {
            // 计算墙面边界框
            wallMesh.geometry.computeBoundingBox();
            const wallBounds = wallMesh.geometry.boundingBox.clone();
            wallBounds.applyMatrix4(wallMesh.matrixWorld);
            
            console.log(`开始两级相交检测，墙面边界框:`, wallBounds);
            
            // 检查门
            for (let i = 0; i < allDoorWindows.doors.length; i++) {
                const doorMesh = allDoorWindows.doors[i];
                const intersectionResult = this.preciseIntersectionCheck(wallMesh, doorMesh, wallBounds, '门', i + 1);
                
                if (intersectionResult) {
                    intersectingDoors.push(doorMesh);
                }
            }
            
            // 检查窗
            for (let i = 0; i < allDoorWindows.windows.length; i++) {
                const windowMesh = allDoorWindows.windows[i];
                const intersectionResult = this.preciseIntersectionCheck(wallMesh, windowMesh, wallBounds, '窗', i + 1);
                
                if (intersectionResult) {
                    intersectingWindows.push(windowMesh);
                }
            }
            
            console.log(`相交检测完成: ${intersectingDoors.length}个门, ${intersectingWindows.length}个窗`);
            
        } catch (error) {
            console.error('查找相交门窗时出错:', error);
        }
        
        return { doors: intersectingDoors, windows: intersectingWindows };
    }
    
    /**
     * 精确的相交检测（两级检测）
     * @param {THREE.Mesh} wallMesh - 墙面mesh
     * @param {THREE.Mesh} doorWindowMesh - 门窗mesh
     * @param {THREE.Box3} wallBounds - 墙面边界框
     * @param {string} type - 门窗类型（用于日志）
     * @param {number} index - 门窗索引（用于日志）
     * @returns {Object} 检测结果 intersects: boolean
     */
    preciseIntersectionCheck(wallMesh, doorWindowMesh, wallBounds, type, index) {
        try {
            // 第一级：边界框预筛选
            const boundingBoxResult = this.boundingBoxIntersectionCheck(doorWindowMesh, wallBounds);
            
            if (!boundingBoxResult.intersects) {
                // 边界框都不相交，肯定不相交
                console.log(`${type}${index}: 边界框不相交，跳过`);
                return false;
            }
            return true;
            console.log(`${type}${index}: 边界框相交，进行CSG精确检测...`);
            
            // 第二级：BVH边界相交面积精确验证
            // const csgResult = this.csgIntersectionCheck(wallMesh, doorWindowMesh);
            
            // if (csgResult.intersects) {
            //     console.log(`${type}${index}: BVH面积检测确认相交，交集面积=${csgResult.intersectionArea.toFixed(2)}平方毫米`);
            //     return csgResult;
            // } else {
            //     console.log(`${type}${index}: BVH面积检测显示不相交或交集面积过小`);
            //     return { intersects: false, intersectionArea: csgResult.intersectionArea };
            // }
            
        } catch (error) {
            console.error(`${type}${index}精确相交检测失败:`, error);
            // 发生错误时，保守地认为相交（避免漏挖）
            return true;
        }
    }
    
    /**
     * 边界框相交检测
     * @param {THREE.Mesh} doorWindowMesh - 门窗mesh
     * @param {THREE.Box3} wallBounds - 墙面边界框
     * @returns {Object} 检测结果
     */
    boundingBoxIntersectionCheck(doorWindowMesh, wallBounds) {
        try {
            // 计算门窗边界框
            doorWindowMesh.geometry.computeBoundingBox();
            const dwBounds = doorWindowMesh.geometry.boundingBox.clone();
            
            // 应用门窗的变换矩阵到边界框
            dwBounds.applyMatrix4(doorWindowMesh.matrixWorld);
            
            // 3D边界框相交检测
            const intersects = wallBounds.intersectsBox(dwBounds);
            
            // 计算重叠体积（粗略估算）
            let overlapVolume = 0;
            if (intersects) {
                const intersection = wallBounds.clone().intersect(dwBounds);
                if (!intersection.isEmpty()) {
                    const size = intersection.getSize(new THREE.Vector3());
                    overlapVolume = size.x * size.y * size.z;
                }
            }
            
            return { intersects, overlapVolume };
            
        } catch (error) {
            console.error('边界框相交检测失败:', error);
            return { intersects: false, overlapVolume: 0 };
        }
    }
    
    // /**
    //  * 使用three-mesh-bvh边界相交面积检测（专用于墙面薄片几何体）
    //  * @param {THREE.Mesh} wallMesh - 墙面mesh
    //  * @param {THREE.Mesh} doorWindowMesh - 门窗mesh
    //  * @returns {Object} 检测结果 {intersects: boolean, intersectionArea: number}
    //  */
    // edgeIntersectionAreaCheck(wallMesh, doorWindowMesh) {
    //     try {
    //         // 确保几何体有BVH树
    //         if (!wallMesh.geometry.boundsTree) {
    //             wallMesh.geometry.boundsTree = new MeshBVH(wallMesh.geometry, {
    //                 maxLeafTris: 1,
    //                 strategy: SAH
    //             });
    //         }
            
    //         if (!doorWindowMesh.geometry.boundsTree) {
    //             doorWindowMesh.geometry.boundsTree = new MeshBVH(doorWindowMesh.geometry, {
    //                 maxLeafTris: 1,
    //                 strategy: SAH
    //             });
    //         }
            
    //         // 计算变换矩阵 - 将门窗坐标系转换到墙面坐标系
    //         const wallMatrixInverse = wallMesh.matrixWorld.clone().invert();
    //         const doorWindowToWallMatrix = doorWindowMesh.matrixWorld.clone()
    //             .premultiply(wallMatrixInverse);
            
    //         const intersections = [];
    //         const edge = new THREE.Line3();
    //         let totalIntersectionArea = 0;
            
    //         // 执行BVH相交检测
    //         wallMesh.geometry.boundsTree.bvhcast(
    //             doorWindowMesh.geometry.boundsTree, 
    //             doorWindowToWallMatrix, 
    //             {
    //                 intersectsTriangles: (wallTriangle, doorWindowTriangle) => {
    //                     // 检测两个三角形是否相交
    //                     if (wallTriangle.intersectsTriangle(doorWindowTriangle, edge)) {
    //                         // 计算相交边长度
    //                         const edgeLength = edge.start.distanceTo(edge.end);
                            
    //                         if (edgeLength > 0.1) { // 最小边长阈值 0.1mm，过滤噪点
    //                             // 估算相交面积：基于相交边长度
    //                             const wallTriArea = this.getTriangleArea(wallTriangle);
    //                             const dwTriArea = this.getTriangleArea(doorWindowTriangle);
                                
    //                             // 使用相交边与三角形的关系来估算相交面积
    //                             const avgTriangleSize = Math.sqrt((wallTriArea + dwTriArea) / 2);
    //                             const intersectionArea = edgeLength * Math.sqrt(avgTriangleSize) * 0.2;
                                
    //                             intersections.push({
    //                                 edgeLength: edgeLength,
    //                                 area: intersectionArea,
    //                                 start: edge.start.clone(),
    //                                 end: edge.end.clone(),
    //                                 wallTriArea: wallTriArea,
    //                                 dwTriArea: dwTriArea
    //                             });
                                
    //                             totalIntersectionArea += intersectionArea;
    //                         }
    //                     }
    //                     return false; // 继续检测所有相交
    //                 }
    //             }
    //         );
            
    //         // 面积阈值：根据实际情况调整
    //         // 对于门窗相交，50平方厘米是合理的最小面积
    //         const areaThreshold = 0; // 50平方厘米 = 500,000平方毫米
    //         const intersects = totalIntersectionArea > areaThreshold;
            
    //         console.log(`BVH边界相交面积检测: 相交边数量=${intersections.length}, 总面积=${totalIntersectionArea.toFixed(2)}平方毫米, 阈值=${areaThreshold}, 结果=${intersects}`);
            
    //         if (intersections.length > 0) {
    //             console.log(`前3个相交详情:`, intersections.slice(0, 3).map(int => ({
    //                 边长: int.edgeLength.toFixed(2),
    //                 面积: int.area.toFixed(2),
    //                 墙三角形面积: int.wallTriArea.toFixed(2),
    //                 门窗三角形面积: int.dwTriArea.toFixed(2)
    //             })));
    //         }
            
    //         return { 
    //             intersects, 
    //             intersectionArea: totalIntersectionArea,
    //             intersectionCount: intersections.length,
    //             intersectionDetails: intersections
    //         };
            
    //     } catch (error) {
    //         console.error('BVH边界相交面积检测失败:', error);
    //         // 发生错误时保守地认为相交
    //         return { intersects: true, intersectionArea: -1, intersectionCount: 0 };
    //     }
    // }

    // /**
    //  * 计算三角形面积
    //  * @param {THREE.Triangle} triangle - 三角形对象
    //  * @returns {number} 面积（平方毫米）
    //  */
    // getTriangleArea(triangle) {
    //     try {
    //         const v1 = new THREE.Vector3().subVectors(triangle.b, triangle.a);
    //         const v2 = new THREE.Vector3().subVectors(triangle.c, triangle.a);
    //         return v1.cross(v2).length() * 0.5;
    //     } catch (error) {
    //         return 0;
    //     }
    // }

    // /**
    //  * BVH边界相交面积检测（精确验证） - 专用于墙面薄片几何体
    //  * @param {THREE.Mesh} wallMesh - 墙面mesh
    //  * @param {THREE.Mesh} doorWindowMesh - 门窗mesh
    //  * @returns {Object} 检测结果 {intersects: boolean, intersectionArea: number}
    //  */
    // csgIntersectionCheck(wallMesh, doorWindowMesh) {
    //     try {
    //         // 应用门窗的坐标变换
    //         let transformedDoorWindow = doorWindowMesh;
    //         if (doorWindowMesh.position.x !== 0 || doorWindowMesh.position.y !== 0 || doorWindowMesh.position.z !== 0) {
    //             transformedDoorWindow = this.applyMeshTransformToGeometry(doorWindowMesh);
    //         }
            
    //         // 墙面都是薄片，直接使用BVH边界相交面积检测
    //         console.log('墙面薄片几何体，使用BVH边界相交面积检测');
    //         return this.edgeIntersectionAreaCheck(wallMesh, transformedDoorWindow);
            
    //     } catch (error) {
    //         console.error('精确相交检测失败:', error);
    //         return { intersects: false, intersectionArea: 0 };
    //     }
    // }
    
    /**
     * 执行CSG交集运算
     * @param {THREE.Mesh} meshA - 网格A
     * @param {THREE.Mesh} meshB - 网格B
     * @returns {THREE.Mesh|null} 交集网格
     */
    performCSGIntersection(meshA, meshB) {
        try {
            if (!CSGOperations.isValidMesh(meshA) || !CSGOperations.isValidMesh(meshB)) {
                return null;
            }
            
            // 使用three-bvh-csg进行交集运算
            const evaluator = new Evaluator();
            const brushA = new Brush(meshA.geometry);
            const brushB = new Brush(meshB.geometry);
            const targetBrush = new Brush();
            
            // 执行交集运算（INTERSECTION）
            // 使用 three-bvh-csg 的常量，通常 INTERSECTION = 2
            const INTERSECTION_OP = 2; // three-bvh-csg 中的交集操作常量
            evaluator.evaluate(brushA, brushB, INTERSECTION_OP, targetBrush);
            
            if (targetBrush.geometry && targetBrush.geometry.attributes.position.count > 0) {
                const material = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
                return new THREE.Mesh(targetBrush.geometry, material);
            }
            
            return null;
            
        } catch (error) {
            console.error('CSG交集运算失败:', error);
            return null;
        }
    }
    
    /**
     * 计算网格体积（近似）
     * @param {THREE.Mesh} mesh - 网格对象
     * @returns {number} 体积（立方毫米）
     */
    calculateMeshVolume(mesh) {
        try {
            if (!mesh || !mesh.geometry) {
                return 0;
            }
            
            // 方法1: 使用边界框估算体积（快速但不精确）
            mesh.geometry.computeBoundingBox();
            const box = mesh.geometry.boundingBox;
            const size = box.getSize(new THREE.Vector3());
            const boundingBoxVolume = size.x * size.y * size.z;
            
            // 方法2: 对于简单几何体，可以使用更精确的体积计算
            // 这里使用边界框体积的估算系数
            const geometryType = this.detectGeometryType(mesh);
            let volumeCoefficient = 1.0;
            
            switch (geometryType) {
                case 'box':
                    volumeCoefficient = 1.0; // 立方体
                    break;
                case 'cylinder':
                    volumeCoefficient = 0.785; // π/4 ≈ 0.785
                    break;
                case 'complex':
                    volumeCoefficient = 0.6; // 复杂几何体估算
                    break;
                default:
                    volumeCoefficient = 0.8; // 一般几何体估算
            }
            
            const estimatedVolume = boundingBoxVolume * volumeCoefficient;
            
            console.log(`体积计算: 边界框体积=${boundingBoxVolume.toFixed(2)}, 系数=${volumeCoefficient}, 估算体积=${estimatedVolume.toFixed(2)}`);
            
            return estimatedVolume;
            
        } catch (error) {
            console.error('体积计算失败:', error);
            return 0;
        }
    }
    
    /**
     * 检测几何体类型
     * @param {THREE.Mesh} mesh - 网格对象
     * @returns {string} 几何体类型
     */
    detectGeometryType(mesh) {
        try {
            const vertexCount = mesh.geometry.attributes.position.count;
            
            // 根据顶点数和用户数据判断几何体类型
            if (mesh.userData?.wallType) {
                return 'box'; // 墙面通常是长方体
            }
            
            if (mesh.userData?.type === 'door' || mesh.userData?.type === 'window') {
                if (mesh.userData?.hasArc) {
                    return 'complex'; // 弧形门窗
                } else {
                    return 'box'; // 矩形门窗
                }
            }
            
            // 根据顶点数简单判断
            if (vertexCount <= 24) {
                return 'box'; // 简单立方体
            } else if (vertexCount <= 100) {
                return 'cylinder'; // 圆柱体或简单曲面
            } else {
                return 'complex'; // 复杂几何体
            }
            
        } catch (error) {
            return 'complex';
        }
    }
    
    /**
     * 专门针对墙面的门窗挖洞函数
     * @param {THREE.Mesh} wallMesh - 墙面mesh
     * @param {Object} doorWindowMeshes - 相交的门窗mesh {doors: [], windows: []}
     * @returns {THREE.Mesh|null} 挖洞后的墙面mesh
     */
    performWallDoorWindowSubtraction(wallMesh, doorWindowMeshes) {
        try {
            console.log("开始墙面门窗挖洞...");
            
            const allDoorWindowMeshes = [...doorWindowMeshes.doors, ...doorWindowMeshes.windows];
            console.log(`墙面需要挖洞: ${allDoorWindowMeshes.length} 个门窗`);
            
            if (allDoorWindowMeshes.length === 0) {
                return wallMesh;
            }
            
            let currentMesh = wallMesh;
            let successCount = 0;
            
            // 逐个进行挖洞操作
            for (let i = 0; i < allDoorWindowMeshes.length; i++) {
                const doorWindowMesh = allDoorWindowMeshes[i];
                
                if (!doorWindowMesh || !CSGOperations.isValidMesh(doorWindowMesh)) {
                    console.warn(`跳过无效的门窗mesh ${i + 1}`);
                    continue;
                }
                
                
                try {
                    // 应用门窗变换到几何体
                    let transformedMesh = doorWindowMesh;
                    if (doorWindowMesh.position.x !== 0 || doorWindowMesh.position.y !== 0 || doorWindowMesh.position.z !== 0) {
                        transformedMesh = this.applyMeshTransformToGeometry(doorWindowMesh);
                    }
                    
                    // 执行CSG减法操作
                    const newMesh = this.performCSGSubtraction(currentMesh, transformedMesh);
                    
                    if (newMesh && CSGOperations.isValidMesh(newMesh)) {
                        currentMesh = newMesh;
                        successCount++;
                    }
                } catch (error) {
                    console.error(`门窗 ${i + 1} 墙面挖洞异常:`, error);
                }
            }
            
            return currentMesh;
            
        } catch (error) {
            console.error("墙面门窗挖洞异常:", error);
            return null;
        }
    }


    /**
     * 将mesh的变换应用到几何体，创建新的已变换mesh
     * @param {THREE.Mesh} mesh - 原始mesh
     * @returns {THREE.Mesh} 应用变换后的新mesh
     */

    applyMeshTransformToGeometry(mesh) {
        try {
            // 克隆几何体
            const geometry = mesh.geometry.clone();
            
            // 应用位置变换
            if (mesh.position.x !== 0 || mesh.position.y !== 0 || mesh.position.z !== 0) {
                geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z);
            }
            
            // 应用旋转变换
            if (mesh.rotation.x !== 0 || mesh.rotation.y !== 0 || mesh.rotation.z !== 0) {
                geometry.rotateX(mesh.rotation.x);
                geometry.rotateY(mesh.rotation.y);
                geometry.rotateZ(mesh.rotation.z);
            }
            
            // 应用缩放变换
            if (mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1) {
                geometry.scale(mesh.scale.x, mesh.scale.y, mesh.scale.z);
            }
            
            // 重新计算几何体属性
            geometry.computeBoundingBox();
            geometry.computeVertexNormals();
            
            // 创建新mesh（位置重置为原点，因为变换已应用到几何体）
            const transformedMesh = new THREE.Mesh(geometry, mesh.material);
            transformedMesh.position.set(0, 0, 0);
            transformedMesh.rotation.set(0, 0, 0);
            transformedMesh.scale.set(1, 1, 1);
            
            // 复制用户数据
            transformedMesh.userData = { ...mesh.userData, transformed: true };
            
            return transformedMesh;
            
        } catch (error) {
            console.error('应用几何体变换失败:', error);
            return mesh; // 返回原始mesh作为降级方案
        }
    }

    /**
     * 设置进度更新回调
     * @param {Function} callback - 进度回调函数 (current, total) => {}
     */
    setProgressCallback(callback) {
        this.onProgressUpdate = callback;
    }

    /**
     * 设置渲染完成回调
     * @param {Function} callback - 完成回调函数
     */
    setRenderCompleteCallback(callback) {
        this.onRenderComplete = callback;
    }

    /**
     * 创建带门窗挖洞的墙面meshes（优化版本 - 先合并墙面再挖洞）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @param {Object} doorWindowMeshes - 门窗mesh对象 {doors: [], windows: []}
     * @returns {Array} 墙面mesh数组
     */
    createWallMeshesWithDoorWindows(roomPointsArray, doorWindowMeshes) {
        try {
            console.log("开始创建优化的墙面mesh...");
            
            // 1. 先创建所有原始墙面mesh
            const originalWallMeshes = [];
            
            roomPointsArray.forEach((roomPoints, roomIndex) => {
                try {
                    const segments = WallFactory.analyzeWallSegments(roomPoints);
                    
                    segments.forEach(segment => {
                        let wallMesh = null;

                        if (segment.type === 'arc') {
                            // 弧形墙面
                            const points = segment.points.map(point => [
                                point[0],
                                point[1],
                                0
                            ]);

                            wallMesh = WallFactory.createArcWall(points, {
                                color: 0xF8F8F8,  // 专业的浅灰白色
                                height: 2800
                            });
                            
                            // 设置弧形墙面位置稍微向上偏移，避免Z-fighting
                            if (wallMesh) {
                                wallMesh.position.z += 5; // 增大Z偏移，避免与outlineMesh的Z-fighting
                            }

                        } else {
                            // 直线墙面
                            const startPoint = [
                                segment.startPoint[0],
                                segment.startPoint[1],
                                0
                            ];
                            const endPoint = [
                                segment.endPoint[0],
                                segment.endPoint[1],
                                0
                            ];

                            wallMesh = WallFactory.createStraightWall(startPoint, endPoint, {
                                color: 0xF8F8F8,  // 专业的浅灰白色
                                height: 2800
                            });
                            
                            // 设置墙面位置稍微向上偏移，避免Z-fighting
                            if (wallMesh) {
                                wallMesh.position.z += 5; // 增大Z偏移，避免与outlineMesh的Z-fighting
                            }
                        }

                        if (wallMesh) {
                            wallMesh.userData.roomIndex = roomIndex;
                            wallMesh.userData.segmentType = segment.type;
                            originalWallMeshes.push(wallMesh);
                        }
                    });

                } catch (error) {
                    console.error(`房间 ${roomIndex} 墙面创建失败:`, error);
                }
            });
            
            console.log(`创建了${originalWallMeshes.length}个原始墙面mesh`);
            
            // 2. 如果没有门窗，直接返回原始墙面
            const allDoorWindowMeshes = [...(doorWindowMeshes.doors || []), ...(doorWindowMeshes.windows || [])];
            if (allDoorWindowMeshes.length === 0) {
                console.log("没有门窗，返回原始墙面");
                return originalWallMeshes;
            }
            
            // 3. 合并所有墙面mesh
            console.log("开始合并所有墙面mesh...");
            
            // 过滤出有效的墙面mesh
            const validWallMeshes = originalWallMeshes.filter(mesh => {
                const isValid = CSGOperations.isValidMesh(mesh);
                if (!isValid) {
                    console.warn("发现无效的墙面mesh，跳过", mesh);
                }
                return isValid;
            });
            
            let combinedWallMesh = null;
            
            if (validWallMeshes.length === 0) {
                console.warn("没有有效的墙面mesh");
                return originalWallMeshes; // 返回原始数组作为降级方案
            } else if (validWallMeshes.length === 1) {
                combinedWallMesh = validWallMeshes[0];
                console.log("只有一个有效墙面mesh，直接使用");
            } else {
                combinedWallMesh = validWallMeshes[0];
                for (let i = 1; i < validWallMeshes.length; i++) {
                    const wallMesh = validWallMeshes[i];
                    if (wallMesh && combinedWallMesh) {
                        try {
                            console.log(`准备合并墙面 ${i + 1}:`, {
                                combinedValid: CSGOperations.isValidMesh(combinedWallMesh),
                                wallMeshValid: CSGOperations.isValidMesh(wallMesh),
                                combinedGeometry: !!combinedWallMesh?.geometry,
                                wallGeometry: !!wallMesh?.geometry
                            });
                            
                            const newCombined = this.performCSGUnion(combinedWallMesh, wallMesh);
                            if (newCombined && CSGOperations.isValidMesh(newCombined)) {
                                combinedWallMesh = newCombined;
                                console.log(`合并墙面 ${i + 1}/${validWallMeshes.length} 成功`);
                            } else {
                                console.warn(`墙面 ${i + 1} 合并失败，结果无效，跳过`);
                            }
                        } catch (error) {
                            console.error(`墙面 ${i + 1} 合并出现异常，跳过:`, error);
                        }
                    }
                }
            }
            
            if (!combinedWallMesh) {
                console.warn("墙面合并失败，返回原始墙面");
                return originalWallMeshes;
            }
            
            // 4. 从合并的墙面中挖去门窗
            console.log("开始从合并墙面中挖去门窗...");
            const finalWallMesh = this.performDoorWindowSubtraction(combinedWallMesh, allDoorWindowMeshes);
            
            if (finalWallMesh) {
                console.log("墙面门窗挖洞完成");
                return [finalWallMesh]; // 返回单个合并后的墙面mesh
            } else {
                console.warn("墙面门窗挖洞失败，返回原始墙面");
                return originalWallMeshes;
            }
            
        } catch (error) {
            console.error("创建墙面mesh异常:", error);
            // 降级方案：返回不带挖洞的原始墙面
            return this.createWallMeshes(roomPointsArray);
        }
    }

    /**
     * 创建墙面meshes（原方法，保留作为备用）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @returns {Array} 墙面mesh数组
     */
    createWallMeshes(roomPointsArray) {
        const wallMeshes = [];

        roomPointsArray.forEach((roomPoints, roomIndex) => {
            try {
                const segments = WallFactory.analyzeWallSegments(roomPoints);
                
                segments.forEach(segment => {
                    let wallMesh = null;

                    if (segment.type === 'arc') {
                        // 弧形墙面
                        const points = segment.points.map(point => [
                            point[0],
                            point[1],
                            0
                        ]);

                        wallMesh = WallFactory.createArcWall(points, {
                            color: 0xF8F8F8,  // 专业的浅灰白色
                            height: 2800
                        });
                        
                        // 设置弧形墙面位置稍微向上偏移，避免Z-fighting
                        if (wallMesh) {
                            wallMesh.position.z += 0.01;
                        }

                    } else {
                        // 直线墙面
                        const startPoint = [
                            segment.startPoint[0],
                            segment.startPoint[1],
                            0
                        ];
                        const endPoint = [
                            segment.endPoint[0],
                            segment.endPoint[1],
                            0
                        ];

                        wallMesh = WallFactory.createStraightWall(startPoint, endPoint, {
                            color: 0xF8F8F8,  // 专业的浅灰白色
                            height: 2800
                        });
                        
                        // 设置墙面位置稍微向上偏移，避免Z-fighting
                        if (wallMesh) {
                            wallMesh.position.z += 0.01;
                        }
                    }

                    if (wallMesh) {
                        wallMesh.userData.roomIndex = roomIndex;
                        wallMesh.userData.segmentType = segment.type;
                        wallMeshes.push(wallMesh);
                    }
                });

            } catch (error) {
                console.error(`房间 ${roomIndex} 墙面创建失败:`, error);
            }
        });

        return wallMeshes;
    }

    /**
     * 创建门窗meshes
     * @param {Object} doorWindowData - 门窗数据
     * @returns {Object} {doors: Array, windows: Array}  
     */
    createDoorWindowMeshes(doors, windows) {
        try {
            console.log('开始创建门窗，门数量:', doors?.length || 0, '窗数量:', windows?.length || 0);

            // 获取门窗数据
            const doorData = doors || [];
            const windowData = windows || [];

            // 使用工厂类批量创建门窗
            const result = DoorWindowFactory.createDoorWindowBatch(
                doorData,
                windowData
            );

            console.log(`门窗创建完成，门: ${result.doors.length}个，窗: ${result.windows.length}个`);
            
            return result;

        } catch (error) {
            console.error('门窗创建失败:', error);
            return { doors: [], windows: [] };
        }
    }

    /**
     * 转换点格式
     * @param {Array} points - 原始点数组
     * @returns {Array} 转换后的点数组
     */
    convertPointFormat(points) {
        return points.map(point => {
            if (Array.isArray(point) && point.length >= 2) {
                return { x: point[0], y: point[1], z: point[2] || 0 };
            } else if (typeof point === 'object' && point.x !== undefined && point.y !== undefined) {
                return { x: point.x, y: point.y, z: point.z || 0 };
            }
            return { x: 0, y: 0, z: 0 };
        });
    }


    /**
     * 计算点集边界
     * @param {Array} points - 点数组
     * @returns {Object} 边界信息
     */
    calculateBounds(points) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);

        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }

    /**
     * 调整相机位置
     */
    adjustCamera() {
        const camera = this.sceneManager.getCamera();
        camera.position.set(0, -5000, 15000);
        
        const controls = this.sceneManager.controls;
        if (controls) {
            controls.target.set(0, 0, 0);
            controls.update();
        }
    }

    /**
     * 清理所有3D渲染对象
     * @param {THREE.Scene} scene - Three.js场景对象
     */
    dispose(scene) {
        if (this.sceneGroup) {
            // 递归清理所有子对象的几何体和材质
            this.sceneGroup.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            // 从场景中移除场景组
            scene.remove(this.sceneGroup);
            
            // 清空场景组
            this.sceneGroup.clear();
            this.sceneGroup = null;
            
            console.log('3D渲染对象已清理');
        }
    }
}