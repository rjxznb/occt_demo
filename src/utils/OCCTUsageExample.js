/**
 * OCCT布尔运算使用示例
 * 展示如何将OpenCascade.js布尔运算集成到现有的RoomRenderer中
 */

import { occtIntegration } from './OCCTIntegration.js';

export class OCCTUsageExample {
    
    /**
     * 初始化示例 - 在App.js或main.js中调用
     */
    static async initializeOCCT() {
        try {
            // 假设OpenCascade.js已经在全局可用
            if (typeof window !== 'undefined' && window.oc) {
                await occtIntegration.initialize(window.oc);
                console.log('OCCT集成初始化完成');
            } else {
                console.warn('OpenCascade.js未找到，将使用three-bvh-csg');
            }
        } catch (error) {
            console.error('OCCT初始化失败:', error);
        }
    }

    /**
     * 示例1: 替换现有的CSG减法操作
     */
    static async enhancedSubtractExample(wallMesh, doorWindowMesh) {
        try {
            console.log('执行增强的布尔减法...');
            
            // 使用智能布尔减法
            const result = await occtIntegration.smartSubtract(wallMesh, doorWindowMesh, {
                tolerance: 2.0,        // 2mm容差
                useOCCT: 'auto',       // 自动选择算法
                timeout: 15000         // 15秒超时
            });
            
            console.log('布尔减法完成');
            return result;
            
        } catch (error) {
            console.error('增强布尔减法失败:', error);
            // 回退到原始方法
            return wallMesh;
        }
    }

    /**
     * 示例2: 集成到RoomRenderer的门窗挖洞
     */
    static async enhancedDoorWindowSubtraction(baseMesh, doorWindowMeshes) {
        try {
            console.log('开始增强的门窗挖洞...');
            
            // 使用批量减法优化
            const allDoorWindows = [...doorWindowMeshes.doors, ...doorWindowMeshes.windows];
            
            const result = await occtIntegration.batchSubtract(baseMesh, allDoorWindows, {
                tolerance: 3.0,        // 门窗挖洞使用更大容差
                batchSize: 3,          // 每批处理3个
                useUnion: true,        // 先合并门窗
                useOCCT: 'auto'
            });
            
            return result;
            
        } catch (error) {
            console.error('增强门窗挖洞失败:', error);
            return baseMesh;
        }
    }

    /**
     * 示例3: 配置化的容差管理
     */
    static getToleranceForScenario(meshA, meshB) {
        // 根据网格特征动态调整容差
        const sizeA = this.getMeshSize(meshA);
        const sizeB = this.getMeshSize(meshB);
        
        // 门窗挖洞
        if (meshA.userData?.wallType && (meshB.userData?.type === 'door' || meshB.userData?.type === 'window')) {
            return 2.5; // 2.5mm
        }
        
        // 弧形几何体
        if (meshA.userData?.hasArc || meshB.userData?.hasArc) {
            return 1.0; // 1mm高精度
        }
        
        // 大型几何体
        if (sizeA > 10000 || sizeB > 10000) {
            return 5.0; // 5mm
        }
        
        // 默认容差
        return 2.0;
    }

    /**
     * 获取网格的大致尺寸
     */
    static getMeshSize(mesh) {
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        return Math.max(
            box.max.x - box.min.x,
            box.max.y - box.min.y,
            box.max.z - box.min.z
        );
    }

    /**
     * 示例4: 性能监控和错误处理
     */
    static async performanceManagedSubtract(meshA, meshB) {
        const startTime = performance.now();
        
        try {
            // 动态容差
            const tolerance = this.getToleranceForScenario(meshA, meshB);
            
            console.log(`开始布尔运算，容差=${tolerance}mm`);
            
            const result = await occtIntegration.smartSubtract(meshA, meshB, {
                tolerance: tolerance,
                useOCCT: 'auto',
                timeout: 20000
            });
            
            const duration = performance.now() - startTime;
            console.log(`布尔运算完成，耗时=${duration.toFixed(2)}ms`);
            
            // 验证结果
            if (!occtIntegration.validateResult(result)) {
                throw new Error('运算结果验证失败');
            }
            
            return result;
            
        } catch (error) {
            const duration = performance.now() - startTime;
            console.error(`布尔运算失败，耗时=${duration.toFixed(2)}ms:`, error.message);
            
            // 返回原始网格作为降级方案
            return meshA;
        }
    }

