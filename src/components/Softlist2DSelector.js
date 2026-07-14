import * as THREE from 'three';

/**
 * 2D软装选择器 - 处理2D平面图中软装的点击选择和高亮显示
 */
export class Softlist2DSelector {
    constructor(sceneManager2D) {
        this.sceneManager = sceneManager2D;
        this.scene = sceneManager2D.getScene();
        this.renderer = sceneManager2D.getRenderer();
        
        // 射线投射器
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // 软装管理
        this.softlistGroups = [];
        this.selectedSoftlist = null;
        this.highlightObject = null;
        this.hoverObject = null; // 悬停高亮对象
        this.currentHoverSoftlist = null; // 当前悬停的软装
        this.enabled = true; // 控制是否启用选择功能
        
        // 材质持久性管理
        this.appliedMaterials = new Map(); // 存储用户应用的材质
        
        // 高亮样式配置
        this.highlightConfig = {
            color: 0x00FF00,
            opacity: 0.7,
            strokeColor: 0x00AA00,
            strokeWidth: 2,
            scale: 1.1, // 高亮时的缩放倍数
            hoverColor: 0x88FF88, // 悬停时的颜色
            hoverOpacity: 0.4,
            hoverStrokeColor: 0x66DD66,
            hoverStrokeWidth: 1.5
        };
        
        this.bindEvents();
    }

    /**
     * 绑定鼠标事件
     */
    bindEvents() {
        this.handleMouseDownBound = this.handleSoftlistMouseDown.bind(this);
        this.handleMouseMoveBound = this.handleSoftlistMouseMove.bind(this);
        // 使用捕获阶段监听，确保软装选择器优先于房间选择器处理事件
        this.renderer.domElement.addEventListener('mousedown', this.handleMouseDownBound, true);
        this.renderer.domElement.addEventListener('mousemove', this.handleMouseMoveBound, true);
    }

    /**
     * 设置选择器启用状态
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled && this.selectedSoftlist) {
            // 禁用时清除当前选择
            this.clearSelection();
        }
        console.log('2D软装选择器', enabled ? '已启用' : '已禁用');
    }

    /**
     * 添加可选择的软装组
     * @param {THREE.Group} softlistGroup - 软装组对象
     */
    addSoftlist(softlistGroup) {
        if (softlistGroup && !this.softlistGroups.includes(softlistGroup)) {
            // 为软装组添加标识信息
            softlistGroup.userData = {
                ...softlistGroup.userData,
                isSelectable: true
            };
            this.softlistGroups.push(softlistGroup);
        }
    }

    /**
     * 批量添加软装组
     * @param {Array} softlistGroups - 软装组数组
     */
    addSoftlists(softlistGroups) {
        if (Array.isArray(softlistGroups)) {
            console.log(`批量添加 ${softlistGroups.length} 个软装组到选择器`);
            softlistGroups.forEach((group, index) => {
                console.log(`添加软装组 ${index}: ${group.name}, 子对象数量: ${group.children.length}`);
                this.addSoftlist(group);
            });
            console.log(`软装选择器初始化完成，总计 ${this.softlistGroups.length} 个可选择软装组`);
        }
    }

    /**
     * 处理软装鼠标按下事件
     * @param {Event} event - 鼠标按下事件
     */
    handleSoftlistMouseDown(event) {
        console.log('软装选择器: 接收到鼠标按下事件 (捕获阶段)');
        
        if (!this.enabled) {
            console.log('软装选择器: 未启用，跳过');
            return; // 禁用状态下不处理点击
        }
        
        // 只处理左键按下
        if (event.button !== 0) {
            return;
        }

        // 检查是否有其他选择器已经处理了这个事件
        if (window.__selectionHandled) {
            console.log('软装选择器: 检测到其他选择器已处理事件，跳过');
            return;
        }
        
        // 计算标准化鼠标坐标（相对于2D canvas）
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.getCamera());

        // 获取所有可选择的软装子对象
        const selectableObjects = [];
        this.softlistGroups.forEach(group => {
            if (group.visible && group.userData.isSelectable) {
                group.traverse((child) => {
                    if ((child.isMesh || child.isLine) && child.visible) {
                        selectableObjects.push(child);
                    }
                });
            }
        });

        // 检测与软装的碰撞
        const intersects = this.raycaster.intersectObjects(selectableObjects);

