/**
 * CSG引擎管理器
 * 提供统一的CSG引擎选择、配置和性能分析功能
 */

export class CSGEngineManager {
    
    /**
     * 支持的CSG引擎类型
     */
    static ENGINES = {
        THREE_BVH_CSG: 'three-bvh-csg',
        THREE_CSGMESH: 'three-csgmesh'
    };
    
    /**
     * 预定义的精度级别
     */
    static PRECISION_LEVELS = {
        ULTRA_HIGH: { epsilon: 1e-8, name: '超高精度', description: '适用于精密建模，速度较慢' },
        HIGH: { epsilon: 1e-6, name: '高精度', description: '适用于复杂几何体，速度中等' },
        MEDIUM: { epsilon: 1e-5, name: '中等精度', description: '默认推荐，平衡精度和速度' },
        LOW: { epsilon: 1e-4, name: '低精度', description: '适用于简单几何体，速度较快' },
        FAST: { epsilon: 1e-3, name: '快速模式', description: '适用于实时预览，速度最快' }
    };
    
    /**
     * 根据数据复杂度自动推荐CSG引擎和精度
     * @param {Object} data - 房间数据
     * @returns {Object} 推荐配置
     */
    static getRecommendedConfig(data) {
        try {
            // 分析数据复杂度
            const analysis = this.analyzeDataComplexity(data);
            
            let recommendedEngine = CSGEngineManager.ENGINES.THREE_BVH_CSG;
            let recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.MEDIUM;
            let reason = [];
            
            // 根据复杂度决策
            if (analysis.hasArcGeometry) {
                recommendedEngine = CSGEngineManager.ENGINES.THREE_CSGMESH;
                recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.HIGH;
                reason.push('检测到弧形几何体，需要高精度处理');
            }
            
            if (analysis.totalDoorWindows > 15) {
                recommendedEngine = CSGEngineManager.ENGINES.THREE_CSGMESH;
                recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.HIGH;
                reason.push(`门窗数量较多(${analysis.totalDoorWindows})，推荐THREE-CSGMesh`);
            }
            
            if (analysis.totalRooms > 8) {
                recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.MEDIUM;
                reason.push(`房间数量较多(${analysis.totalRooms})，平衡精度和性能`);
            }
            
            if (analysis.complexity > 30) {
                recommendedEngine = CSGEngineManager.ENGINES.THREE_CSGMESH;
                recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.HIGH;
                reason.push(`场景复杂度较高(${analysis.complexity})，需要高精度引擎`);
            }
            
            // 如果场景很简单，推荐快速模式
            if (analysis.complexity < 5 && !analysis.hasArcGeometry) {
                recommendedPrecision = CSGEngineManager.PRECISION_LEVELS.FAST;
                reason.push('场景较简单，可使用快速模式');
            }
            
            return {
                engine: recommendedEngine,
                epsilon: recommendedPrecision.epsilon,
                precisionLevel: recommendedPrecision.name,
                analysis: analysis,
                reason: reason.length > 0 ? reason : ['基于标准配置推荐'],
                config: {
                    csgEngine: recommendedEngine,
                    csgEpsilon: recommendedPrecision.epsilon
                }
            };
            
        } catch (error) {
            console.error('分析数据复杂度失败:', error);
            return {
                engine: CSGEngineManager.ENGINES.THREE_BVH_CSG,
                epsilon: CSGEngineManager.PRECISION_LEVELS.MEDIUM.epsilon,
                precisionLevel: CSGEngineManager.PRECISION_LEVELS.MEDIUM.name,
                analysis: { error: error.message },
                reason: ['分析失败，使用默认配置'],
                config: {
                    csgEngine: CSGEngineManager.ENGINES.THREE_BVH_CSG,
                    csgEpsilon: CSGEngineManager.PRECISION_LEVELS.MEDIUM.epsilon
                }
            };
        }
    }
    
    /**
     * 分析数据复杂度
     * @param {Object} data - 房间数据
     * @returns {Object} 复杂度分析结果
     */
    static analyzeDataComplexity(data) {
        const analysis = {
            totalDoorWindows: 0,
            totalRooms: 0,
            hasArcGeometry: false,
            complexity: 0,
            details: {}
        };
        
        // 分析门窗数量
        if (data.doorWindows) {
            analysis.totalDoorWindows = (data.doorWindows.doors?.length || 0) + 
                                       (data.doorWindows.windows?.length || 0);
            analysis.details.doors = data.doorWindows.doors?.length || 0;
            analysis.details.windows = data.doorWindows.windows?.length || 0;
        }
        
        // 分析房间数量
        if (data.rooms?.roomPoints) {
            analysis.totalRooms = data.rooms.roomPoints.length;
            analysis.details.rooms = analysis.totalRooms;
        }
        
        // 检查弧形几何体
        if (data.rooms?.roomPoints) {
            analysis.hasArcGeometry = data.rooms.roomPoints.some(room => 
                room.some(point => point.bulge && Math.abs(point.bulge) > 0.001)
            );
        }
        
        // 计算总体复杂度分数
        analysis.complexity = analysis.totalDoorWindows * 2 + 
                            analysis.totalRooms * 3 + 
                            (analysis.hasArcGeometry ? 10 : 0);
        
        return analysis;
    }
    
