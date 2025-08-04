/**
 * CSGMesh使用示例
 * 展示如何在项目中配置和使用THREE-CSGMesh进行挖洞操作
 */

import { RoomRenderer } from '../components/RoomRenderer.js';
import { SceneManager } from '../components/SceneManager.js';
import { WallSelector } from '../components/WallSelector.js';

export class CSGMeshExample {
    
    /**
     * 示例1: 创建使用CSGMesh的RoomRenderer
     */
    static createCSGMeshRenderer(container) {
        try {
            // 初始化场景管理器
            const sceneManager = new SceneManager(container);
            
            // 创建使用CSGMesh的RoomRenderer，设置epsilon误差
            const renderer = new RoomRenderer(sceneManager, {
                csgEngine: 'three-csgmesh',    // 使用THREE-CSGMesh引擎
                csgEpsilon: 1e-6               // 设置高精度epsilon值
            });
            
            console.log('CSGMesh RoomRenderer创建成功');
            return renderer;
            
        } catch (error) {
            console.error('创建CSGMesh RoomRenderer失败:', error);
            return null;
        }
    }
    
    /**
     * 示例2: 动态切换CSG引擎
     */
    static switchCSGEngine(renderer, engine, epsilon = 1e-5) {
        try {
            console.log(`切换CSG引擎: ${engine}, epsilon: ${epsilon}`);
            
            // 动态切换CSG引擎
            renderer.setCSGEngine(engine, epsilon);
            
            console.log('CSG引擎切换成功');
            return true;
            
        } catch (error) {
            console.error('切换CSG引擎失败:', error);
            return false;
        }
    }
    
    /**
     * 示例3: 不同精度设置的对比测试
     */
    static async precisionComparisonTest(data, container) {
        try {
            console.log('开始精度对比测试...');
            
            const sceneManager = new SceneManager(container);
            const wallSelector = new WallSelector(sceneManager);
            
            // 测试不同的epsilon值
            const epsilonValues = [1e-3, 1e-4, 1e-5, 1e-6];
            const results = [];
            
            for (const epsilon of epsilonValues) {
                console.log(`测试epsilon=${epsilon}...`);
                
                // 创建使用指定epsilon的renderer
                const renderer = new RoomRenderer(sceneManager, {
                    csgEngine: 'three-csgmesh',
                    csgEpsilon: epsilon
                });
                
                const startTime = performance.now();
                
                // 执行渲染
                const result = await renderer.render(data, wallSelector);
                
                const endTime = performance.now();
                const duration = endTime - startTime;
                
                results.push({
                    epsilon: epsilon,
                    duration: duration,
                    success: !!result,
                    meshCount: result ? result.wallMeshes.length : 0
                });
                
                console.log(`epsilon=${epsilon} 完成，耗时=${duration.toFixed(2)}ms`);
            }
            
            // 输出对比结果
            console.log('精度对比测试结果:');
            console.table(results);
            
            return results;
            
        } catch (error) {
            console.error('精度对比测试失败:', error);
            return null;
        }
    }
    
    /**
     * 示例4: CSG引擎性能对比
     */
    static async performanceComparison(data, container) {
        try {
            console.log('开始CSG引擎性能对比...');
            
            const sceneManager = new SceneManager(container);
            const wallSelector = new WallSelector(sceneManager);
            
            const engines = [
                { name: 'three-bvh-csg', config: { csgEngine: 'three-bvh-csg' } },
                { name: 'three-csgmesh', config: { csgEngine: 'three-csgmesh', csgEpsilon: 1e-5 } }
            ];
            
            const results = [];
            
            for (const engine of engines) {
                console.log(`测试${engine.name}引擎...`);
                
                const renderer = new RoomRenderer(sceneManager, engine.config);
                
                const startTime = performance.now();
                
                try {
                    const result = await renderer.render(data, wallSelector);
                    const endTime = performance.now();
                    
                    results.push({
                        engine: engine.name,
                        duration: endTime - startTime,
                        success: true,
                        meshCount: result ? result.wallMeshes.length : 0,
                        error: null
                    });
                    
                } catch (error) {
                    const endTime = performance.now();
                    
                    results.push({
                        engine: engine.name,
                        duration: endTime - startTime,
                        success: false,
                        meshCount: 0,
                        error: error.message
                    });
                }
            }
            
            // 输出性能对比结果
            console.log('CSG引擎性能对比结果:');
            console.table(results);
            
            return results;
            
        } catch (error) {
            console.error('性能对比测试失败:', error);
            return null;
        }
    }
    