        console.log(`射线检测: 可选对象数量=${selectableObjects.length}, 碰撞结果数量=${intersects.length}`);
        
        if (intersects.length > 0) {
            // 找到距离最近的交点（通常软装在房间之上）
            const intersection = intersects[0];
            const hitObject = intersection.object;
            
            console.log('碰撞到软装对象:', {
                name: hitObject.name,
                type: hitObject.userData.type,
                distance: intersection.distance,
                point: intersection.point
            });
            
            // 找到包含这个子对象的软装组
            let softlistGroup = hitObject;
            while (softlistGroup.parent && softlistGroup.userData.type !== 'softlist') {
                softlistGroup = softlistGroup.parent;
            }
            
            if (softlistGroup.userData.type === 'softlist') {
                console.log('成功识别软装组:', softlistGroup.userData.softlistId);
                
                // 立即阻止事件传播，防止房间选择器处理
                event.stopPropagation();
                event.stopImmediatePropagation();
                event.preventDefault();
                
                // 设置全局标志，让其他选择器知道已经有对象被选中
                window.__selectionHandled = true;
                setTimeout(() => {
                    window.__selectionHandled = false;
                }, 50); // 增加延迟时间确保其他选择器能检测到
                
                // 检查是否点击的是已选中的软装
                if (this.selectedSoftlist === softlistGroup) {
                    console.log('再次点击已选中软装，取消选择');
                    this.clearSelection();
                } else {
                    console.log('选择软装:', softlistGroup.userData.softlistId);
                    this.selectSoftlist(softlistGroup);
                }

                return; // 直接返回，不处理后续逻辑
            }
        } else {
            // 点击空白处，取消选择
            this.clearSelection();
        }
    }

    /**
     * 处理软装鼠标移动事件（悬停效果）
     * @param {Event} event - 鼠标移动事件
     */
    handleSoftlistMouseMove(event) {
        if (!this.enabled) {
            return; // 禁用状态下不处理悬停
        }

        // 计算标准化鼠标坐标
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 更新射线
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.getCamera());

        // 获取所有可选择的软装子对象
        const selectableObjects = [];
        this.softlistGroups.forEach(group => {
            if (group.visible && group.userData.isSelectable) {
                group.traverse((child) => {
                    if ((child.isMesh || child.isLine) && child.visible) {
                        selectableObjects.push(child);
                    }
                });
            }
        });

        // 检测与软装的碰撞
        const intersects = this.raycaster.intersectObjects(selectableObjects);

        if (intersects.length > 0) {
            const hitObject = intersects[0].object;
            
            // 找到包含这个子对象的软装组
            let softlistGroup = hitObject;
            while (softlistGroup.parent && softlistGroup.userData.type !== 'softlist') {
                softlistGroup = softlistGroup.parent;
            }
            
            if (softlistGroup.userData.type === 'softlist') {
                // 设置全局标志，防止房间选择器处理悬停事件
                window.__hoverHandled = true;
                
                // 如果是新的悬停软装或者当前没有悬停软装
                if (softlistGroup !== this.currentHoverSoftlist) {
                    this.clearHover(); // 清除之前的悬停效果
                    
                    // 如果不是已选中的软装，才显示悬停效果
                    if (softlistGroup !== this.selectedSoftlist) {
                        this.createHoverHighlight(softlistGroup);
                        this.currentHoverSoftlist = softlistGroup;
                    }
                }
            }
        } else {
            // 鼠标不在任何软装上，清除悬停效果和全局标志
            window.__hoverHandled = false;
            this.clearHover();
        }
    }

    /**
     * 创建软装悬停高亮效果
     * @param {THREE.Group} softlistGroup - 软装组
     */
    createHoverHighlight(softlistGroup) {
        if (!softlistGroup) return;

        // 创建悬停高亮组
        this.hoverObject = new THREE.Group();
        
        // 遍历软装组的子对象，创建悬停效果
        softlistGroup.traverse((child) => {
            if (child === softlistGroup) return; // 跳过组本身
            
            if (child.isMesh && child.material) {
                // 创建悬停高亮Mesh轮廓
                const edgesGeometry = new THREE.EdgesGeometry(child.geometry);
                const edgesMaterial = new THREE.LineBasicMaterial({
                    color: this.highlightConfig.hoverStrokeColor,
                    linewidth: this.highlightConfig.hoverStrokeWidth,
                    transparent: true,
                    opacity: 0.8
                });
                
                const edgesLine = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                edgesLine.position.copy(child.position);
                edgesLine.rotation.copy(child.rotation);
                edgesLine.scale.copy(child.scale);
                edgesLine.renderOrder = 1500; // 高渲染优先级
                
                this.hoverObject.add(edgesLine);
                
            } else if (child.isLine && child.material) {
                // 创建悬停高亮Line
                const highlightMaterial = new THREE.LineBasicMaterial({
                    color: this.highlightConfig.hoverStrokeColor,
                    linewidth: this.highlightConfig.hoverStrokeWidth * 1.5,
                    transparent: true,
                    opacity: 0.8
                });
                
                const highlightLine = new THREE.LineSegments(child.geometry, highlightMaterial);
                highlightLine.position.copy(child.position);
                highlightLine.rotation.copy(child.rotation);
                highlightLine.scale.copy(child.scale);
                highlightLine.renderOrder = 1500;
                
                this.hoverObject.add(highlightLine);
            }
        });

        // 设置悬停对象的变换
        this.hoverObject.position.copy(softlistGroup.position);
        this.hoverObject.rotation.copy(softlistGroup.rotation);
        this.hoverObject.scale.copy(softlistGroup.scale);
        
        // 添加到场景
        this.scene.add(this.hoverObject);
    }

    /**
     * 清除悬停高亮效果
     */
    clearHover() {
        if (this.hoverObject) {
            this.scene.remove(this.hoverObject);
            
            // 清理资源
            this.hoverObject.traverse(child => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            this.hoverObject = null;
        }
        
        this.currentHoverSoftlist = null;
        
        // 清除全局悬停标志
        window.__hoverHandled = false;
    }

    /**
     * 选择软装
     * @param {THREE.Group} softlistGroup - 要选择的软装组
     */
    selectSoftlist(softlistGroup) {
        // 清除之前的选择
        this.clearSelection();
        
        // 设置新选择
        this.selectedSoftlist = softlistGroup;
        
        // 创建高亮效果
        this.createSoftlistHighlight(softlistGroup);
        
        console.log(`已选择软装 ${softlistGroup.userData.softlistId}`);
        
        // 触发选择回调
        if (this.onSoftlistSelected) {
            this.onSoftlistSelected(softlistGroup, softlistGroup.userData.softlistId);
        }
    }

    /**
     * 创建软装高亮效果
     * @param {THREE.Group} softlistGroup - 软装组
     */
    createSoftlistHighlight(softlistGroup) {
        if (!softlistGroup) return;

        // 直接修改原始对象的材质来实现高亮效果，这样更简单且有效
        this.highlightObject = [];
        
        // 遍历软装组的子对象，保存原始材质并应用高亮材质
        softlistGroup.traverse((child) => {
            if (child === softlistGroup) return; // 跳过组本身
            
            if (child.isMesh && child.material) {
                // 保存原始材质
                child.userData.originalMaterial = child.material;
                
                // 创建高亮材质
                const highlightMaterial = new THREE.MeshBasicMaterial({
                    color: this.highlightConfig.color,
                    transparent: true,
                    opacity: this.highlightConfig.opacity,
                    side: THREE.DoubleSide
                });
                
                child.material = highlightMaterial;
                this.highlightObject.push(child);
                
            } else if (child.isLine && child.material) {
                // 保存原始材质
                child.userData.originalMaterial = child.material;
                
                // 创建高亮线条材质
                const highlightMaterial = new THREE.LineBasicMaterial({
                    color: this.highlightConfig.strokeColor,
                    linewidth: this.highlightConfig.strokeWidth * 2,
                    transparent: true,
                    opacity: 0.9
                });
                
                child.material = highlightMaterial;
                this.highlightObject.push(child);
            }
        });

        // 应用高亮缩放效果到整个组
        softlistGroup.userData.originalScale = {
            x: softlistGroup.scale.x,
            y: softlistGroup.scale.y,
            z: softlistGroup.scale.z
        };
        softlistGroup.scale.multiplyScalar(this.highlightConfig.scale);

        console.log('软装高亮效果已创建，影响对象:', this.highlightObject.length);
    }


    /**
     * 清除选择
     */
    clearSelection() {
        // 清除悬停效果
        this.clearHover();
        
        if (this.highlightObject && this.highlightObject.length > 0) {
            // 恢复所有高亮对象的材质
            this.highlightObject.forEach(child => {
                if (child.userData.originalMaterial) {
                    // 先清理高亮材质
                    if (child.material && child.material.dispose) {
                        child.material.dispose();
                    }
                    
                    // 检查是否有用户应用的材质
                    const appliedMaterial = this.appliedMaterials.get(child.uuid);
                    if (appliedMaterial) {
                        // 恢复用户应用的材质
                        child.material = appliedMaterial;
                    } else {
                        // 恢复原始材质
                        child.material = child.userData.originalMaterial;
                    }
                    
                    delete child.userData.originalMaterial;
                }
            });
            
            this.highlightObject = null;
        }
        
        if (this.selectedSoftlist) {
            // 恢复原始缩放
            if (this.selectedSoftlist.userData.originalScale) {
                this.selectedSoftlist.scale.set(
                    this.selectedSoftlist.userData.originalScale.x,
                    this.selectedSoftlist.userData.originalScale.y,
                    this.selectedSoftlist.userData.originalScale.z
                );
                delete this.selectedSoftlist.userData.originalScale;
            }
            
            console.log(`取消选择软装 ${this.selectedSoftlist.userData.softlistId}`);
            
            // 触发取消选择回调
            if (this.onSoftlistDeselected) {
                this.onSoftlistDeselected(this.selectedSoftlist, this.selectedSoftlist.userData.softlistId);
            }
        }
        
        this.selectedSoftlist = null;
    }

    /**
     * 获取当前选中的软装
     * @returns {THREE.Group|null} 选中的软装组
     */
    getSelectedSoftlist() {
        return this.selectedSoftlist;
    }

    /**
     * 获取选中软装的ID
     * @returns {string|null} 软装ID
     */
    getSelectedSoftlistId() {
        return this.selectedSoftlist ? this.selectedSoftlist.userData.softlistId : null;
    }

    /**
     * 根据软装ID选择软装
     * @param {string} softlistId - 软装ID
     */
    selectSoftlistById(softlistId) {
        const softlistGroup = this.softlistGroups.find(group => 
            group.userData.softlistId === softlistId
        );
        
        if (softlistGroup) {
            this.selectSoftlist(softlistGroup);
        } else {
            console.warn(`未找到ID为 ${softlistId} 的软装`);
        }
    }

    /**
     * 设置高亮样式配置
     * @param {Object} config - 样式配置对象
     */
    setHighlightConfig(config) {
        this.highlightConfig = {
            ...this.highlightConfig,
            ...config
        };
    }

    /**
     * 软装选中回调（可被重写）
     * @param {THREE.Group} softlistGroup - 选中的软装组
     * @param {string} softlistId - 软装ID
     */
    onSoftlistSelected(softlistGroup, softlistId) {
        // 子类可以重写此方法
        console.log(`2D软装选择回调: 选中软装 ${softlistId}`);
    }

    /**
     * 软装取消选择回调（可被重写）
     * @param {THREE.Group} softlistGroup - 被取消选择的软装组
     * @param {string} softlistId - 软装ID
     */
    onSoftlistDeselected(softlistGroup, softlistId) {
        // 子类可以重写此方法
        console.log(`2D软装选择回调: 取消选择软装 ${softlistId}`);
    }

    /**
     * 更新材质备份（当材质被应用时调用）
     * @param {THREE.Group} softlistGroup - 软装组
     * @param {string} softlistId - 软装ID
     * @param {Object} materialData - 材质数据
     */
    updateAppliedMaterials(softlistGroup, softlistId, materialData) {
        if (!softlistGroup) return;
        
        console.log(`更新软装 ${softlistId} 的材质备份`);
        
        // 遍历软装组，保存当前材质为用户应用的材质
        softlistGroup.traverse((child) => {
            if ((child.isMesh || child.isLine) && child.material) {
                // 将当前材质保存为用户应用的材质
                this.appliedMaterials.set(child.uuid, child.material.clone());
            }
        });
        
        console.log(`已更新 ${this.appliedMaterials.size} 个对象的材质备份`);
    }

    /**
     * 销毁选择器
     */
    dispose() {
        this.clearSelection();
        this.softlistGroups = [];
        this.appliedMaterials.clear();
        
        // 移除事件监听
        if (this.handleMouseDownBound) {
            this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDownBound, true);
        }
        if (this.handleMouseMoveBound) {
            this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMoveBound, true);
        }
    }
}