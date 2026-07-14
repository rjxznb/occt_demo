/**
 * DXF材质编辑侧边栏
 * 用于编辑选中软装图例的材质属性
 */
export class DXFMaterialSidebar {
    constructor() {
        this.isVisible = false;
        this.selectedSoftlist = null;
        this.selectedSoftlistId = null;
        this.originalMaterials = new Map(); // 存储原始材质
        
        // 材质预设
        this.materialPresets = {
            default: { name: '默认', color: '#666666', opacity: 0.8, roughness: 0.5, metalness: 0 },
            wood: { name: '木材', color: '#8B4513', opacity: 1.0, roughness: 0.8, metalness: 0 },
            metal: { name: '金属', color: '#C0C0C0', opacity: 1.0, roughness: 0.1, metalness: 0.9 },
            glass: { name: '玻璃', color: '#87CEEB', opacity: 0.3, roughness: 0.1, metalness: 0 },
            plastic: { name: '塑料', color: '#FF6B6B', opacity: 1.0, roughness: 0.7, metalness: 0 },
            fabric: { name: '布料', color: '#DDA0DD', opacity: 1.0, roughness: 0.9, metalness: 0 },
            concrete: { name: '混凝土', color: '#696969', opacity: 1.0, roughness: 0.8, metalness: 0 },
            ceramic: { name: '陶瓷', color: '#F5F5DC', opacity: 1.0, roughness: 0.2, metalness: 0 }
        };
        
        this.currentMaterial = { ...this.materialPresets.default };
        
        this.createSidebar();
        this.bindEvents();
    }

