import * as THREE from '../../node_modules/three/build/three.module.js';
import CSG from './THREE-CSGMesh-master/three-csg.js';
import { Plane } from './THREE-CSGMesh-master/csg-lib.js';

/**
 * 增强型CSG布尔运算操作类
 * 基于THREE-CSGMesh，提供与CSGOperations相同的接口，并支持Epsilon误差设置
 */
export class CSGMeshOperations {
    
    /**
     * 构造函数
     * @param {number} epsilon - CSG运算的误差值，默认为1e-5
     */
    constructor(epsilon) {
        this.epsilon = epsilon;
        
        // 设置CSG库的精度参数
        this.setupPrecision();
        
        console.log(`CSGMeshOperations初始化，epsilon=${epsilon}`);
    }

    /**
     * 设置epsilon误差值
     * @param {number} epsilon - 新的误差值
     */
    setEpsilon(epsilon) {
        this.epsilon = epsilon;
        this.setupPrecision();
        console.log(`CSGMeshOperations epsilon设置为: ${epsilon}`);
    }

    /**
     * 获取当前epsilon值
     * @returns {number} 当前的误差值
     */
    getEpsilon() {
        return this.epsilon;
    }

    /**
     * 设置精度参数
     */
    setupPrecision() {
        // 设置THREE-CSGMesh的Plane.EPSILON
        // 这是控制BSP算法精度的核心参数
        try {
            const oldEpsilon = Plane.EPSILON;
            Plane.EPSILON = this.epsilon;
            console.log(`Plane.EPSILON更新: ${oldEpsilon} → ${this.epsilon}`);
        } catch (error) {
            console.warn('直接设置Plane.EPSILON失败:', error);
            // 尝试通过其他方式设置
            this.tryAlternativeEpsilonSetting();
        }
        
        console.log(`CSG精度设置为epsilon=${this.epsilon}`);
    }
    
    /**
     * 尝试其他方式设置epsilon
     */
    tryAlternativeEpsilonSetting() {
        // 尝试通过CSG模块设置
        if (CSG && CSG.Plane) {
            CSG.Plane.EPSILON = this.epsilon;
            console.log(`通过CSG.Plane设置EPSILON=${this.epsilon}`);
            return;
        }
        
        // 如果CSG已经加载到全局作用域
        if (typeof window !== 'undefined' && window.Plane) {
            window.Plane.EPSILON = this.epsilon;
            console.log(`通过全局变量设置Plane.EPSILON=${this.epsilon}`);
            return;
        }
        
        console.warn('所有epsilon设置方法都失败了');
    }
    
    /**
     * 确保epsilon设置生效（在每次CSG操作前调用）
     */
    ensureEpsilonSet() {
        try {
            // 检查当前Plane.EPSILON是否与设置的epsilon一致
            if (Plane.EPSILON !== this.epsilon) {
                console.log(`重新设置Plane.EPSILON: ${Plane.EPSILON} → ${this.epsilon}`);
                Plane.EPSILON = this.epsilon;
            }
        } catch (error) {
            // 如果直接访问失败，尝试其他方式
            this.tryAlternativeEpsilonSetting();
        }
    }

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
        
