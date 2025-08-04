import * as THREE from 'three';

export class MaterialSidebar {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.isVisible = false;
        this.isCollapsed = false;
        this.currentTab = 'materials';
        this.materialPreviews = [];
        this.modelPreviews = [];
        
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
        
        // 定义基础材质类型
        const materialTypes = [
            { name: '木材', color: 0x8B4513, roughness: 0.8, metalness: 0.0 },
            { name: '金属', color: 0xC0C0C0, roughness: 0.1, metalness: 1.0 },
            { name: '塑料', color: 0xFF6B6B, roughness: 0.7, metalness: 0.0 },
            { name: '玻璃', color: 0x87CEEB, roughness: 0.0, metalness: 0.0, transparent: true, opacity: 0.3 },
            { name: '石材', color: 0x708090, roughness: 0.9, metalness: 0.0 },
            { name: '混凝土', color: 0x696969, roughness: 0.8, metalness: 0.0 },
            { name: '陶瓷', color: 0xF5F5DC, roughness: 0.2, metalness: 0.0 },
            { name: '橡胶', color: 0x2F2F2F, roughness: 1.0, metalness: 0.0 }
        ];

        materialTypes.forEach((materialType, index) => {
            const materialItem = this.createMaterialPreview(materialType, index);
            materialsGrid.appendChild(materialItem);
        });
    }

    createMaterialPreview(materialType, index) {
        const item = document.createElement('div');
        item.className = 'material-item';
        item.draggable = true;
        item.dataset.materialIndex = index;

        // 创建小的Three.js预览场景
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
        const material = new THREE.MeshStandardMaterial({
            color: materialType.color,
            roughness: materialType.roughness,
            metalness: materialType.metalness,
            transparent: materialType.transparent || false,
            opacity: materialType.opacity || 1.0
        });
        
        const sphere = new THREE.Mesh(geometry, material);
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
        label.textContent = materialType.name;

        item.appendChild(canvas);
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

    destroy() {
        if (this.sidebar) {
            this.sidebar.remove();
        }
    }
}