    /**
     * 创建侧边栏DOM结构
     */
    createSidebar() {
        // 创建侧边栏容器
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'dxf-material-sidebar';
        this.sidebar.className = 'dxf-material-sidebar hidden';
        
        this.sidebar.innerHTML = `
            <div class="sidebar-header">
                <h3>材质编辑器</h3>
                <button class="close-btn" id="close-material-sidebar">×</button>
            </div>
            
            <div class="sidebar-content">
                <!-- 软装信息 -->
                <div class="section">
                    <h4>软装信息</h4>
                    <div class="softlist-info">
                        <p><span class="label">ID:</span> <span id="softlist-id">-</span></p>
                        <p><span class="label">类型:</span> <span id="softlist-type">DXF图例</span></p>
                    </div>
                </div>

                <!-- 材质预设 -->
                <div class="section">
                    <h4>材质预设</h4>
                    <div class="preset-grid" id="material-presets">
                        ${Object.entries(this.materialPresets).map(([key, preset]) => `
                            <div class="preset-item" data-preset="${key}">
                                <div class="preset-preview" style="background: ${preset.color}"></div>
                                <span class="preset-name">${preset.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- 颜色控制 -->
                <div class="section">
                    <h4>颜色</h4>
                    <div class="color-controls">
                        <div class="control-row">
                            <label for="material-color">基础颜色</label>
                            <div class="color-input-wrapper">
                                <input type="color" id="material-color" value="#666666">
                                <input type="text" id="material-color-hex" value="#666666" maxlength="7">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 材质属性 -->
                <div class="section">
                    <h4>材质属性</h4>
                    <div class="material-properties">
                        <div class="control-row">
                            <label for="material-opacity">透明度</label>
                            <div class="slider-wrapper">
                                <input type="range" id="material-opacity" min="0" max="1" step="0.01" value="0.8">
                                <span class="slider-value">0.8</span>
                            </div>
                        </div>
                        
                        <div class="control-row">
                            <label for="material-roughness">粗糙度</label>
                            <div class="slider-wrapper">
                                <input type="range" id="material-roughness" min="0" max="1" step="0.01" value="0.5">
                                <span class="slider-value">0.5</span>
                            </div>
                        </div>
                        
                        <div class="control-row">
                            <label for="material-metalness">金属度</label>
                            <div class="slider-wrapper">
                                <input type="range" id="material-metalness" min="0" max="1" step="0.01" value="0">
                                <span class="slider-value">0.0</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 操作按钮 -->
                <div class="section">
                    <div class="button-group">
                        <button class="btn btn-primary" id="apply-material">应用材质</button>
                        <button class="btn btn-secondary" id="reset-material">重置</button>
                    </div>
                </div>
            </div>
        `;

        // 添加样式
        this.addStyles();
        
        // 添加到页面
        document.body.appendChild(this.sidebar);
        
        console.log('DXF材质侧边栏创建完成');
    }

    /**
     * 添加样式
     */
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .dxf-material-sidebar {
                position: fixed;
                top: 0;
                right: 0;
                width: 320px;
                height: 100vh;
                background: rgba(0, 0, 0, 0.95);
                backdrop-filter: blur(10px);
                border-left: 1px solid rgba(255, 255, 255, 0.1);
                z-index: 2000;
                transform: translateX(100%);
                transition: transform 0.3s ease;
                overflow-y: auto;
            }

            .dxf-material-sidebar.visible {
                transform: translateX(0);
            }

            .dxf-material-sidebar.hidden {
                transform: translateX(100%);
            }

            .sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }

            .sidebar-header h3 {
                margin: 0;
                color: #fff;
                font-size: 18px;
                font-weight: 600;
            }

            .close-btn {
                background: none;
                border: none;
                color: #ccc;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
            }

            .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }

            .sidebar-content {
                padding: 20px;
            }

            .section {
                margin-bottom: 24px;
            }

            .section h4 {
                margin: 0 0 12px 0;
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .softlist-info p {
                margin: 8px 0;
                color: #ccc;
                font-size: 14px;
            }

            .softlist-info .label {
                color: #888;
                min-width: 40px;
                display: inline-block;
            }

            .preset-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            }

            .preset-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 12px;
                background: rgba(255, 255, 255, 0.05);
                border: 2px solid transparent;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .preset-item:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.2);
            }

            .preset-item.active {
                border-color: #00ff88;
                background: rgba(0, 255, 136, 0.1);
            }

            .preset-preview {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                margin-bottom: 8px;
                border: 2px solid rgba(255, 255, 255, 0.2);
            }

            .preset-name {
                color: #ccc;
                font-size: 12px;
                text-align: center;
            }

            .control-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }

            .control-row label {
                color: #ccc;
                font-size: 14px;
                min-width: 80px;
            }

            .color-input-wrapper {
                display: flex;
                gap: 8px;
            }

            .color-input-wrapper input[type="color"] {
                width: 40px;
                height: 32px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }

            .color-input-wrapper input[type="text"] {
                width: 80px;
                padding: 6px 8px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                color: #fff;
                font-size: 12px;
                font-family: monospace;
            }

            .slider-wrapper {
                display: flex;
                align-items: center;
                gap: 12px;
                flex: 1;
                margin-left: 12px;
            }

            .slider-wrapper input[type="range"] {
                flex: 1;
                height: 6px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                outline: none;
            }

            .slider-wrapper input[type="range"]::-webkit-slider-thumb {
                appearance: none;
                width: 16px;
                height: 16px;
                background: #00ff88;
                border-radius: 50%;
                cursor: pointer;
            }

            .slider-value {
                color: #ccc;
                font-size: 12px;
                font-family: monospace;
                min-width: 40px;
                text-align: right;
            }

            .button-group {
                display: flex;
                gap: 12px;
            }

            .btn {
                flex: 1;
                padding: 12px 16px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.2s ease;
            }

            .btn-primary {
                background: #00ff88;
                color: #000;
            }

            .btn-primary:hover {
                background: #00dd77;
                transform: translateY(-1px);
            }

            .btn-secondary {
                background: rgba(255, 255, 255, 0.1);
                color: #ccc;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }

            .btn-secondary:hover {
                background: rgba(255, 255, 255, 0.2);
                color: #fff;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 关闭按钮
        this.sidebar.querySelector('#close-material-sidebar').addEventListener('click', () => {
            this.hide();
        });

        // 预设材质选择
        this.sidebar.querySelector('#material-presets').addEventListener('click', (e) => {
            const presetItem = e.target.closest('.preset-item');
            if (presetItem) {
                const presetKey = presetItem.dataset.preset;
                this.applyPreset(presetKey);
            }
        });

        // 颜色控件
        const colorInput = this.sidebar.querySelector('#material-color');
        const colorHexInput = this.sidebar.querySelector('#material-color-hex');
        
        colorInput.addEventListener('input', (e) => {
            const color = e.target.value;
            colorHexInput.value = color;
            this.currentMaterial.color = color;
            this.updatePreview();
        });

        colorHexInput.addEventListener('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                colorInput.value = color;
                this.currentMaterial.color = color;
                this.updatePreview();
            }
        });

        // 滑动条控件
        const sliders = ['opacity', 'roughness', 'metalness'];
        sliders.forEach(prop => {
            const slider = this.sidebar.querySelector(`#material-${prop}`);
            const valueDisplay = slider.parentElement.querySelector('.slider-value');
            
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.currentMaterial[prop] = value;
                valueDisplay.textContent = value.toFixed(2);
                this.updatePreview();
            });
        });

        // 应用材质按钮
        this.sidebar.querySelector('#apply-material').addEventListener('click', () => {
            this.applyMaterial();
        });

        // 重置按钮
        this.sidebar.querySelector('#reset-material').addEventListener('click', () => {
            this.resetMaterial();
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }

    /**
     * 显示侧边栏
     * @param {THREE.Group} softlistGroup - 选中的软装组
     * @param {string} softlistId - 软装ID
     */
    show(softlistGroup, softlistId) {
        this.selectedSoftlist = softlistGroup;
        this.selectedSoftlistId = softlistId;
        this.isVisible = true;
        
        // 更新软装信息显示
        this.sidebar.querySelector('#softlist-id').textContent = softlistId;
        
        // 保存原始材质
        this.saveOriginalMaterials(softlistGroup);
        
        // 显示侧边栏
        this.sidebar.classList.remove('hidden');
        this.sidebar.classList.add('visible');
        
        // 重置为默认材质
        this.applyPreset('default');
        
        console.log(`材质编辑器已打开，软装ID: ${softlistId}`);
    }

    /**
     * 隐藏侧边栏
     */
    hide() {
        this.isVisible = false;
        this.selectedSoftlist = null;
        this.selectedSoftlistId = null;
        
        this.sidebar.classList.remove('visible');
        this.sidebar.classList.add('hidden');
        
        console.log('材质编辑器已关闭');
    }

    /**
     * 保存原始材质
     * @param {THREE.Group} softlistGroup - 软装组
     */
    saveOriginalMaterials(softlistGroup) {
        this.originalMaterials.clear();
        
        softlistGroup.traverse((child) => {
            if ((child.isMesh || child.isLine) && child.material) {
                this.originalMaterials.set(child.uuid, {
                    material: child.material.clone(),
                    object: child
                });
            }
        });
        
        console.log(`已保存 ${this.originalMaterials.size} 个原始材质`);
    }

    /**
     * 应用预设材质
     * @param {string} presetKey - 预设键名
     */
    applyPreset(presetKey) {
        if (!this.materialPresets[presetKey]) return;
        
        const preset = this.materialPresets[presetKey];
        this.currentMaterial = { ...preset };
        
        // 更新UI控件
        this.updateControls();
        
        // 更新预览
        this.updatePreview();
        
        // 更新预设选择状态
        this.sidebar.querySelectorAll('.preset-item').forEach(item => {
            item.classList.toggle('active', item.dataset.preset === presetKey);
        });
        
        console.log(`应用预设材质: ${preset.name}`);
    }

    /**
     * 更新控件值
     */
    updateControls() {
        this.sidebar.querySelector('#material-color').value = this.currentMaterial.color;
        this.sidebar.querySelector('#material-color-hex').value = this.currentMaterial.color;
        
        const sliders = ['opacity', 'roughness', 'metalness'];
        sliders.forEach(prop => {
            const slider = this.sidebar.querySelector(`#material-${prop}`);
            const valueDisplay = slider.parentElement.querySelector('.slider-value');
            const value = this.currentMaterial[prop];
            
            slider.value = value;
            valueDisplay.textContent = value.toFixed(2);
        });
    }

    /**
     * 实时预览材质效果
     */
    updatePreview() {
        if (!this.selectedSoftlist) return;
        
        this.selectedSoftlist.traverse((child) => {
            if ((child.isMesh || child.isLine) && child.material) {
                // 创建新材质或更新现有材质
                if (child.isMesh) {
                    // Mesh使用MeshBasicMaterial
                    if (!(child.material.isMeshBasicMaterial)) {
                        child.material = new THREE.MeshBasicMaterial();
                    }
                    child.material.color.setStyle(this.currentMaterial.color);
                    child.material.transparent = this.currentMaterial.opacity < 1.0;
                    child.material.opacity = this.currentMaterial.opacity;
                } else if (child.isLine) {
                    // Line使用LineBasicMaterial
                    if (!(child.material.isLineBasicMaterial)) {
                        child.material = new THREE.LineBasicMaterial();
                    }
                    child.material.color.setStyle(this.currentMaterial.color);
                    child.material.transparent = this.currentMaterial.opacity < 1.0;
                    child.material.opacity = this.currentMaterial.opacity;
                }
                
                child.material.needsUpdate = true;
            }
        });
    }

    /**
     * 应用材质
     */
    applyMaterial() {
        if (!this.selectedSoftlist) return;
        
        this.updatePreview();
        console.log(`材质已应用到软装 ${this.selectedSoftlistId}:`, this.currentMaterial);
        
        // 通知选择器更新材质备份，防止材质被恢复
        if (this.onMaterialApplied) {
            this.onMaterialApplied(this.selectedSoftlist, this.selectedSoftlistId, this.currentMaterial);
        }
        
        // 可以在这里添加保存到服务器的逻辑
        // this.saveMaterialToServer(this.selectedSoftlistId, this.currentMaterial);
    }

    /**
     * 重置材质
     */
    resetMaterial() {
        if (!this.selectedSoftlist || this.originalMaterials.size === 0) return;
        
        // 恢复原始材质
        this.originalMaterials.forEach(({ material, object }) => {
            object.material = material;
        });
        
        // 重置为默认预设
        this.applyPreset('default');
        
        console.log(`已重置软装 ${this.selectedSoftlistId} 的材质`);
    }

    /**
     * 检查是否可见
     * @returns {boolean} 是否可见
     */
    isOpen() {
        return this.isVisible;
    }

    /**
     * 销毁组件
     */
    dispose() {
        if (this.sidebar && this.sidebar.parentNode) {
            this.sidebar.parentNode.removeChild(this.sidebar);
        }
        this.originalMaterials.clear();
    }
}