        // 检查几何体类型和属性
        if (geometry instanceof THREE.BufferGeometry) {
            // BufferGeometry的检查
            if (!geometry.attributes || !geometry.attributes.position) {
                return false;
            }
            
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
        } else {
            // Legacy Geometry的检查
            if (!geometry.vertices || geometry.vertices.length === 0) {
                return false;
            }
            
            // 检查vertices中是否有NaN或无穷大值
            for (let i = 0; i < geometry.vertices.length; i++) {
                const vertex = geometry.vertices[i];
                if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z)) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * 准备mesh用于高精度CSG运算
     * @param {THREE.Mesh} mesh - 要准备的mesh
     * @returns {THREE.Mesh} 准备好的mesh
     */
    prepareMeshForCSG(mesh) {
        try {
            if (!CSGMeshOperations.isValidMesh(mesh)) {
                throw new Error("输入mesh无效");
            }

            // 克隆mesh避免修改原始数据
            const clonedMesh = mesh.clone();
            let geometry = clonedMesh.geometry.clone();
            
            // 调试信息
            console.log("Geometry type:", geometry.constructor.name);
            console.log("Is BufferGeometry:", geometry instanceof THREE.BufferGeometry);
            console.log("Geometry properties:", Object.keys(geometry));
            
            // 确保geometry是BufferGeometry（现代THREE.js默认就是BufferGeometry）
            // if (!(geometry instanceof THREE.BufferGeometry)) {
            //     console.warn("Geometry is not BufferGeometry, converting to BufferGeometry...");
            //     // 在现代THREE.js中，如果遇到legacy geometry，我们需要手动转换
            //     try {
            //         // 创建新的BufferGeometry并复制属性
            //         const newGeometry = new THREE.BufferGeometry();
                    
            //         // 如果是老式Geometry，尝试转换
            //         if (geometry.vertices && geometry.faces) {
            //             // 转换顶点
            //             const vertices = [];
            //             const normals = [];
            //             const uvs = [];
                        
            //             for (let i = 0; i < geometry.faces.length; i++) {
            //                 const face = geometry.faces[i];
                            
            //                 // 添加三角形的三个顶点
            //                 vertices.push(
            //                     geometry.vertices[face.a].x, geometry.vertices[face.a].y, geometry.vertices[face.a].z,
            //                     geometry.vertices[face.b].x, geometry.vertices[face.b].y, geometry.vertices[face.b].z,
            //                     geometry.vertices[face.c].x, geometry.vertices[face.c].y, geometry.vertices[face.c].z
            //                 );
                            
            //                 // 添加法向量
            //                 if (face.vertexNormals && face.vertexNormals.length === 3) {
            //                     normals.push(
            //                         face.vertexNormals[0].x, face.vertexNormals[0].y, face.vertexNormals[0].z,
            //                         face.vertexNormals[1].x, face.vertexNormals[1].y, face.vertexNormals[1].z,
            //                         face.vertexNormals[2].x, face.vertexNormals[2].y, face.vertexNormals[2].z
            //                     );
            //                 } else {
            //                     normals.push(
            //                         face.normal.x, face.normal.y, face.normal.z,
            //                         face.normal.x, face.normal.y, face.normal.z,
            //                         face.normal.x, face.normal.y, face.normal.z
            //                     );
            //                 }
                            
            //                 // 添加UV坐标
            //                 if (geometry.faceVertexUvs && geometry.faceVertexUvs[0] && geometry.faceVertexUvs[0][i]) {
            //                     const faceUvs = geometry.faceVertexUvs[0][i];
            //                     uvs.push(
            //                         faceUvs[0].x, faceUvs[0].y,
            //                         faceUvs[1].x, faceUvs[1].y,
            //                         faceUvs[2].x, faceUvs[2].y
            //                     );
            //                 } else {
            //                     uvs.push(0, 0, 0, 0, 0, 0);
            //                 }
            //             }
                        
            //             // 设置属性
            //             newGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
            //             newGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
            //             newGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
            //         }
                    
            //         // 更新引用
            //         geometry = newGeometry;
            //         clonedMesh.geometry = geometry;
            //         console.log("Successfully converted to BufferGeometry");
                    
            //     } catch (conversionError) {
            //         console.error("Failed to convert to BufferGeometry:", conversionError);
            //         // 继续使用原始geometry，但可能会有问题
            //     }
            // }
            
            // 根据epsilon精度级别处理几何体
            if (this.epsilon < 1e-5) {
                // 高精度处理：合并重复顶点
                try {
                    // 在BufferGeometry中使用mergeVertices()方法
                    if (typeof geometry.mergeVertices === 'function') {
                        geometry.mergeVertices();
                    }
                } catch (error) {
                    console.warn("无法合并顶点:", error.message);
                }
            }
            
            // 确保几何体有正确的法向量
            if (!geometry.attributes.normal) {
                geometry.computeVertexNormals();
            }

            // 添加UV坐标（如果没有的话）
            if (geometry.attributes && !geometry.attributes.uv) {
                const positions = geometry.attributes.position;
                if (positions && positions.count) {
                    const uvArray = new Float32Array(positions.count * 2);
                    
                    // 基于位置生成UV（比全零更合理）
                    for (let i = 0; i < positions.count; i++) {
                        const x = positions.array[i * 3];
                        const y = positions.array[i * 3 + 1];
                        uvArray[i * 2] = (x + 1) * 0.5;
                        uvArray[i * 2 + 1] = (y + 1) * 0.5;
                    }
                    
                    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
                }
            }

            // 更新几何体
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            
            // 确保mesh的矩阵是最新的
            clonedMesh.updateMatrix();
            clonedMesh.updateMatrixWorld();
            
            return clonedMesh;

        } catch (error) {
            console.error("准备mesh失败:", error);
            return mesh;
        }
    }

