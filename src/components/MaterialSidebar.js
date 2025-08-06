import * as THREE from 'three';

export class MaterialSidebar {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.isVisible = false;
        this.isCollapsed = false;
        this.currentTab = 'materials';
        this.materialPreviews = [];
        this.modelPreviews = [];
        
        // 自定义材质相关
        this.customMaterials = [];
        this.textureLoader = new THREE.TextureLoader();
        
        // 调整大小相关
        this.isResizing = false;
        this.startX = 0;
        this.startWidth = 320;
        this.minWidth = 280;
        this.maxWidth = window.innerWidth * 0.5;
        
        this.init();
    }

    init() {
        this.createSidebarHTML();
        this.bindEvents();
        this.loadMaterials();
        this.loadModels();
    }

    createSidebarHTML() {
        // 创建侧边栏容器
        const sidebar = document.createElement('div');
        sidebar.id = 'material-sidebar';
        sidebar.className = 'material-sidebar';
        sidebar.innerHTML = `
            <!-- 调整大小手柄 -->
            <div class="sidebar-resize-handle"></div>
            
            <!-- 收起/展开按钮 -->
            <div class="sidebar-collapse-btn" title="收起/展开侧边栏">
                <span class="collapse-icon">‹</span>
            </div>
            
            <div class="sidebar-header">
                <h3>资源库</h3>
                <button id="close-sidebar" class="close-btn">×</button>
            </div>
            
            <div class="sidebar-tabs">
                <button class="tab-btn active" data-tab="materials">材质</button>
                <button class="tab-btn" data-tab="models">模型</button>
            </div>
            
            <div class="sidebar-content">
                <div id="materials-panel" class="panel active">
                    <div class="panel-title">拖拽材质到物体上</div>
                    <div id="materials-grid" class="materials-grid"></div>
                </div>
                
                <div id="models-panel" class="panel">
                    <div class="panel-title">拖拽模型到场景中</div>
                    <div id="models-grid" class="models-grid"></div>
                </div>
            </div>
            
            <!-- 收起状态的简化图标 -->
            <div class="sidebar-collapsed-icons">
                <div class="collapsed-icon" title="材质">🎨</div>
                <div class="collapsed-icon" title="模型">📦</div>
            </div>
        `;

        document.body.appendChild(sidebar);
        this.sidebar = sidebar;
    }

    bindEvents() {
        // 关闭按钮
        document.getElementById('close-sidebar').addEventListener('click', () => {
            this.hide();
        });

        // 选项卡切换
        this.sidebar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // 收起/展开按钮
        const collapseBtn = this.sidebar.querySelector('.sidebar-collapse-btn');
        collapseBtn.addEventListener('click', () => {
            this.toggleCollapse();
        });

        // 调整大小功能
        this.setupResizeHandlers();

        // 收起状态下的图标点击
        this.sidebar.querySelectorAll('.collapsed-icon').forEach((icon, index) => {
            icon.addEventListener('click', () => {
                if (this.isCollapsed) {
                    this.expand();
                    // 自动切换到对应选项卡
                    this.switchTab(index === 0 ? 'materials' : 'models');
                }
            });
        });
    }

    setupResizeHandlers() {
        const resizeHandle = this.sidebar.querySelector('.sidebar-resize-handle');
        
        resizeHandle.addEventListener('mousedown', (e) => {
            if (this.isCollapsed) return;
            
            this.isResizing = true;
            this.startX = e.clientX;
            this.startWidth = parseInt(window.getComputedStyle(this.sidebar).width, 10);
            
            resizeHandle.classList.add('resizing');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;
            
            const deltaX = this.startX - e.clientX; // 向左拖拽为正值
            const newWidth = Math.min(this.maxWidth, Math.max(this.minWidth, this.startWidth + deltaX));
            
            this.sidebar.style.width = newWidth + 'px';
            this.sidebar.style.right = this.isVisible ? '0px' : `-${newWidth}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!this.isResizing) return;
            
            this.isResizing = false;
            resizeHandle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });

        // 窗口大小改变时更新最大宽度
        window.addEventListener('resize', () => {
            this.maxWidth = window.innerWidth * 0.5;
            const currentWidth = parseInt(window.getComputedStyle(this.sidebar).width, 10);
            if (currentWidth > this.maxWidth) {
                this.sidebar.style.width = this.maxWidth + 'px';
            }
        });
    }

    toggleCollapse() {
        if (this.isCollapsed) {
            this.expand();
        } else {
            this.collapse();
        }
    }

    collapse() {
        this.isCollapsed = true;
        this.sidebar.classList.add('collapsed');
        
        // 更新收起按钮图标
        const collapseIcon = this.sidebar.querySelector('.collapse-icon');
        collapseIcon.textContent = '›';
        
        console.log('侧边栏已收起');
    }

    expand() {
        this.isCollapsed = false;
        this.sidebar.classList.remove('collapsed');
        
        // 更新展开按钮图标
        const collapseIcon = this.sidebar.querySelector('.collapse-icon');
        collapseIcon.textContent = '‹';
        
        console.log('侧边栏已展开');
    }

    loadMaterials() {
        const materialsGrid = document.getElementById('materials-grid');
        
        // 定义专业级建筑材质类型
        const materialTypes = [
            // 自然材质
            { name: '天然橡木', color: 0xD2B48C, roughness: 0.85, metalness: 0.02, icon: '🌳' },
            { name: '胡桃木', color: 0x8B4513, roughness: 0.75, metalness: 0.01, icon: '🪵' },
            { name: '白桦木', color: 0xF5DEB3, roughness: 0.9, metalness: 0.01, icon: '🌲' },
            
            // 金属材质
            { name: '拉丝铝合金', color: 0xE8E8E8, roughness: 0.15, metalness: 0.95, icon: '⚪' },
            { name: '不锈钢', color: 0xC0C0C0, roughness: 0.1, metalness: 1.0, icon: '🔘' },
            { name: '黄铜', color: 0xDAA520, roughness: 0.25, metalness: 0.9, icon: '🟡' },
            { name: '古铜', color: 0xCD7F32, roughness: 0.4, metalness: 0.8, icon: '🟤' },
            
            // 石材
            { name: '卡拉拉白大理石', color: 0xF8F8FF, roughness: 0.1, metalness: 0.02, icon: '⬜' },
            { name: '黑金花大理石', color: 0x2F2F2F, roughness: 0.05, metalness: 0.1, icon: '⬛' },
            { name: '花岗岩', color: 0x696969, roughness: 0.6, metalness: 0.05, icon: '🔳' },
            
            // 混凝土和现代材质
            { name: '清水混凝土', color: 0xBBBBBB, roughness: 0.9, metalness: 0.02, icon: '⚫' },
            { name: '白色乳胶漆', color: 0xFAFAFA, roughness: 0.8, metalness: 0.01, icon: '⚪' },
            { name: '磨砂玻璃', color: 0xE6F3FF, roughness: 0.0, metalness: 0.0, transparent: true, opacity: 0.3, icon: '🔷' },
            
            // 纺织和合成材质
            { name: '亚麻布', color: 0xF5F5DC, roughness: 0.95, metalness: 0.0, icon: '🟫' },
            { name: '皮革', color: 0x8B4513, roughness: 0.8, metalness: 0.02, icon: '🟤' },
            { name: '高级塑料', color: 0xF0F0F0, roughness: 0.3, metalness: 0.1, icon: '⚪' },
            
            // 陶瓷和瓷砖
            { name: '白色陶瓷', color: 0xFFFFF0, roughness: 0.1, metalness: 0.02, icon: '⚪' },
            { name: '灰色瓷砖', color: 0xA9A9A9, roughness: 0.2, metalness: 0.05, icon: '⬜' }
        ];

        materialTypes.forEach((materialType, index) => {
            const materialItem = this.createMaterialPreview(materialType, index);
            materialsGrid.appendChild(materialItem);
        });

        // 添加自定义材质上传按钮
        const uploadButton = this.createMaterialUploadButton();
        materialsGrid.appendChild(uploadButton);

        // 加载已存在的自定义材质
        this.loadCustomMaterials();
    }

    createMaterialPreview(materialType, index) {
        const item = document.createElement('div');
        item.className = 'material-item';
        item.draggable = true;
        item.dataset.materialIndex = index;

        // 使用CSS颜色预览代替WebGL渲染，避免上下文泄漏
        const colorPreview = document.createElement('div');
        colorPreview.className = 'material-color-preview';
        colorPreview.style.width = '80px';
        colorPreview.style.height = '80px';
        colorPreview.style.borderRadius = '8px';
        colorPreview.style.border = '2px solid #ddd';
        colorPreview.style.margin = '0 auto 8px auto';
        colorPreview.style.position = 'relative';
        colorPreview.style.overflow = 'hidden';
        colorPreview.style.cursor = 'grab';
        
        // 根据材质类型设置背景
        const color = new THREE.Color(materialType.color);
        const rgbColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
        
        if (materialType.transparent) {
            // 透明材质使用渐变效果
            colorPreview.style.background = `linear-gradient(45deg, ${rgbColor}, rgba(255,255,255,0.3))`;
            colorPreview.style.opacity = materialType.opacity || 0.3;
        } else if (materialType.metalness > 0.5) {
            // 金属材质使用光泽效果
            colorPreview.style.background = `radial-gradient(circle at 30% 30%, ${rgbColor}, #000000)`;
            colorPreview.style.boxShadow = 'inset 0 0 20px rgba(255,255,255,0.3)';
        } else {
            // 普通材质使用纯色
            colorPreview.style.backgroundColor = rgbColor;
        }
        
        // 添加材质类型指示器
        if (materialType.icon) {
            const iconElement = document.createElement('div');
            iconElement.textContent = materialType.icon;
            iconElement.style.position = 'absolute';
            iconElement.style.top = '4px';
            iconElement.style.right = '4px';
            iconElement.style.fontSize = '16px';
            iconElement.style.textShadow = '0 0 3px rgba(0,0,0,0.5)';
            colorPreview.appendChild(iconElement);
        }

        const label = document.createElement('div');
        label.className = 'material-label';
        // 显示材质名称（不重复显示图标）
        label.textContent = materialType.name;

        item.appendChild(colorPreview);
        item.appendChild(label);

        // 存储材质信息
        item.materialData = materialType;

        // 添加拖拽事件
        this.addDragEvents(item, 'material');

        return item;
    }

    loadModels() {
        const modelsGrid = document.getElementById('models-grid');
        
        // 定义基础模型类型 - 包含更多Three.js基本几何体
        const modelTypes = [
            // 基本几何体
            { name: '立方体', type: 'box', icon: '📦' },
            { name: '球体', type: 'sphere', icon: '⚪' },
            { name: '圆柱体', type: 'cylinder', icon: '🔵' },
            { name: '圆锥体', type: 'cone', icon: '🔺' },
            { name: '环形体', type: 'torus', icon: '🍩' },
            { name: '平面', type: 'plane', icon: '⬜' },
            { name: '八面体', type: 'octahedron', icon: '💎' },
            { name: '十二面体', type: 'dodecahedron', icon: '🔷' },
            { name: '二十面体', type: 'icosahedron', icon: '🔶' },
            { name: '四面体', type: 'tetrahedron', icon: '▲' },
            { name: '圆环', type: 'ring', icon: '⭕' },
            { name: '胶囊', type: 'capsule', icon: '💊' },
            // 复合模型
            { name: '椅子', type: 'chair', icon: '🪑' },
            { name: '桌子', type: 'table', icon: '🪑' },
            { name: '灯具', type: 'lamp', icon: '💡' },
            { name: '植物', type: 'plant', icon: '🌱' }
        ];

        modelTypes.forEach((modelType, index) => {
            const modelItem = this.createModelPreview(modelType, index);
            modelsGrid.appendChild(modelItem);
        });
    }

    createModelPreview(modelType, index) {
        const item = document.createElement('div');
        item.className = 'model-item';
        item.draggable = true;
        item.dataset.modelIndex = index;

        const icon = document.createElement('div');
        icon.className = 'model-icon';
        icon.textContent = modelType.icon;

        const label = document.createElement('div');
        label.className = 'model-label';
        label.textContent = modelType.name;

        item.appendChild(icon);
        item.appendChild(label);

        // 存储模型信息
        item.modelData = modelType;

        // 添加拖拽事件
        this.addDragEvents(item, 'model');

        return item;
    }

    addDragEvents(item, type) {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({
                type: type,
                data: type === 'material' ? item.materialData : item.modelData
            }));
            
            // 添加拖拽时的视觉效果
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
        });
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // 更新选项卡按钮
        this.sidebar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // 更新面板
        this.sidebar.querySelectorAll('.panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-panel`);
        });
    }

    show() {
        this.isVisible = true;
        this.sidebar.classList.add('visible');
    }

    hide() {
        this.isVisible = false;
        this.sidebar.classList.remove('visible');
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    // 创建材质上传按钮
    createMaterialUploadButton() {
        const uploadBtn = document.createElement('div');
        uploadBtn.className = 'material-upload-btn';
        uploadBtn.innerHTML = `
            <div class="upload-icon">+</div>
            <div class="upload-text">添加自定义材质</div>
        `;

        uploadBtn.addEventListener('click', () => {
            this.showMaterialUploadModal();
        });

        return uploadBtn;
    }

    // 显示材质上传模态框
    showMaterialUploadModal() {
        const modal = document.getElementById('material-upload-modal');
        if (modal) {
            modal.style.display = 'flex';
            this.initModalEvents();
        }
    }

    // 初始化模态框事件
    initModalEvents() {
        // 关闭按钮事件
        const closeBtn = document.getElementById('close-material-modal');
        const cancelBtn = document.getElementById('cancel-material-upload');
        
        if (closeBtn) {
            closeBtn.onclick = () => this.hideMaterialUploadModal();
        }
        if (cancelBtn) {
            cancelBtn.onclick = () => this.hideMaterialUploadModal();
        }

        // 文件上传区域事件
        this.initFileUploadEvents();

        // 表单提交事件
        const form = document.getElementById('material-upload-form');
        if (form) {
            form.onsubmit = (e) => this.handleMaterialUpload(e);
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('material-upload-modal');
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    this.hideMaterialUploadModal();
                }
            };
        }
    }

    // 初始化文件上传事件
    initFileUploadEvents() {
        const textureTypes = ['colorMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];
        
        textureTypes.forEach(textureType => {
            const uploadArea = document.querySelector(`[data-texture-type="${textureType}"]`);
            const fileInput = document.getElementById(`${textureType}-input`);
            
            if (uploadArea && fileInput) {
                // 点击上传区域
                uploadArea.addEventListener('click', () => {
                    fileInput.click();
                });

                // 文件选择事件
                fileInput.addEventListener('change', (e) => {
                    this.handleFileSelect(e, textureType);
                });

                // 拖拽事件
                uploadArea.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    uploadArea.classList.add('drag-over');
                });

                uploadArea.addEventListener('dragleave', () => {
                    uploadArea.classList.remove('drag-over');
                });

                uploadArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    uploadArea.classList.remove('drag-over');
                    
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                        this.processFile(files[0], textureType);
                    }
                });
            }
        });
    }

    // 处理文件选择
    handleFileSelect(event, textureType) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file, textureType);
        }
    }

    // 处理文件
    processFile(file, textureType) {
        if (!file.type.startsWith('image/')) {
            alert('请选择图片文件！');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.updateFileInfo(textureType, file.name, e.target.result);
            this.updateTexturePreview(textureType, e.target.result);
        };
        reader.readAsDataURL(file);
    }

    // 更新文件信息显示
    updateFileInfo(textureType, fileName, dataUrl) {
        const infoElement = document.getElementById(`${textureType}-info`);
        if (infoElement) {
            infoElement.textContent = `已选择: ${fileName}`;
        }

        // 存储文件数据
        if (!this.currentMaterialTextures) {
            this.currentMaterialTextures = {};
        }
        this.currentMaterialTextures[textureType] = {
            name: fileName,
            dataUrl: dataUrl
        };
    }

    // 更新贴图预览
    updateTexturePreview(textureType, dataUrl) {
        const previewContainer = document.getElementById('texture-preview');
        if (!previewContainer) return;

        // 移除已存在的同类型预览
        const existingPreview = previewContainer.querySelector(`[data-texture-type="${textureType}"]`);
        if (existingPreview) {
            existingPreview.remove();
        }

        // 创建新的预览项
        const previewItem = document.createElement('div');
        previewItem.className = 'texture-preview-item';
        previewItem.setAttribute('data-texture-type', textureType);
        previewItem.innerHTML = `
            <img src="${dataUrl}" class="texture-preview-img" alt="${textureType}">
            <div class="texture-label">${this.getTextureDisplayName(textureType)}</div>
        `;

        previewContainer.appendChild(previewItem);
    }

    // 获取贴图显示名称
    getTextureDisplayName(textureType) {
        const displayNames = {
            'colorMap': '漫反射',
            'normalMap': '法线',
            'roughnessMap': '粗糙度',
            'metalnessMap': '金属度',
            'aoMap': '环境遮蔽'
        };
        return displayNames[textureType] || textureType;
    }

    // 处理材质上传
    async handleMaterialUpload(event) {
        event.preventDefault();
        
        const nameInput = document.getElementById('material-name');
        const iconInput = document.getElementById('material-icon');
        
        if (!nameInput.value.trim()) {
            alert('请输入材质名称！');
            return;
        }

        if (!this.currentMaterialTextures || !this.currentMaterialTextures.colorMap) {
            alert('请至少上传一个漫反射贴图！');
            return;
        }

        const createBtn = document.getElementById('create-material-btn');
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = '创建中...';
        }

        try {
            // 创建自定义材质
            const materialData = await this.createCustomMaterial({
                name: nameInput.value.trim(),
                icon: iconInput.value.trim() || '🎨',
                textures: this.currentMaterialTextures
            });

            // 添加到自定义材质列表
            this.customMaterials.push(materialData);

            // 添加到材质网格
            this.addCustomMaterialToGrid(materialData);

            // 保存到本地存储
            this.saveCustomMaterials();

            // 关闭模态框
            this.hideMaterialUploadModal();

            console.log('自定义材质创建成功:', materialData);
        } catch (error) {
            console.error('创建材质失败:', error);
            alert('创建材质失败，请重试！');
        } finally {
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = '创建材质';
            }
        }
    }

    // 创建自定义PBR材质
    async createCustomMaterial(materialInfo) {
        const { name, icon, textures } = materialInfo;
        const materialData = {
            name,
            icon,
            isCustom: true,
            createdAt: Date.now(),
            textures: {}
        };

        // 加载所有贴图
        const texturePromises = Object.entries(textures).map(async ([textureType, textureInfo]) => {
            try {
                const texture = await this.loadTextureFromDataUrl(textureInfo.dataUrl);
                materialData.textures[textureType] = texture;
                return { textureType, texture };
            } catch (error) {
                console.warn(`加载${textureType}贴图失败:`, error);
                return null;
            }
        });

        const loadedTextures = await Promise.all(texturePromises);
        
        // 创建Three.js材质
        const materialOptions = {
            name: name
        };

        // 设置各种贴图
        loadedTextures.forEach(result => {
            if (result && result.texture) {
                const { textureType, texture } = result;
                
                // 设置贴图参数
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.generateMipmaps = true;
                
                // 根据贴图类型设置到材质选项
                switch (textureType) {
                    case 'colorMap':
                        materialOptions.map = texture;
                        break;
                    case 'normalMap':
                        materialOptions.normalMap = texture;
                        break;
                    case 'roughnessMap':
                        materialOptions.roughnessMap = texture;
                        break;
                    case 'metalnessMap':
                        materialOptions.metalnessMap = texture;
                        break;
                    case 'aoMap':
                        materialOptions.aoMap = texture;
                        break;
                }
            }
        });

        // 设置默认材质属性
        materialOptions.roughness = materialOptions.roughnessMap ? 1.0 : 0.5;
        materialOptions.metalness = materialOptions.metalnessMap ? 1.0 : 0.0;

        // 创建Three.js材质实例
        materialData.threeMaterial = new THREE.MeshStandardMaterial(materialOptions);

        return materialData;
    }

    // 从DataURL加载贴图
    loadTextureFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                const texture = new THREE.CanvasTexture(canvas);
                texture.needsUpdate = true;
                resolve(texture);
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = dataUrl;
        });
    }

    // 添加自定义材质到网格
    addCustomMaterialToGrid(materialData) {
        const materialsGrid = document.getElementById('materials-grid');
        if (!materialsGrid) return;

        const materialItem = this.createCustomMaterialPreview(materialData);
        
        // 插入到上传按钮之前
        const uploadButton = materialsGrid.querySelector('.material-upload-btn');
        if (uploadButton) {
            materialsGrid.insertBefore(materialItem, uploadButton);
        } else {
            materialsGrid.appendChild(materialItem);
        }
    }

    // 创建自定义材质预览
    createCustomMaterialPreview(materialData) {
        const item = document.createElement('div');
        item.className = 'material-item custom-material';
        item.draggable = true;

        // 创建预览场景
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 80;
        
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(80, 80);
        
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        camera.position.set(2, 2, 2);
        camera.lookAt(0, 0, 0);

        // 创建材质球
        const geometry = new THREE.SphereGeometry(0.8, 32, 32);
        const sphere = new THREE.Mesh(geometry, materialData.threeMaterial);
        scene.add(sphere);

        // 添加光照
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        // 渲染
        renderer.render(scene, camera);

        const label = document.createElement('div');
        label.className = 'material-label';
        label.innerHTML = `${materialData.icon} ${materialData.name}`;

        item.appendChild(canvas);
        item.appendChild(label);

        // 存储材质信息
        item.materialData = {
            name: materialData.name,
            isCustom: true,
            threeMaterial: materialData.threeMaterial,
            icon: materialData.icon
        };

        // 添加拖拽事件
        this.addDragEvents(item, 'material');

        return item;
    }

    // 隐藏材质上传模态框
    hideMaterialUploadModal() {
        const modal = document.getElementById('material-upload-modal');
        if (modal) {
            modal.style.display = 'none';
        }

        // 重置表单
        this.resetMaterialUploadForm();
    }

    // 重置材质上传表单
    resetMaterialUploadForm() {
        const form = document.getElementById('material-upload-form');
        if (form) {
            form.reset();
        }

        // 清空文件信息
        const textureTypes = ['colorMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];
        textureTypes.forEach(textureType => {
            const infoElement = document.getElementById(`${textureType}-info`);
            if (infoElement) {
                infoElement.textContent = '';
            }
        });

        // 清空预览
        const previewContainer = document.getElementById('texture-preview');
        if (previewContainer) {
            previewContainer.innerHTML = '';
        }

        // 清空临时数据
        this.currentMaterialTextures = {};
    }

    // 加载自定义材质
    loadCustomMaterials() {
        try {
            const saved = localStorage.getItem('customMaterials');
            if (saved) {
                const savedMaterials = JSON.parse(saved);
                savedMaterials.forEach(async (materialInfo) => {
                    try {
                        const materialData = await this.createCustomMaterial(materialInfo);
                        this.customMaterials.push(materialData);
                        this.addCustomMaterialToGrid(materialData);
                    } catch (error) {
                        console.warn('加载自定义材质失败:', error);
                    }
                });
            }
        } catch (error) {
            console.warn('加载自定义材质失败:', error);
        }
    }

    // 保存自定义材质
    saveCustomMaterials() {
        try {
            const materialsToSave = this.customMaterials.map(material => ({
                name: material.name,
                icon: material.icon,
                textures: Object.entries(material.textures).reduce((acc, [key, texture]) => {
                    // 只保存DataURL，不保存Three.js对象
                    if (texture && texture.image && texture.image.toDataURL) {
                        acc[key] = {
                            name: `${key}.png`,
                            dataUrl: texture.image.toDataURL()
                        };
                    }
                    return acc;
                }, {}),
                createdAt: material.createdAt
            }));
            
            localStorage.setItem('customMaterials', JSON.stringify(materialsToSave));
        } catch (error) {
            console.warn('保存自定义材质失败:', error);
        }
    }

    destroy() {
        if (this.sidebar) {
            this.sidebar.remove();
        }
    }
}