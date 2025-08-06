import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// 选择新建模型进行编辑的类型
export class SelectionManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        // 动态获取camera和controls，不缓存引用
        this.selectedObject = null;
        this.transformControls = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.enabled = true; // 默认启用
        
        // 碰撞检测相关
        this.previousPosition = new THREE.Vector3();
        this.boundingBoxHelper = new THREE.Box3();
        this.collisionMargin = 1; // 碰撞边距，单位与场景一致
        this.collisionDetectionEnabled = true; // 默认启用碰撞检测
        
        // 上下文菜单相关
        this.contextMenu = null;
        this.contextMenuVisible = false;
        
        this.init();
    }

    init() {
        this.createTransformControls();
        this.bindEvents();
        this.initContextMenu();
    }

    createTransformControls() {
        try {
            console.log('开始创建TransformControls...');
            console.log('相机:', this.sceneManager.getCamera());
            console.log('渲染器DOM:', this.sceneManager.renderer.domElement);
            
            // 创建TransformControls（3D坐标轴控制器）
            this.transformControls = new TransformControls(
                this.sceneManager.getCamera(), 
                this.sceneManager.renderer.domElement
            );
            
            console.log('TransformControls实例:', this.transformControls);
            console.log('是否为Object3D:', this.transformControls instanceof THREE.Object3D);
            
            // 设置初始模式为移动模式
            this.transformControls.setMode('translate');
            
            // 设置控制器大小
            this.transformControls.setSize(0.8);
            
            // 初始状态隐藏TransformControls，只在选中对象时显示
            this.transformControls.visible = false;
            this.transformControls._root.visible = false;
            
            // 添加到场景中 - 使用TransformControls的根对象
            this.sceneManager.scene.add(this.transformControls._root);
            
            // 当开始拖拽时禁用轨道控制器
            this.transformControls.addEventListener('dragging-changed', (event) => {
                console.log('拖拽状态改变:', event.value);
                this.sceneManager.getControls().enabled = !event.value;
            });
            
            // 监听对象变化事件 - 添加碰撞检测
            this.transformControls.addEventListener('objectChange', () => {
                if (this.selectedObject) {
                    this.handleObjectTransformation();
                }
            });
            
            // 添加鼠标按下和释放事件监听
            this.transformControls.addEventListener('mouseDown', () => {
                console.log('TransformControls鼠标按下');
                // 保存拖拽开始时的位置
                if (this.selectedObject) {
                    this.previousPosition.copy(this.selectedObject.position);
                }
            });
            
            this.transformControls.addEventListener('mouseUp', () => {
                console.log('TransformControls鼠标释放');
            });
            
            console.log('TransformControls创建和添加成功');
        } catch (error) {
            console.error('TransformControls创建失败:', error);
            throw error;
        }
    }

    bindEvents() {
        const canvas = this.sceneManager.renderer.domElement;
        
        // 绑定事件处理器到this上下文
        this.handleClickBound = this.handleClick.bind(this);
        this.handleKeydownBound = this.handleKeydown.bind(this);
        this.handleContextMenuBound = this.handleContextMenu.bind(this);
        this.hideContextMenuBound = this.hideContextMenu.bind(this);
        
        // 监听鼠标点击事件
        canvas.addEventListener('click', this.handleClickBound);
        
        // 监听右键上下文菜单事件
        canvas.addEventListener('contextmenu', this.handleContextMenuBound);
        
        // 监听点击其他地方隐藏上下文菜单
        document.addEventListener('click', this.hideContextMenuBound);
        
        // 监听键盘事件切换控制模式
        document.addEventListener('keydown', this.handleKeydownBound);
        
        console.log('SelectionManager事件绑定完成');
    }

    handleClick(event) {
        if (!this.enabled) return;
        
        console.log('处理点击事件...');
        
        // 如果正在拖拽TransformControls，不处理点击
        if (this.transformControls.dragging) {
            console.log('正在拖拽TransformControls，忽略点击');
            return;
        }
        
        // 计算鼠标在3D场景中的位置
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        console.log('鼠标坐标:', this.mouse);
        
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.getCamera());

        // 获取所有可选择的对象（只选择用户放置的模型）
        const selectableObjects = [];
        this.sceneManager.scene.traverse((child) => {
            if (child.isMesh && 
                child.userData.type === 'placedModel' && 
                child.visible && 
                !child.userData.isHelper) {
                selectableObjects.push(child);
            }
        });

        console.log('可选择的对象数量:', selectableObjects.length);
        console.log('可选择的对象:', selectableObjects.map(obj => obj.userData.name || obj.userData.modelType));
        
        const intersects = this.raycaster.intersectObjects(selectableObjects, true);
        console.log('射线检测结果:', intersects.length);
        
        if (intersects.length > 0) {
            // 找到最顶层的可选择对象（可能是Group）
            let targetObject = intersects[0].object;
            console.log('初始目标对象:', targetObject.userData);
            
            // 如果点击的是Group的子对象，选择其父Group
            while (targetObject.parent && targetObject.parent.userData.type === 'placedModel') {
                targetObject = targetObject.parent;
                console.log('找到父对象:', targetObject.userData);
            }
            
            console.log('最终选择对象:', targetObject.userData.name || targetObject.userData.modelType);
            this.selectObject(targetObject);
        } else {
            // 点击空白处，取消选择
            console.log('点击空白处，取消选择');
            this.deselectObject();
        }
    }

    handleKeydown(event) {
        if (!this.selectedObject) return;
        
        switch (event.key.toLowerCase()) {
            case 'g': // G键 - 移动模式
                this.transformControls.setMode('translate');
                console.log('切换到移动模式');
                break;
            case 'r': // R键 - 旋转模式
                this.transformControls.setMode('rotate');
                console.log('切换到旋转模式');
                break;
            case 's': // S键 - 缩放模式
                this.transformControls.setMode('scale');
                console.log('切换到缩放模式');
                break;
            case 'escape': // ESC键 - 取消选择
                this.deselectObject();
                break;
            case 'delete': // Delete键 - 删除对象
            case 'backspace':
                this.deleteSelectedObject();
                break;
        }
    }

    // 处理右键上下文菜单
    handleContextMenu(event) {
        if (!this.enabled) return;
        
        event.preventDefault();
        console.log('处理右键上下文菜单...');
        
        // 如果没有选中对象，不显示上下文菜单
        if (!this.selectedObject) {
            console.log('没有选中对象，不显示上下文菜单');
            return;
        }

        // 如果正在拖拽TransformControls，不处理右键
        if (this.transformControls.dragging) {
            console.log('正在拖拽TransformControls，忽略右键');
            return;
        }

        // 显示上下文菜单
        this.showContextMenu(event.clientX, event.clientY);
    }

    // 隐藏上下文菜单
    hideContextMenu(event) {
        // 如果点击的是上下文菜单内部，不隐藏
        if (this.contextMenu && this.contextMenu.contains(event.target)) {
            return;
        }

        if (this.contextMenuVisible) {
            this.contextMenu.style.display = 'none';
            this.contextMenuVisible = false;
        }
    }

    // 鼠标点击对象时调用的函数；
    selectObject(object) {
        // 如果已经选择了同一个对象，不重复处理
        if (this.selectedObject === object) {
            console.log('对象已经被选中，跳过重复选择');
            return;
        }
        
        // 先取消之前的选择
        this.deselectObject();
        
        this.selectedObject = object;
        
        console.log('正在选中对象:', object.userData.name || object.userData.modelType);
        console.log('对象位置:', object.position);
        console.log('对象是否可见:', object.visible);
        
        // 将TransformControls附加到选中的对象
        this.transformControls.attach(object);
        
        // 显示TransformControls
        this.transformControls.visible = true;
        this.transformControls._root.visible = true;
        
        console.log('TransformControls已附加到对象并显示');
        console.log('TransformControls可见性:', this.transformControls.visible);
        console.log('TransformControls模式:', this.transformControls.mode);
        
        // 添加选中的视觉反馈
        this.addSelectionHighlight(object);
        
        // 触发选择事件
        if (this.onObjectSelected) {
            this.onObjectSelected(object);
        }
        
        // 保存初始位置用于碰撞检测
        this.previousPosition.copy(object.position);
    }

    // 处理对象变换时的碰撞检测
    handleObjectTransformation() {
        if (!this.selectedObject) return;

        // 只有在碰撞检测启用时才进行检查
        if (this.collisionDetectionEnabled) {
            // 检查碰撞
            if (this.checkCollisions(this.selectedObject)) {
                console.log('检测到碰撞，恢复到之前的位置');
                // 恢复到之前的位置
                this.selectedObject.position.copy(this.previousPosition);
                return; // 碰撞时不更新位置
            }
        }

        // 地面限制：
        const position = this.selectedObject.position;
        const objectBox = new THREE.Box3().setFromObject(this.selectedObject);
        const objectSize = objectBox.getSize(new THREE.Vector3());
        if (position.z < objectSize.z/2) {
            position.z = objectSize.z/2;
        }

        // 更新保存的位置
        this.previousPosition.copy(this.selectedObject.position);
    }

    // 检查与其他对象的碰撞
    checkCollisions(object) {
        // 计算当前对象的包围盒
        this.boundingBoxHelper.setFromObject(object);
        
        // 扩展包围盒以添加碰撞边距
        this.boundingBoxHelper.expandByScalar(this.collisionMargin);

        // 检查与场景中其他对象的碰撞
        let hasCollision = false;
        
        this.sceneManager.scene.traverse((child) => {
            // 跳过自身和TransformControls相关对象
            if (child === object || 
                this.isTransformControlsElement(child) ||
                !child.visible ||
                !child.isMesh) {
                return;
            }

            // 跳过自身的子对象（Group的子元素）
            if (this.isChildOfObject(child, object)) {
                return;
            }

            // 跳过外墙，不然都动不了，因为采用boundingbox检测，他直接在外墙的内部啦；
            // if (child.userData.type == 'outWall'){
            //     return;
            // }

            
            // 只与其他独立的放置模型进行碰撞检测
            if (child.userData.type !== 'placedModel' &&
                !child.userData.wallType) {
                    console.log(child.userData.wallType)
                return;
            }

            // 计算其他对象的包围盒
            const otherBox = new THREE.Box3().setFromObject(child);
            
            // 检查包围盒是否相交
            if (this.boundingBoxHelper.intersectsBox(otherBox)) {
                console.log('碰撞检测：与对象碰撞', child.userData);
                hasCollision = true;
                return; // 找到碰撞就退出遍历
            }
        });

        return hasCollision;
    }

    // 强制边界限制
    // enforceBoundaries(object) {
    //     const position = object.position;
        
    //     // 获取对象的包围盒来计算其尺寸
    //     const objectBox = new THREE.Box3().setFromObject(object);
    //     const objectSize = objectBox.getSize(new THREE.Vector3());

    //     // 设置场景边界（可以根据实际场景调整）
    //     const sceneBounds = {
    //         minX: -5000,
    //         maxX: 5000,
    //         minY: -5000,
    //         maxY: 5000,
    //         minZ: 0, // 地面高度
    //         maxZ: 3000 // 最大高度
    //     };

    //     // 限制X轴移动
    //     position.x = Math.max(sceneBounds.minX + objectSize.x/2, 
    //                          Math.min(sceneBounds.maxX - objectSize.x/2, position.x));
        
    //     // 限制Y轴移动
    //     position.y = Math.max(sceneBounds.minY + objectSize.y/2, 
    //                          Math.min(sceneBounds.maxY - objectSize.y/2, position.y));
        
    //     // 限制Z轴移动（高度）- 确保对象不会沉入地面或飞得太高
    //     position.z = Math.max(sceneBounds.minZ + objectSize.z/2, 
    //                          Math.min(sceneBounds.maxZ - objectSize.z/2, position.z));

    //     // 特殊处理：确保对象底部不低于地面
    //     if (position.z < objectSize.z/2) {
    //         position.z = objectSize.z/2;
    //     }
    // }

    deselectObject() {
        if (this.selectedObject) {
            // 移除选中的视觉反馈
            this.removeSelectionHighlight(this.selectedObject);
            
            // 分离TransformControls并隐藏
            this.transformControls.detach();
            this.transformControls.visible = false;
            this.transformControls._root.visible = false;
            
            console.log('取消选择对象并隐藏TransformControls');
            
            // 触发取消选择事件
            if (this.onObjectDeselected) {
                this.onObjectDeselected(this.selectedObject);
            }
            
            this.selectedObject = null;
        }
    }

    addSelectionHighlight(object) {
        // 为选中的对象添加发光效果
        object.traverse((child) => {
            if (child.isMesh && child.material) {
                // 保存原始材质
                if (!child.userData.originalMaterial) {
                    child.userData.originalMaterial = child.material.clone();
                }
                
                // 创建高亮材质
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(mat => {
                        const highlightMat = mat.clone();
                        highlightMat.emissive = new THREE.Color(0x444444);
                        highlightMat.emissiveIntensity = 0.3;
                        return highlightMat;
                    });
                } else {
                    const highlightMat = child.material.clone();
                    highlightMat.emissive = new THREE.Color(0x444444);
                    highlightMat.emissiveIntensity = 0.3;
                    child.material = highlightMat;
                }
            }
        });
    }

    removeSelectionHighlight(object) {
        // 恢复对象的原始材质
        object.traverse((child) => {
            if (child.isMesh && child.userData.originalMaterial) {
                child.material = child.userData.originalMaterial;
                delete child.userData.originalMaterial;
            }
        });
    }

    deleteSelectedObject() {
        if (this.selectedObject) {
            console.log('删除对象:', this.selectedObject.userData.name || this.selectedObject.userData.modelType);
            
            // 从场景中移除对象
            this.sceneManager.scene.remove(this.selectedObject);
            
            // 触发删除事件
            if (this.onObjectDeleted) {
                this.onObjectDeleted(this.selectedObject);
            }
            
            // 清理引用
            this.transformControls.detach();
            this.selectedObject = null;
        }
    }

    // 设置控制器模式
    setTransformMode(mode) {
        if (['translate', 'rotate', 'scale'].includes(mode)) {
            this.transformControls.setMode(mode);
            console.log(`切换到${mode}模式`);
        }
    }

    // 获取当前选中的对象
    getSelectedObject() {
        return this.selectedObject;
    }

    // 显示/隐藏坐标轴控制器
    setTransformControlsVisible(visible) {
        this.transformControls.visible = visible;
    }

    // 设置坐标轴控制器大小
    setTransformControlsSize(size) {
        this.transformControls.setSize(size);
    }

    // 设置碰撞检测边距
    setCollisionMargin(margin) {
        this.collisionMargin = margin;
        console.log('碰撞检测边距设置为:', margin);
    }

    // 启用/禁用碰撞检测
    setCollisionDetectionEnabled(enabled) {
        this.collisionDetectionEnabled = enabled;
        console.log('碰撞检测', enabled ? '已启用' : '已禁用');
    }

    // 检查是否为指定对象的子对象
    isChildOfObject(child, parent) {
        let current = child.parent;
        while (current) {
            if (current === parent) {
                return true;
            }
            current = current.parent;
            // 避免无限循环
            if (current && current.type === 'Scene') {
                break;
            }
        }
        return false;
    }

    // 检查是否为TransformControls的元素：用于避免给他上材质或者进行碰撞检测；
    isTransformControlsElement(object) {
        // 直接检查构造函数名称
        const constructorName = object.constructor.name;
        if (constructorName === 'TransformControlsPlane' ||
            constructorName === 'TransformControlsGizmo' ||
            constructorName === 'TransformControlsRoot' ||
            constructorName.startsWith('TransformControls')) {
            return true;
        }

        // 检查对象类型属性
        if (object.type && (
            object.type.includes('TransformControls') ||
            object.type.includes('Gizmo') ||
            object.type.includes('Helper')
        )) {
            return true;
        }
        
        // 检查对象及其父对象是否属于TransformControls
        let current = object;
        while (current) {
            // 检查是否为TransformControls的根对象
            if (current === this.transformControls._root) {
                return true;
            }
            
            // 检查对象名称是否包含TransformControls相关的标识
            if (current.name && (
                current.name.includes('TransformControls') ||
                current.name.includes('Gizmo') ||
                current.name.includes('Plane') ||
                current.name.includes('Helper')
            )) {
                return true;
            }
            
            // 检查是否为TransformControls的子对象
            if (current.userData && (
                current.userData.isTransformControl ||
                current.userData.isGizmo ||
                current.userData.isHelper
            )) {
                return true;
            }
            
            current = current.parent;
            
            // 避免无限循环，检查到Scene就停止
            if (current && current.type === 'Scene') {
                break;
            }
        }
        
        return false;
    }

    // 初始化上下文菜单
    initContextMenu() {
        this.contextMenu = document.getElementById('context-menu');
        if (!this.contextMenu) {
            console.error('未找到上下文菜单元素');
            return;
        }

        // 初始化预设颜色
        this.initPresetColors();

        // 绑定上下文菜单事件
        this.bindContextMenuEvents();

        console.log('上下文菜单初始化完成');
    }

    // 初始化预设颜色
    initPresetColors() {
        const presetColorsContainer = document.getElementById('preset-colors');
        if (!presetColorsContainer) return;

        const presetColors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
            '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
            '#F1948A', '#85C1E9', '#F4D03F', '#8E44AD',
            '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
            '#9B59B6', '#1ABC9C', '#34495E', '#95A5A6'
        ];

        presetColors.forEach(color => {
            const colorDiv = document.createElement('div');
            colorDiv.className = 'preset-color';
            colorDiv.style.backgroundColor = color;
            colorDiv.title = color;
            colorDiv.addEventListener('click', () => this.applyColor(color));
            presetColorsContainer.appendChild(colorDiv);
        });
    }

    // 绑定上下文菜单事件
    bindContextMenuEvents() {
        // 颜色选择器
        const colorPicker = document.getElementById('object-color-picker');
        if (colorPicker) {
            colorPicker.addEventListener('change', (e) => this.applyColor(e.target.value));
        }

        // 材质滑块
        const roughnessSlider = document.getElementById('roughness-slider');
        const roughnessValue = document.getElementById('roughness-value');
        if (roughnessSlider && roughnessValue) {
            roughnessSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                roughnessValue.textContent = value.toFixed(2);
                this.applyMaterialProperty('roughness', value);
            });
        }

        const metalnessSlider = document.getElementById('metalness-slider');
        const metalnessValue = document.getElementById('metalness-value');
        if (metalnessSlider && metalnessValue) {
            metalnessSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                metalnessValue.textContent = value.toFixed(2);
                this.applyMaterialProperty('metalness', value);
            });
        }

        const opacitySlider = document.getElementById('opacity-slider');
        const opacityValue = document.getElementById('opacity-value');
        if (opacitySlider && opacityValue) {
            opacitySlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                opacityValue.textContent = value.toFixed(2);
                this.applyMaterialProperty('opacity', value);
            });
        }

        // 操作按钮
        const duplicateBtn = document.getElementById('context-duplicate');
        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', () => this.duplicateSelectedObject());
        }

        const resetTransformBtn = document.getElementById('context-reset-transform');
        if (resetTransformBtn) {
            resetTransformBtn.addEventListener('click', () => this.resetTransform());
        }

        const resetMaterialBtn = document.getElementById('context-reset-material');
        if (resetMaterialBtn) {
            resetMaterialBtn.addEventListener('click', () => this.resetMaterial());
        }

        const deleteBtn = document.getElementById('context-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteSelectedObject();
                this.hideContextMenu({ target: document.body });
            });
        }
    }

    // 显示上下文菜单
    showContextMenu(x, y) {
        if (!this.contextMenu || !this.selectedObject) return;

        // 更新菜单状态以反映当前选中对象的属性
        this.updateContextMenuValues();

        // 显示菜单
        this.contextMenu.style.display = 'block';
        this.contextMenuVisible = true;

        // 调整菜单位置，确保不超出屏幕边界
        const menuRect = this.contextMenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let menuX = x;
        let menuY = y;

        // 防止菜单超出右边界
        if (x + menuRect.width > viewportWidth) {
            menuX = viewportWidth - menuRect.width - 10;
        }

        // 防止菜单超出下边界
        if (y + menuRect.height > viewportHeight) {
            menuY = viewportHeight - menuRect.height - 10;
        }

        // 防止菜单超出左边界和上边界
        menuX = Math.max(10, menuX);
        menuY = Math.max(10, menuY);

        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';

        console.log(`上下文菜单显示在位置: (${menuX}, ${menuY})`);
    }

    // 更新上下文菜单的值以反映当前对象状态
    updateContextMenuValues() {
        if (!this.selectedObject) return;

        // 获取对象的材质
        let material = null;
        if (this.selectedObject.material) {
            material = Array.isArray(this.selectedObject.material) 
                ? this.selectedObject.material[0] 
                : this.selectedObject.material;
        } else {
            // 如果是Group，尝试获取第一个子对象的材质
            this.selectedObject.traverse((child) => {
                if (child.isMesh && child.material && !material) {
                    material = Array.isArray(child.material) 
                        ? child.material[0] 
                        : child.material;
                }
            });
        }

        if (material) {
            // 更新颜色选择器
            const colorPicker = document.getElementById('object-color-picker');
            if (colorPicker && material.color) {
                colorPicker.value = `#${material.color.getHexString()}`;
            }

            // 更新材质属性滑块
            const roughnessSlider = document.getElementById('roughness-slider');
            const roughnessValue = document.getElementById('roughness-value');
            if (roughnessSlider && roughnessValue && material.roughness !== undefined) {
                roughnessSlider.value = material.roughness;
                roughnessValue.textContent = material.roughness.toFixed(2);
            }

            const metalnessSlider = document.getElementById('metalness-slider');
            const metalnessValue = document.getElementById('metalness-value');
            if (metalnessSlider && metalnessValue && material.metalness !== undefined) {
                metalnessSlider.value = material.metalness;
                metalnessValue.textContent = material.metalness.toFixed(2);
            }

            const opacitySlider = document.getElementById('opacity-slider');
            const opacityValue = document.getElementById('opacity-value');
            if (opacitySlider && opacityValue && material.opacity !== undefined) {
                opacitySlider.value = material.opacity;
                opacityValue.textContent = material.opacity.toFixed(2);
            }
        }
    }

    // 应用颜色到选中对象
    applyColor(colorHex) {
        if (!this.selectedObject) return;

        const color = new THREE.Color(colorHex);
        console.log(`应用颜色 ${colorHex} 到对象:`, this.selectedObject);

        // 应用颜色到对象的所有材质
        this.selectedObject.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat.color) {
                            mat.color.copy(color);
                            mat.needsUpdate = true;
                        }
                    });
                } else if (child.material.color) {
                    child.material.color.copy(color);
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    // 应用材质属性
    applyMaterialProperty(property, value) {
        if (!this.selectedObject) return;

        console.log(`应用材质属性 ${property}: ${value} 到对象:`, this.selectedObject);

        this.selectedObject.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat[property] !== undefined) {
                            mat[property] = value;
                            if (property === 'opacity') {
                                mat.transparent = value < 1.0;
                            }
                            mat.needsUpdate = true;
                        }
                    });
                } else if (child.material[property] !== undefined) {
                    child.material[property] = value;
                    if (property === 'opacity') {
                        child.material.transparent = value < 1.0;
                    }
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    // 复制选中对象
    duplicateSelectedObject() {
        if (!this.selectedObject) return;

        console.log('复制对象:', this.selectedObject);

        try {
            // 克隆对象
            const clonedObject = this.selectedObject.clone();
            
            // 偏移位置避免重叠
            clonedObject.position.x += 200; // 向右偏移200单位
            
            // 复制userData
            clonedObject.userData = { ...this.selectedObject.userData };
            clonedObject.userData.createdAt = Date.now();

            // 添加到场景
            this.sceneManager.scene.add(clonedObject);

            // 选择新创建的对象
            this.selectObject(clonedObject);

            console.log('对象复制成功:', clonedObject);
        } catch (error) {
            console.error('复制对象失败:', error);
        }

        // 隐藏上下文菜单
        this.hideContextMenu({ target: document.body });
    }

    // 重置变换
    resetTransform() {
        if (!this.selectedObject) return;

        console.log('重置对象变换:', this.selectedObject);

        // 重置位置、旋转和缩放
        this.selectedObject.position.set(0, 0, 0);
        this.selectedObject.rotation.set(0, 0, 0);
        this.selectedObject.scale.set(1, 1, 1);

        // 更新保存的位置
        this.previousPosition.copy(this.selectedObject.position);

        // 隐藏上下文菜单
        this.hideContextMenu({ target: document.body });
    }

    // 重置材质
    resetMaterial() {
        if (!this.selectedObject) return;

        console.log('重置对象材质:', this.selectedObject);

        this.selectedObject.traverse((child) => {
            if (child.isMesh && child.material) {
                // 创建新的标准材质
                const newMaterial = new THREE.MeshStandardMaterial({
                    color: 0x8B4513,
                    roughness: 0.3,
                    metalness: 0.2,
                    transparent: false,
                    opacity: 1.0
                });

                if (Array.isArray(child.material)) {
                    child.material = child.material.map(() => newMaterial.clone());
                } else {
                    child.material = newMaterial;
                }
            }
        });

        // 更新菜单值
        this.updateContextMenuValues();

        // 隐藏上下文菜单
        this.hideContextMenu({ target: document.body });
    }

    // 清理资源
    destroy() {
        if (this.transformControls) {
            this.sceneManager.scene.remove(this.transformControls._root);
            this.transformControls.dispose();
        }
        
        // 移除事件监听器
        const canvas = this.sceneManager.renderer.domElement;
        if (this.handleClickBound) {
            canvas.removeEventListener('click', this.handleClickBound);
        }
        if (this.handleContextMenuBound) {
            canvas.removeEventListener('contextmenu', this.handleContextMenuBound);
        }
        if (this.hideContextMenuBound) {
            document.removeEventListener('click', this.hideContextMenuBound);
        }
        if (this.handleKeydownBound) {
            document.removeEventListener('keydown', this.handleKeydownBound);
        }
        
        this.selectedObject = null;
        this.contextMenu = null;
    }

    /**
     * 启用/禁用选择管理器
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        
        // 禁用时隐藏transform控件和上下文菜单
        if (!enabled) {
            if (this.transformControls) {
                this.transformControls.visible = false;
            }
            this.hideContextMenu({ target: document.body });
        } else if (this.selectedObject && this.transformControls) {
            this.transformControls.visible = true;
        }
        
        console.log(`选择管理器已${enabled ? '启用' : '禁用'}`);
    }

}