    /**
     * CSG减法运算（A - B）
     * @param {THREE.Mesh} meshA - 被减数mesh
     * @param {THREE.Mesh} meshB - 减数mesh
     * @returns {THREE.Mesh} 运算结果mesh
     */
    subtract(meshA, meshB) {
        try {
            console.log(`CSGMesh减法运算开始，epsilon=${this.epsilon}`);
            
            if (!CSGMeshOperations.isValidMesh(meshA) || !CSGMeshOperations.isValidMesh(meshB)) {
                throw new Error("输入几何体无效");
            }

            // 准备mesh并更新矩阵
            const preparedMeshA = this.prepareMeshForCSG(meshA);
            const preparedMeshB = this.prepareMeshForCSG(meshB);
            
            // 确保矩阵更新
            preparedMeshA.updateMatrix();
            preparedMeshB.updateMatrix();
            preparedMeshA.updateMatrixWorld();
            preparedMeshB.updateMatrixWorld();
            
            // 确保epsilon设置生效
            this.ensureEpsilonSet();

            // 转换为CSG对象
            const csgA = CSG.fromMesh(preparedMeshA);
            const csgB = CSG.fromMesh(preparedMeshB);

            // 执行减法运算
            const resultCSG = csgA.subtract(csgB);

            // 转换回THREE.Mesh
            const resultMesh = CSG.toMesh(resultCSG, preparedMeshA.matrix, preparedMeshA.material);
            
            // 确保结果mesh有正确的shadow设置
            resultMesh.castShadow = resultMesh.receiveShadow = true;

            console.log("CSGMesh减法运算完成");
            return resultMesh;

        } catch (error) {
            console.error("CSGMesh减法失败:", error);
            
            // 降级方案：返回原始meshA
            console.warn("CSGMesh减法降级：返回原始meshA");
            return meshA;
        }
    }

    /**
     * CSG并集运算（A ∪ B）
     * @param {THREE.Mesh} meshA - mesh A
     * @param {THREE.Mesh} meshB - mesh B
     * @returns {THREE.Mesh} 运算结果mesh
     */
    union(meshA, meshB) {
        try {
            console.log(`CSGMesh并集运算开始，epsilon=${this.epsilon}`);
            
            if (!CSGMeshOperations.isValidMesh(meshA) || !CSGMeshOperations.isValidMesh(meshB)) {
                throw new Error("输入几何体无效");
            }

            // 准备mesh并更新矩阵
            const preparedMeshA = this.prepareMeshForCSG(meshA);
            const preparedMeshB = this.prepareMeshForCSG(meshB);
            
            // 确保矩阵更新
            preparedMeshA.updateMatrix();
            preparedMeshB.updateMatrix();
            preparedMeshA.updateMatrixWorld();
            preparedMeshB.updateMatrixWorld();
            
            // 确保epsilon设置生效
            this.ensureEpsilonSet();

            // 转换为CSG对象
            const csgA = CSG.fromMesh(preparedMeshA);
            const csgB = CSG.fromMesh(preparedMeshB);

            // 执行并集运算
            const resultCSG = csgA.union(csgB);

            // 转换回THREE.Mesh
            const resultMesh = CSG.toMesh(resultCSG, preparedMeshA.matrix, preparedMeshA.material);
            
            // 确保结果mesh有正确的shadow设置
            resultMesh.castShadow = resultMesh.receiveShadow = true;

            console.log("CSGMesh并集运算完成");
            return resultMesh;

        } catch (error) {
            console.error("CSGMesh并集失败:", error);
            
            // 降级方案：返回原始meshA
            console.warn("CSGMesh并集降级：返回原始meshA");
            return meshA;
        }
    }