    /**
     * 示例5: 集成到现有的CSGOperations类
     */
    static createEnhancedCSGOperations() {
        return {
            // 增强的减法操作
            async subtract(meshA, meshB) {
                return await OCCTUsageExample.performanceManagedSubtract(meshA, meshB);
            },
            
            // 增强的并集操作
            async union(meshA, meshB) {
                const tolerance = OCCTUsageExample.getToleranceForScenario(meshA, meshB);
                
                if (occtIntegration.isInitialized) {
                    try {
                        occtIntegration.occtOps.setFuzzyValue(tolerance);
                        return await occtIntegration.occtOps.union(meshA, meshB);
                    } catch (error) {
                        console.warn('OCCT并集失败，回退到three-bvh-csg:', error.message);
                    }
                }
                
                // 回退到原始实现
                const { CSGOperations } = await import('../components/RoomRenderer.js');
                return CSGOperations.union(meshA, meshB);
            },
            
            // 验证网格有效性
            isValidMesh(mesh) {
                return occtIntegration.validateResult(mesh);
            },
            
            // 获取统计信息
            getStats() {
                return occtIntegration.getStats();
            }
        };
    }

    /**
     * 示例6: 在RoomRenderer中的实际使用
     */
    static async integrateWithRoomRenderer() {
        // 这个函数展示如何修改现有的RoomRenderer
        const exampleCode = `
        // 在RoomRenderer.js的开头添加导入
        import { occtIntegration } from '../utils/OCCTIntegration.js';
        
        class RoomRenderer {
            constructor() {
                // 现有构造函数代码...
                
                // 初始化OCCT（如果可用）
                this.initializeOCCT();
            }
            
            async initializeOCCT() {
                if (window.oc) {
                    await occtIntegration.initialize(window.oc);
                    console.log('RoomRenderer: OCCT集成已启用');
                }
            }
            
            // 修改现有的performWallDoorWindowSubtraction方法
            async performWallDoorWindowSubtraction(wallMesh, doorWindowMeshes) {
                try {
                    const allDoorWindows = [...doorWindowMeshes.doors, ...doorWindowMeshes.windows];
                    
                    // 使用增强的批量减法
                    const result = await occtIntegration.batchSubtract(wallMesh, allDoorWindows, {
                        tolerance: 2.5,
                        useOCCT: 'auto',
                        timeout: 30000
                    });
                    
                    return result;
                    
                } catch (error) {
                    console.error('增强门窗挖洞失败，使用原始方法:', error);
                    // 回退到原始实现
                    return this.originalPerformWallDoorWindowSubtraction(wallMesh, doorWindowMeshes);
                }
            }
            
            // 保留原始方法作为备用
            originalPerformWallDoorWindowSubtraction(wallMesh, doorWindowMeshes) {
                // 原始的CSG操作代码...
            }
        }
        `;
        
        console.log('RoomRenderer集成示例代码:');
        console.log(exampleCode);
    }

    /**
     * 示例7: 错误处理和降级策略
     */
    static async robustBooleanOperation(meshA, meshB, operation = 'subtract') {
        const strategies = [
            // 策略1: OCCT高精度
            async () => {
                if (!occtIntegration.isInitialized) throw new Error('OCCT未初始化');
                
                const tolerance = this.getToleranceForScenario(meshA, meshB);
                occtIntegration.occtOps.setFuzzyValue(tolerance);
                
                switch (operation) {
                    case 'subtract':
                        return await occtIntegration.occtOps.subtract(meshA, meshB);
                    case 'union':
                        return await occtIntegration.occtOps.union(meshA, meshB);
                    case 'intersect':
                        return await occtIntegration.occtOps.intersect(meshA, meshB);
                    default:
                        throw new Error(`不支持的操作: ${operation}`);
                }
            },
            
            // 策略2: three-bvh-csg + 几何体膨胀
            async () => {
                const expandedMeshB = occtIntegration.expandMesh(meshB, 1.5);
                const { CSGOperations } = await import('../components/RoomRenderer.js');
                
                switch (operation) {
                    case 'subtract':
                        return CSGOperations.subtract(meshA, expandedMeshB);
                    case 'union':
                        return CSGOperations.union(meshA, expandedMeshB);
                    default:
                        throw new Error(`three-bvh-csg不支持操作: ${operation}`);
                }
            },
            
            // 策略3: 原始three-bvh-csg
            async () => {
                const { CSGOperations } = await import('../components/RoomRenderer.js');
                
                switch (operation) {
                    case 'subtract':
                        return CSGOperations.subtract(meshA, meshB);
                    case 'union':
                        return CSGOperations.union(meshA, meshB);
                    default:
                        throw new Error(`three-bvh-csg不支持操作: ${operation}`);
                }
            }
        ];
        
        // 依次尝试每个策略
        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`尝试布尔运算策略${i + 1}...`);
                const result = await strategies[i]();
                
                if (occtIntegration.validateResult(result)) {
                    console.log(`策略${i + 1}成功`);
                    return result;
                }
                
            } catch (error) {
                console.warn(`策略${i + 1}失败:`, error.message);
            }
        }
        
        // 所有策略都失败，返回原始网格
        console.error('所有布尔运算策略都失败，返回原始网格');
        return meshA;
    }
}

// 导出使用示例
export default OCCTUsageExample;