    /**
     * 创建配置化的RoomRenderer
     * @param {Object} sceneManager - 场景管理器
     * @param {Object} config - 配置选项
     * @returns {Object} 配置化的RoomRenderer实例
     */
    static createConfiguredRenderer(sceneManager, config = {}) {
        // 默认配置
        const defaultConfig = {
            csgEngine: CSGEngineManager.ENGINES.THREE_BVH_CSG,
            csgEpsilon: CSGEngineManager.PRECISION_LEVELS.MEDIUM.epsilon,
            autoRecommend: true,
            enablePerformanceMonitoring: true
        };
        
        const finalConfig = { ...defaultConfig, ...config };
        
        console.log('创建配置化RoomRenderer:', finalConfig);
        
        return {
            config: finalConfig,
            
            // 获取推荐配置
            getRecommendation: (data) => {
                if (finalConfig.autoRecommend) {
                    return CSGEngineManager.getRecommendedConfig(data);
                }
                return null;
            },
            
            // 创建renderer实例
            createRenderer: (data = null) => {
                let renderConfig = finalConfig;
                
                // 如果启用自动推荐且提供了数据
                if (finalConfig.autoRecommend && data) {
                    const recommendation = CSGEngineManager.getRecommendedConfig(data);
                    renderConfig = { ...finalConfig, ...recommendation.config };
                    console.log('自动推荐配置:', recommendation);
                }
                
                const { RoomRenderer } = require('../components/RoomRenderer.js');
                return new RoomRenderer(sceneManager, renderConfig);
            }
        };
    }
    
    /**
     * 性能比较测试
     * @param {Object} sceneManager - 场景管理器
     * @param {Object} data - 测试数据
     * @returns {Promise<Array>} 性能测试结果
     */
    static async performanceComparison(sceneManager, data) {
        const engines = [
            {
                name: 'three-bvh-csg',
                config: { csgEngine: CSGEngineManager.ENGINES.THREE_BVH_CSG }
            },
            {
                name: 'three-csgmesh (高精度)',
                config: { 
                    csgEngine: CSGEngineManager.ENGINES.THREE_CSGMESH, 
                    csgEpsilon: CSGEngineManager.PRECISION_LEVELS.HIGH.epsilon 
                }
            },
            {
                name: 'three-csgmesh (中精度)',
                config: { 
                    csgEngine: CSGEngineManager.ENGINES.THREE_CSGMESH, 
                    csgEpsilon: CSGEngineManager.PRECISION_LEVELS.MEDIUM.epsilon 
                }
            }
        ];
        
        const results = [];
        
        for (const engine of engines) {
            console.log(`测试${engine.name}引擎...`);
            
            try {
                const { RoomRenderer } = require('../components/RoomRenderer.js');
                const renderer = new RoomRenderer(sceneManager, engine.config);
                
                const startTime = performance.now();
                const result = await renderer.render(data);
                const endTime = performance.now();
                
                results.push({
                    engine: engine.name,
                    config: engine.config,
                    duration: endTime - startTime,
                    success: true,
                    meshCount: result ? result.wallMeshes?.length || 0 : 0,
                    error: null
                });
                
            } catch (error) {
                results.push({
                    engine: engine.name,
                    config: engine.config,
                    duration: 0,
                    success: false,
                    meshCount: 0,
                    error: error.message
                });
            }
        }
        
        console.log('性能对比测试完成:', results);
        return results;
    }
    
    /**
     * 获取引擎信息
     * @param {string} engineType - 引擎类型
     * @returns {Object} 引擎信息
     */
    static getEngineInfo(engineType) {
        const engineInfo = {
            [CSGEngineManager.ENGINES.THREE_BVH_CSG]: {
                name: 'Three-BVH-CSG',
                description: '基于BVH（Bounding Volume Hierarchy）的CSG引擎',
                advantages: [
                    '性能优秀，适合实时渲染',
                    '内存使用效率高',
                    '对简单几何体处理快速'
                ],
                disadvantages: [
                    '对复杂几何体精度可能不足',
                    '不支持epsilon精度控制'
                ],
                bestUseCase: '简单到中等复杂度的场景，需要快速渲染'
            },
            [CSGEngineManager.ENGINES.THREE_CSGMESH]: {
                name: 'THREE-CSGMesh',
                description: '基于BSP（Binary Space Partitioning）的CSG引擎',
                advantages: [
                    '支持epsilon精度控制',
                    '对复杂几何体处理精确',
                    '支持弧形几何体',
                    '算法稳定可靠'
                ],
                disadvantages: [
                    '性能相对较慢',
                    '内存使用较多',
                    '对简单几何体可能过度处理'
                ],
                bestUseCase: '复杂几何体、高精度要求、包含弧形的场景'
            }
        };
        
        return engineInfo[engineType] || { name: '未知引擎', description: '不支持的引擎类型' };
    }
}

// 导出默认实例
export default CSGEngineManager;