    /**
     * CSG交集运算（A ∩ B）
     * @param {THREE.Mesh} meshA - mesh A
     * @param {THREE.Mesh} meshB - mesh B
     * @returns {THREE.Mesh} 运算结果mesh
     */
    intersect(meshA, meshB) {
        try {
            console.log(`CSGMesh交集运算开始，epsilon=${this.epsilon}`);
            
            if (!CSGMeshOperations.isValidMesh(meshA) || !CSGMeshOperations.isValidMesh(meshB)) {
                throw new Error("输入几何体无效");
            }

            // 准备mesh并更新矩阵
            const preparedMeshA = this.prepareMeshForCSG(meshA);
            const preparedMeshB = this.prepareMeshForCSG(meshB);
            
            // 确保矩阵更新
            preparedMeshA.updateMatrix();
            preparedMeshB.updateMatrix();
            preparedMeshA.updateMatrixWorld();
            preparedMeshB.updateMatrixWorld();
            
            // 确保epsilon设置生效
            this.ensureEpsilonSet();

            // 转换为CSG对象
            const csgA = CSG.fromMesh(preparedMeshA);
            const csgB = CSG.fromMesh(preparedMeshB);

            // 执行交集运算
            const resultCSG = csgA.intersect(csgB);

            // 转换回THREE.Mesh
            const resultMesh = CSG.toMesh(resultCSG, preparedMeshA.matrix, preparedMeshA.material);
            
            // 确保结果mesh有正确的shadow设置
            resultMesh.castShadow = resultMesh.receiveShadow = true;

            console.log("CSGMesh交集运算完成");
            return resultMesh;

        } catch (error) {
            console.error("CSGMesh交集失败:", error);
            
            // 降级方案：返回null（交集可能为空）
            console.warn("CSGMesh交集降级：返回null");
            return null;
        }
    }

    /**
     * 批量减法运算（用于门窗挖洞）
     * @param {THREE.Mesh} baseMesh - 基础mesh
     * @param {Array<THREE.Mesh>} subtractMeshes - 要减去的mesh数组
     * @returns {THREE.Mesh} 运算结果mesh
     */
    batchSubtract(baseMesh, subtractMeshes) {
        try {
            console.log(`CSGMesh批量减法运算开始，处理${subtractMeshes.length}个mesh，epsilon=${this.epsilon}`);
            
            let currentMesh = baseMesh;
            let successCount = 0;

            for (let i = 0; i < subtractMeshes.length; i++) {
                const subtractMesh = subtractMeshes[i];
                
                if (!CSGMeshOperations.isValidMesh(subtractMesh)) {
                    console.warn(`跳过无效的mesh ${i + 1}`);
                    continue;
                }
                
                try {
                    const startTime = performance.now();
                    const newMesh = this.subtract(currentMesh, subtractMesh);
                    const endTime = performance.now();
                    
                    if (newMesh && CSGMeshOperations.isValidMesh(newMesh)) {
                        currentMesh = newMesh;
                        successCount++;
                        console.log(`批量减法 ${i + 1}/${subtractMeshes.length} 完成，耗时=${(endTime - startTime).toFixed(2)}ms`);
                    } else {
                        console.warn(`批量减法 ${i + 1} 失败，继续下一个`);
                    }
                } catch (error) {
                    console.error(`批量减法 ${i + 1} 异常:`, error);
                }
            }
            
            console.log(`CSGMesh批量减法完成，成功: ${successCount}/${subtractMeshes.length}`);
            return currentMesh;
            
        } catch (error) {
            console.error("CSGMesh批量减法异常:", error);
            return baseMesh;
        }
    }

    /**
     * 清理资源
     */
    dispose() {
        // CSGMesh相关的清理工作
        console.log("CSGMeshOperations资源清理完成");
    }
}

// 导出默认实例（使用默认epsilon）
export const defaultCSGMeshOps = new CSGMeshOperations();

// 同时导出类，供用户自定义epsilon使用
export default CSGMeshOperations;