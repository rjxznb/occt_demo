import * as THREE from 'three';
import {freestyle} from "../config/freestyle.js"

/**
 * 软装渲染器 - 负责获取软装数据并将其渲染到2D场景中
 */
export class SoftlistRenderer {
    constructor(scene2D) {
        this.scene2D = scene2D;
        this.softlistItems = []; // 存储所有软装项
        this.loadedSoftlists = new Map(); // 缓存已加载的DXF几何数据
        this.softlistGroups = []; // 存储已渲染的软装组
        
        // 默认样式
        this.defaultStyle = {
            polylineColor: 0x333333,
            polylineWidth: 0.1,
            wipeoutColor: 0xffffff,
            wipeoutOpacity: 0.8,
            z: 0.1 // 软装层级
        };
    }

    /**
     * 初始化软装渲染器 - 获取软装列表数据并渲染
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            console.log('开始加载软装数据...');
            
            // 获取软装列表
            const softlistsData = await this.fetchSoftlists();
            this.softlistItems = softlistsData.softlists || [];
            
            console.log(`获取到${this.softlistItems.length}个软装项`);
            
            // 逐个加载并渲染软装项
            for (let i = 0; i < this.softlistItems.length; i++) {
                const item = this.softlistItems[i];

                // 自由绘制的图例，这里需要获取dxf文件名_前的编号，这样才能获取dxf的typeid；
                if(item.id.split('_')[0] in freestyle){
                    item.points = this.convertPointFormat(item.points);
                    console.log(item.points);
                    let freestyle_soft = this.createPlaneMeshFromPoints(item.points, 0x333333, 0.1);

                    // 添加用户数据
                    freestyle_soft.userData = {
                        type: 'freestyle',
                        softlistId: item.id,
                        index: i,
                        basepoint: item.basepoint,
                        originalData: item
                    };
                    
                    // 添加到场景
                    this.scene2D.add(freestyle_soft);
                    this.softlistGroups.push(freestyle_soft);
                    continue;
                }
                try {
                    await this.loadAndRenderSoftlistItem(item, i);
                } catch (error) {
                    console.warn(`软装项${item.id}渲染失败:`, error);
                }
            }
            
            console.log('软装数据加载完成');
            
        } catch (error) {
            console.error('软装数据初始化失败:', error);
            throw error;
        }
    }

    /**
     * 获取软装列表数据
     * @returns {Promise<Object>}
     */
    async fetchSoftlists() {
        try {
            const response = await fetch('http://localhost:4001/softlists');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error('获取软装列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取指定软装项的DXF几何数据
     * @param {string} id - 软装项ID
     * @returns {Promise<Object>}
     */
    async fetchSoftlistPoints(id) {
        try {
            // 检查缓存
            if (this.loadedSoftlists.has(id)) {
                return this.loadedSoftlists.get(id);
            }

            const response = await fetch(`http://localhost:4001/softlists_points?id=${id}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // 缓存数据
            this.loadedSoftlists.set(id, data);
            
            return data;
        } catch (error) {
            console.error(`获取软装项${id}几何数据失败:`, error);
            throw error;
        }
    }

    /**
     * 加载并渲染单个软装项
     * @param {Object} softlistItem - 软装项数据
     * @param {number} index - 索引
     * @returns {Promise<void>}
     */
    async loadAndRenderSoftlistItem(softlistItem, index) {
        try {
            console.log(`加载软装项${index}: ${softlistItem.id}`);
            
            // 获取几何数据
            const geometryData = await this.fetchSoftlistPoints(softlistItem.id);
            
            // 创建软装组
            const softlistGroup = new THREE.Group();
            softlistGroup.name = `Softlist_${softlistItem.id}_${index}`;
            
            // 渲染polylines（线条）
            if (geometryData.polylines && geometryData.polylines.length > 0) {
                console.log(`渲染${geometryData.polylines.length}条polylines`);
                geometryData.polylines.forEach((polyline, lineIndex) => {
                    const lineMesh = this.createPolylineMesh(polyline, lineIndex);
                    if (lineMesh) {
                        softlistGroup.add(lineMesh);
                    }
                });
            }
            
            // 渲染wipeouts（填充区域）
            if (geometryData.wipeouts && geometryData.wipeouts.length > 0) {
                console.log(`渲染${geometryData.wipeouts.length}个wipeouts`);
                geometryData.wipeouts.forEach((wipeout, wipeoutIndex) => {
                    const wipeoutMesh = this.createWipeoutMesh(wipeout, wipeoutIndex);
                    if (wipeoutMesh) {
                        softlistGroup.add(wipeoutMesh);
                    }
                });
            }
            
            // 应用变换（旋转、缩放、位置）
            this.applyTransformations(softlistGroup, softlistItem);
            
            // 添加用户数据
            softlistGroup.userData = {
                type: 'softlist',
                softlistId: softlistItem.id,
                index: index,
                basepoint: softlistItem.basepoint,
                originalData: softlistItem
            };
            
            // 添加到场景
            this.scene2D.add(softlistGroup);
            this.softlistGroups.push(softlistGroup);
            
            console.log(`软装项${softlistItem.id}渲染完成，包含${softlistGroup.children.length}个几何体`);
            
        } catch (error) {
            console.error(`加载软装项${softlistItem.id}失败:`, error);
            throw error;
        }
    }

    /**
     * 创建polyline网格
     * @param {Array} polyline - polyline点数组 [[x,y], [x,y], ...]
     * @param {number} index - polyline索引
     * @returns {THREE.Line|null}
     */
    createPolylineMesh(polyline, index) {
        if (!polyline || polyline.length < 2) {
            return null;
        }

        try {
            // 将2D点转换为3D点
            const points = polyline.map(point => new THREE.Vector3(point[0], point[1], this.defaultStyle.z));
            
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: this.defaultStyle.polylineColor,
                linewidth: this.defaultStyle.polylineWidth
            });
            
            const line = new THREE.Line(geometry, material);
            line.name = `Polyline_${index}`;
            line.userData = { type: 'softlist-polyline' };
            
            return line;
        } catch (error) {
            console.warn(`创建polyline ${index} 失败:`, error);
            return null;
        }
    }

    /**
     * 创建wipeout网格（填充区域）
     * @param {Array} wipeout - wipeout点数组 [[x,y], [x,y], ...]
     * @param {number} index - wipeout索引
     * @returns {THREE.Mesh|null}
     */
    createWipeoutMesh(wipeout, index) {
        if (!wipeout || wipeout.length < 3) {
            return null;
        }

        try {
            // 创建形状路径
            const shape = new THREE.Shape();
            
            // 移动到第一个点
            shape.moveTo(wipeout[0][0], wipeout[0][1]);
            
            // 连接其他点
            for (let i = 1; i < wipeout.length; i++) {
                shape.lineTo(wipeout[i][0], wipeout[i][1]);
            }
            
            // 如果不是封闭的，则闭合
            const firstPoint = wipeout[0];
            const lastPoint = wipeout[wipeout.length - 1];
            const threshold = 0.001;
            
            if (Math.abs(firstPoint[0] - lastPoint[0]) > threshold || 
                Math.abs(firstPoint[1] - lastPoint[1]) > threshold) {
                shape.lineTo(firstPoint[0], firstPoint[1]);
            }
            
            // 创建几何体和材质
            const geometry = new THREE.ShapeGeometry(shape);
            const material = new THREE.MeshBasicMaterial({
                color: this.defaultStyle.wipeoutColor,
                transparent: true,
                opacity: this.defaultStyle.wipeoutOpacity,
                side: THREE.DoubleSide
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `Wipeout_${index}`;
            mesh.position.z = this.defaultStyle.z + 0.001; // 略微提升避免z-fighting
            mesh.userData = { type: 'softlist-wipeout' };
            
            return mesh;
        } catch (error) {
            console.warn(`创建wipeout ${index} 失败:`, error);
            return null;
        }
    }

    /**
     * 应用变换（按照正确顺序：缩放→旋转→平移）
     * @param {THREE.Group} group - 软装组
     * @param {Object} softlistItem - 软装项数据
     */
    applyTransformations(group, softlistItem) {
        try {
            // 重置组的变换
            group.position.set(0, 0, 0);
            group.rotation.set(0, 0, 0);
            group.scale.set(1, 1, 1);
            
            // 创建变换矩阵，按照顺序：缩放 -> 旋转 -> 平移 -> 水平与垂直翻转
            const transformMatrix = new THREE.Matrix4();
            
            // 1. 首先处理缩放（包括翻转）
            let scaleX = 1, scaleY = 1, scaleZ = 1;
            if (softlistItem.scale) {
                scaleX = softlistItem.scale.x || 1;
                scaleY = softlistItem.scale.y || 1;
                scaleZ = softlistItem.scale.z || 1;


                // 处理scale=-1的翻转情况
                if (scaleX === -1) {
                    console.log(`软装${softlistItem.id}: X轴翻转`);
                }
                if (scaleY === -1) {
                    console.log(`软装${softlistItem.id}: Y轴翻转`);
                }
                if (scaleZ === -1) {
                    console.log(`软装${softlistItem.id}: Z轴翻转`);
                }
            }
            
            // 创建缩放矩阵
            const scaleMatrix = new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ);
            
            // 2. 然后处理旋转
            const rotationMatrix = new THREE.Matrix4();
            if (softlistItem.rotate !== undefined) {
                const rotationRad = (softlistItem.rotate * Math.PI) / 180;
                rotationMatrix.makeRotationZ(rotationRad);
            }
            
            // 3. 最后处理平移到基点
            const translationMatrix = new THREE.Matrix4();
            if (softlistItem.basepoint) {
                translationMatrix.makeTranslation(
                    softlistItem.basepoint.x || 0,
                    softlistItem.basepoint.y || 0,
                    softlistItem.basepoint.z || 0
                );
            }

            
            
            // 按照变换顺序组合矩阵：T * R * S
            // （注意：矩阵乘法是从右到左，所以实际应用顺序是S -> R -> T）
            transformMatrix.multiplyMatrices(translationMatrix, rotationMatrix);
            transformMatrix.multiply(scaleMatrix);


            // 应用变换矩阵到组
            group.applyMatrix4(transformMatrix);
            
            console.log(`软装${softlistItem.id}变换应用完成:`, {
                位置: softlistItem.basepoint ? `(${softlistItem.basepoint.x}, ${softlistItem.basepoint.y})` : '(0, 0)',
                旋转: `${softlistItem.rotate || 0}°`,
                缩放: `(${scaleX}, ${scaleY}, ${scaleZ})`,
                翻转: {
                    X: scaleX === -1,
                    Y: scaleY === -1,
                    Z: scaleZ === -1
                }
            });
            
        } catch (error) {
            console.warn(`软装${softlistItem.id}应用变换失败:`, error);
        }
    }


    /**
     * 清除所有软装项
     */
    clearAllSoftlists() {
        this.softlistGroups.forEach(group => {
            // 清理几何体和材质
            group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            this.scene2D.remove(group);
        });
        
        this.softlistGroups = [];
        this.loadedSoftlists.clear();
        
        console.log('已清除所有软装项');
    }

    /**
     * 隐藏/显示所有软装项
     * @param {boolean} visible - 是否可见
     */
    setVisible(visible) {
        this.softlistGroups.forEach(group => {
            group.visible = visible;
        });
    }

    /**
     * 获取已加载的软装统计信息
     * @returns {Object}
     */
    getStats() {
        return {
            totalItems: this.softlistItems.length,
            renderedGroups: this.softlistGroups.length,
            cachedGeometry: this.loadedSoftlists.size
        };
    }

    /**
     * 销毁渲染器，清理资源
     */
    dispose() {
        this.clearAllSoftlists();
        this.softlistItems = [];
        this.loadedSoftlists.clear();
        console.log('SoftlistRenderer已销毁');
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

    /**
     * 创建户型平面；
     * @returns {THREE.Mesh|null}
     */
    createPlaneMeshFromPoints(Points, color, z) {
        console.log('========= 创建带洞的形状开始 =========');
        console.log('点数据', Points);
        
        // 创建外轮廓形状
        if (!Points || !Array.isArray(Points) || Points.length < 3) {
            console.warn('外轮廓数据无效:', {
                exists: !!Points,
                isArray: Array.isArray(Points),
                length: Points ? Points.length : 'N/A'
            });
            return null;
        }
        
        const shape = new THREE.Shape();
        
        // 创建外轮廊
        console.log('开始创建外轮廊，点数:', Points.length);
        const firstPoint = Points[0];
        console.log('第一个点:', firstPoint);
        
        if (!firstPoint || typeof firstPoint.x !== 'number' || typeof firstPoint.y !== 'number') {
            console.error('外轮廊第一个点无效:', firstPoint);
            return null;
        }
        
        shape.moveTo(firstPoint.x, firstPoint.y);
        let validPointCount = 1;
        
        for (let i = 1; i < Points.length; i++) {
            const point = Points[i];
            if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                shape.lineTo(point.x, point.y);
                validPointCount++;
            } else {
                console.warn(`外轮廊点${i}无效，跳过:`, point);
            }
        }
        shape.closePath();
        
        // 创建几何体
        const geometry = new THREE.ShapeGeometry(shape);
        
        // 创建材质
        const material = new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = z;


        console.log(`外轮廊创建完成，有效点数: ${validPointCount}/${Points.length}`);
        return mesh;
    }
}