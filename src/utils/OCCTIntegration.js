/**
 * OCCT集成工具 - 将OpenCascade.js布尔运算集成到现有CSG系统
 */

import { createOCCTBooleanOperations } from './OCCTBooleanOperations.js';

export class OCCTIntegration {
    constructor() {
        this.occtOps = null;
        this.isInitialized = false;
        this.fallbackToThreeBVH = true; // 失败时回退到three-bvh-csg
    }

    /**
     * 初始化OCCT布尔运算器
     * @param {Object} oc - OpenCascade.js实例
     */
    async initialize(oc) {
        try {
            this.occtOps = createOCCTBooleanOperations(oc);
            this.isInitialized = true;
            console.log('OCCT布尔运算器初始化成功');
        } catch (error) {
            console.error('OCCT布尔运算器初始化失败:', error);
            this.isInitialized = false;
        }
    }

    /**
     * 智能布尔减法 - 自动选择最优算法
     * @param {THREE.Mesh} meshA - 被减数网格
     * @param {THREE.Mesh} meshB - 减数网格
     * @param {Object} options - 配置选项
     * @returns {Promise<THREE.Mesh>} 结果网格
     */
    async smartSubtract(meshA, meshB, options = {}) {
        const {
            tolerance = 2.0,           // 容差，单位mm
            useOCCT = 'auto',          // 'auto', 'force', 'never'
            complexityThreshold = 1000, // 复杂度阈值
            timeout = 30000            // 超时时间，毫秒
        } = options;

        try {
            // 决定使用哪种算法
            const shouldUseOCCT = this.shouldUseOCCT(meshA, meshB, useOCCT, complexityThreshold);

            if (shouldUseOCCT && this.isInitialized) {
                console.log('使用OCCT高精度布尔运算');
                
                // 设置容差
                this.occtOps.setFuzzyValue(tolerance);
                
                // 带超时的OCCT运算
                const result = await this.withTimeout(
                    this.occtOps.subtract(meshA, meshB),
                    timeout
                );
                
                if (result && this.validateResult(result)) {
                    return result;
                } else {
                    throw new Error('OCCT运算结果无效');
                }
            } else {
                console.log('使用three-bvh-csg快速布尔运算');
                return await this.fallbackSubtract(meshA, meshB, tolerance);
            }

        } catch (error) {
            console.warn('OCCT布尔运算失败，回退到three-bvh-csg:', error.message);
            
            if (this.fallbackToThreeBVH) {
                return await this.fallbackSubtract(meshA, meshB, tolerance);
            } else {
                throw error;
            }
        }
    }

    /**
     * 判断是否应该使用OCCT
     * @param {THREE.Mesh} meshA - 网格A
     * @param {THREE.Mesh} meshB - 网格B
     * @param {string} useOCCT - 使用策略
     * @param {number} complexityThreshold - 复杂度阈值
     * @returns {boolean} 是否使用OCCT
     */
    shouldUseOCCT(meshA, meshB, useOCCT, complexityThreshold) {
        if (useOCCT === 'force') return true;
        if (useOCCT === 'never') return false;
        if (!this.isInitialized) return false;

        // 自动判断：基于几何体复杂度
        const vertexCountA = meshA.geometry.attributes.position.count;
        const vertexCountB = meshB.geometry.attributes.position.count;
        
        // 复杂几何体使用OCCT
        if (vertexCountA > complexityThreshold || vertexCountB > complexityThreshold) {
            return true;
        }

        // 检查是否有弧形特征
        const hasArcA = meshA.userData?.hasArc || false;
        const hasArcB = meshB.userData?.hasArc || false;
        
        if (hasArcA || hasArcB) {
            console.log('检测到弧形几何体，使用OCCT处理');
            return true;
        }

        // 检查几何体边界框重叠程度
        meshA.geometry.computeBoundingBox();
        meshB.geometry.computeBoundingBox();
        
        const overlapRatio = this.calculateOverlapRatio(
            meshA.geometry.boundingBox,
            meshB.geometry.boundingBox
        );

        // 重叠度较低时使用OCCT（可能存在精度问题）
        if (overlapRatio < 0.1) {
            console.log(`几何体重叠度较低(${overlapRatio.toFixed(3)})，使用OCCT处理`);
            return true;
        }

        return false;
    }

    /**
     * 计算两个边界框的重叠比例
     * @param {THREE.Box3} boxA - 边界框A
     * @param {THREE.Box3} boxB - 边界框B  
     * @returns {number} 重叠比例 (0-1)
     */
    calculateOverlapRatio(boxA, boxB) {
        const intersection = boxA.clone().intersect(boxB);
        
        if (intersection.isEmpty()) {
            return 0;
        }
        
        const intersectionVolume = 
            (intersection.max.x - intersection.min.x) *
            (intersection.max.y - intersection.min.y) *
            (intersection.max.z - intersection.min.z);
            
        const volumeA = 
            (boxA.max.x - boxA.min.x) *
            (boxA.max.y - boxA.min.y) *
            (boxA.max.z - boxA.min.z);
            
        const volumeB =
            (boxB.max.x - boxB.min.x) *
            (boxB.max.y - boxB.min.y) *
            (boxB.max.z - boxB.min.z);
            
        const minVolume = Math.min(volumeA, volumeB);
        
        return minVolume > 0 ? intersectionVolume / minVolume : 0;
    }

