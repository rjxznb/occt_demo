import * as THREE from 'three';
import {freestyle} from "../config/freestyle.js"
import { geometryService } from "../core/GeometryService.js";

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

            // 自由绘制的图例：点数据已在列表里，无需再拉取 dxf
            const dxfItems = [];
            this.softlistItems.forEach((item, i) => {
                if (item.id.split('_')[0] in freestyle) {
                    item.points = this.convertPointFormat(item.points);
                    const freestyleSoft = this.createPlaneMeshFromPoints(item.points, 0x333333, 0.1);
                    if (!freestyleSoft) return;

                    freestyleSoft.userData = {
                        type: 'freestyle',
                        softlistId: item.id,
                        index: i,
                        basepoint: item.basepoint,
                        originalData: item
                    };

                    this.scene2D.add(freestyleSoft);
                    this.softlistGroups.push(freestyleSoft);
                } else {
                    dxfItems.push({ item, index: i });
                }
            });

            // 其余软装的 dxf 数据并行拉取——原先是 for 循环里逐个 await，
            // 几十个请求的往返时延被串成了一条链
            await Promise.all(dxfItems.map(({ item, index }) =>
                this.loadAndRenderSoftlistItem(item, index)
                    .catch(error => console.warn(`软装项${item.id}渲染失败:`, error))
            ));

            console.log(`软装数据加载完成，共${this.softlistGroups.length}个`);
            
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
            await geometryService.init();
            return await geometryService.getSoftlists();
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

            const data = await geometryService.getSoftlistPoints(id);

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
            // 获取几何数据
            const geometryData = await this.fetchSoftlistPoints(softlistItem.id);
            
            // 创建软装组
            const softlistGroup = new THREE.Group();
            softlistGroup.name = `Softlist_${softlistItem.id}_${index}`;
            
            // 渲染polylines：合并成单个 LineSegments。
            // 一个 dxf 常有上百条 polyline，每条平均只有 3 个点；若各自成 THREE.Line，
            // 整个场景会有上万次 draw call 去画几万个顶点，纯属调用开销。
            const lineSegments = this.createMergedPolylines(geometryData.polylines);
            if (lineSegments) {
                softlistGroup.add(lineSegments);
            }

            // 渲染wipeouts（填充区域）
            if (geometryData.wipeouts && geometryData.wipeouts.length > 0) {
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

        } catch (error) {
            console.error(`加载软装项${softlistItem.id}失败:`, error);
            throw error;
        }
    }

    /**
     * 把一个软装的所有 polyline 合并成单个 LineSegments
     * @param {Array} polylines - polyline 数组，每条为 [[x,y], [x,y], ...]
     * @returns {THREE.LineSegments|null}
     */
    createMergedPolylines(polylines) {
        if (!Array.isArray(polylines) || polylines.length === 0) {
            return null;
        }

        const z = this.defaultStyle.z;
        const positions = [];

        for (const polyline of polylines) {
            if (!polyline || polyline.length < 2) continue;

            // LineSegments 按“每两个顶点一段”消费缓冲区，
            // 因此折线的中间点需要成对展开
            for (let i = 0; i < polyline.length - 1; i++) {
                const a = polyline[i];
                const b = polyline[i + 1];
                positions.push(a[0], a[1], z, b[0], b[1], z);
            }
        }

        if (positions.length === 0) {
            return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        // 材质按软装项独立：选择器高亮时会替换 child.material
        const material = new THREE.LineBasicMaterial({
            color: this.defaultStyle.polylineColor
        });

        const lines = new THREE.LineSegments(geometry, material);
        lines.name = 'Polylines';
        lines.userData = { type: 'softlist-polyline' };

        return lines;
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
                // scale 为 -1 表示沿该轴翻转，makeScale 直接支持
                scaleX = softlistItem.scale.x || 1;
                scaleY = softlistItem.scale.y || 1;
                scaleZ = softlistItem.scale.z || 1;
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
        const valid = Array.isArray(Points)
            ? Points.filter(p => p && typeof p.x === 'number' && typeof p.y === 'number')
            : [];

        if (valid.length < 3) {
            console.warn('自由绘制轮廓有效点不足3个，跳过');
            return null;
        }

        const shape = new THREE.Shape();
        shape.moveTo(valid[0].x, valid[0].y);
        for (let i = 1; i < valid.length; i++) {
            shape.lineTo(valid[i].x, valid[i].y);
        }
        shape.closePath();

        const mesh = new THREE.Mesh(
            new THREE.ShapeGeometry(shape),
            new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
        );
        mesh.position.z = z;

        return mesh;
    }
}