    /**
     * 示例5: 根据几何体复杂度自动选择CSG引擎
     */
    static autoSelectCSGEngine(data) {
        try {
            // 分析数据复杂度
            const totalDoorWindows = (data.doorWindows?.doors?.length || 0) + 
                                   (data.doorWindows?.windows?.length || 0);
            const totalRooms = data.rooms?.roomPoints?.length || 0;
            
            // 检查是否有弧形几何体
            const hasArcGeometry = data.rooms?.roomPoints?.some(room => 
                room.some(point => point.bulge && Math.abs(point.bulge) > 0.001)
            ) || false;
            
            let recommendedEngine = 'three-bvh-csg';
            let recommendedEpsilon = 1e-5;
            
            // 决策逻辑
            if (hasArcGeometry) {
                // 弧形几何体需要更高精度
                recommendedEngine = 'three-csgmesh';
                recommendedEpsilon = 1e-6;
            } else if (totalDoorWindows > 10 || totalRooms > 5) {
                // 复杂场景使用CSGMesh
                recommendedEngine = 'three-csgmesh';
                recommendedEpsilon = 1e-5;
            } else {
                // 简单场景使用three-bvh-csg
                recommendedEngine = 'three-bvh-csg';
            }
            
            const recommendation = {
                engine: recommendedEngine,
                epsilon: recommendedEpsilon,
                reason: {
                    hasArcGeometry,
                    totalDoorWindows,
                    totalRooms,
                    complexity: totalDoorWindows + totalRooms
                }
            };
            
            console.log('CSG引擎自动选择结果:', recommendation);
            return recommendation;
            
        } catch (error) {
            console.error('自动选择CSG引擎失败:', error);
            return {
                engine: 'three-bvh-csg',
                epsilon: 1e-5,
                reason: { error: error.message }
            };
        }
    }
    
    /**
     * 示例6: 创建配置化的App实例
     */
    static createConfigurableApp(container, config = {}) {
        try {
            // 默认配置
            const defaultConfig = {
                csgEngine: 'three-bvh-csg',
                csgEpsilon: 1e-5,
                autoSelect: false
            };
            
            const finalConfig = { ...defaultConfig, ...config };
            
            console.log('创建配置化App:', finalConfig);
            
            // 初始化组件
            const sceneManager = new SceneManager(container);
            const wallSelector = new WallSelector(sceneManager);
            
            // 创建renderer
            const renderer = new RoomRenderer(sceneManager, {
                csgEngine: finalConfig.csgEngine,
                csgEpsilon: finalConfig.csgEpsilon
            });
            
            return {
                sceneManager,
                wallSelector,
                renderer,
                config: finalConfig,
                
                // 提供配置更新接口
                updateConfig: (newConfig) => {
                    Object.assign(finalConfig, newConfig);
                    if (newConfig.csgEngine || newConfig.csgEpsilon) {
                        renderer.setCSGEngine(finalConfig.csgEngine, finalConfig.csgEpsilon);
                    }
                },
                
                // 提供自动选择接口
                autoSelectEngine: (data) => {
                    if (finalConfig.autoSelect) {
                        const recommendation = CSGMeshExample.autoSelectCSGEngine(data);
                        renderer.setCSGEngine(recommendation.engine, recommendation.epsilon);
                        return recommendation;
                    }
                    return null;
                }
            };
            
        } catch (error) {
            console.error('创建配置化App失败:', error);
            return null;
        }
    }
}

// 导出使用示例
export default CSGMeshExample;