    /**
     * 带超时的Promise包装
     * @param {Promise} promise - 要执行的Promise
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise} 带超时的Promise
     */
    withTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('操作超时')), timeout)
            )
        ]);
    }

    /**
     * 验证运算结果的有效性
     * @param {THREE.Mesh} mesh - 结果网格
     * @returns {boolean} 是否有效
     */
    validateResult(mesh) {
        if (!mesh || !mesh.geometry) {
            return false;
        }

        const positionAttr = mesh.geometry.attributes.position;
        if (!positionAttr || positionAttr.count < 3) {
            return false;
        }

        // 检查是否有NaN值
        const positions = positionAttr.array;
        for (let i = 0; i < positions.length; i++) {
            if (isNaN(positions[i]) || !isFinite(positions[i])) {
                console.warn('检测到无效的顶点坐标');
                return false;
            }
        }

        return true;
    }

    /**
     * 回退到three-bvh-csg的布尔减法
     * @param {THREE.Mesh} meshA - 被减数网格
     * @param {THREE.Mesh} meshB - 减数网格
     * @param {number} tolerance - 容差
     * @returns {Promise<THREE.Mesh>} 结果网格
     */
    async fallbackSubtract(meshA, meshB, tolerance) {
        try {
            // 对meshB进行轻微膨胀以提高成功率
            const expandedMeshB = this.expandMesh(meshB, tolerance);
            
            // 使用现有的CSGOperations（假设已导入）
            const { CSGOperations } = await import('../components/RoomRenderer.js');
            return CSGOperations.subtract(meshA, expandedMeshB);
            
        } catch (error) {
            console.error('回退布尔运算也失败了:', error);
            // 最后的回退：返回原始meshA
            return meshA;
        }
    }

    /**
     * 膨胀网格几何体（用于提高布尔运算容错性）
     * @param {THREE.Mesh} mesh - 原始网格
     * @param {number} expansion - 膨胀量（毫米）
     * @returns {THREE.Mesh} 膨胀后的网格
     */
    expandMesh(mesh, expansion = 1.0) {
        try {
            const geometry = mesh.geometry.clone();
            const positions = geometry.attributes.position;
            
            // 计算几何体中心
            geometry.computeBoundingBox();
            const center = geometry.boundingBox.getCenter(new THREE.Vector3());
            
            // 向外膨胀每个顶点
            for (let i = 0; i < positions.count; i++) {
                const vertex = new THREE.Vector3().fromBufferAttribute(positions, i);
                const direction = vertex.clone().sub(center).normalize();
                
                if (direction.length() > 0) {
                    vertex.add(direction.multiplyScalar(expansion));
                    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
                }
            }
            
            positions.needsUpdate = true;
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            
            return new THREE.Mesh(geometry, mesh.material);
            
        } catch (error) {
            console.warn('几何体膨胀失败，返回原始网格:', error);
            return mesh;
        }
    }

    /**
     * 批量布尔减法（优化性能）
     * @param {THREE.Mesh} baseMesh - 基础网格
     * @param {Array<THREE.Mesh>} subtractMeshes - 要减去的网格数组
     * @param {Object} options - 配置选项
     * @returns {Promise<THREE.Mesh>} 结果网格
     */
    async batchSubtract(baseMesh, subtractMeshes, options = {}) {
        const {
            batchSize = 5,           // 批次大小
            useUnion = true,         // 是否先合并减数
            tolerance = 2.0
        } = options;

        try {
            let currentMesh = baseMesh;
            
            if (useUnion && subtractMeshes.length > 1 && this.isInitialized) {
                console.log('首先合并所有减数...');
                
                // 将减数分批合并
                let unionMesh = subtractMeshes[0];
                
                for (let i = 1; i < subtractMeshes.length; i += batchSize) {
                    const batch = subtractMeshes.slice(i, i + batchSize);
                    
                    for (const mesh of batch) {
                        try {
                            this.occtOps.setFuzzyValue(tolerance);
                            unionMesh = await this.occtOps.union(unionMesh, mesh);
                        } catch (error) {
                            console.warn(`合并第${i}个减数失败:`, error.message);
                        }
                    }
                }
                
                // 执行单次减法
                return await this.smartSubtract(currentMesh, unionMesh, options);
                
            } else {
                // 逐个减法
                console.log('逐个执行减法运算...');
                
                for (let i = 0; i < subtractMeshes.length; i++) {
                    try {
                        currentMesh = await this.smartSubtract(
                            currentMesh, 
                            subtractMeshes[i], 
                            options
                        );
                    } catch (error) {
                        console.warn(`第${i + 1}个减法运算失败:`, error.message);
                    }
                }
                
                return currentMesh;
            }
            
        } catch (error) {
            console.error('批量布尔减法失败:', error);
            return baseMesh;
        }
    }

    /**
     * 获取OCCT运算统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            isInitialized: this.isInitialized,
            tolerance: this.occtOps?.tolerance || 'N/A',
            fallbackEnabled: this.fallbackToThreeBVH
        };
    }
}

// 创建全局实例
export const occtIntegration = new OCCTIntegration();