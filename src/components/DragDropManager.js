import * as THREE from 'three';

export class DragDropManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.isDragging = false;
        this.dragPreview = null;
        this.dragData = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.init();
    }

    init() {
        this.setupDropZone();
        this.createDragPreview();
        
        // 添加测试按钮，用于验证模型创建功能
        if (window.location.hash === '#debug') {
            this.addDebugControls();
        }
    }

    addDebugControls() {
        const debugButton = document.createElement('button');
        debugButton.textContent = '测试创建立方体';
        debugButton.style.position = 'fixed';
        debugButton.style.bottom = '20px';
        debugButton.style.right = '20px';
        debugButton.style.zIndex = '3000';
        debugButton.onclick = () => {
            const testPosition = new THREE.Vector3(0, 1, 0);
            const testModel = { name: '测试立方体', type: 'box' };
            this.createModel(testModel, testPosition);
        };
        document.body.appendChild(debugButton);
    }

    setupDropZone() {
        const canvas = this.sceneManager.renderer.domElement;
        
        // 阻止默认拖拽行为
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 阻止事件冒泡
            e.dataTransfer.dropEffect = 'copy';
            this.updateDragPreview(e);
        });

        canvas.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 阻止事件冒泡
            this.showDragPreview();
        });

        canvas.addEventListener('dragleave', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            // 只有当鼠标真正离开canvas时才隐藏预览
            if (!canvas.contains(e.relatedTarget)) {
                this.hideDragPreview();
            }
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 阻止事件冒泡
            this.handleDrop(e);
            this.hideDragPreview();
        });

        // 监听全局拖拽事件
        document.addEventListener('dragstart', (e) => {
            const data = e.dataTransfer.getData('text/plain');
            if (data) {
                try {
                    this.dragData = JSON.parse(data);
                    this.isDragging = true;
                } catch (error) {
                    console.warn('无法解析拖拽数据:', error);
                }
            }
        });

        document.addEventListener('dragend', () => {
            this.isDragging = false;
            this.dragData = null;
            this.hideDragPreview();
        });
    }

    createDragPreview() {
        this.dragPreview = document.createElement('div');
        this.dragPreview.className = 'drag-preview';
        this.dragPreview.style.display = 'none';
        document.body.appendChild(this.dragPreview);
    }

    updateDragPreview(event) {
        if (!this.isDragging || !this.dragData) return;

        this.dragPreview.style.left = (event.clientX + 10) + 'px';
        this.dragPreview.style.top = (event.clientY - 30) + 'px';
        
        if (this.dragData.type === 'material') {
            this.dragPreview.textContent = `🎨 ${this.dragData.data.name}`;
        } else if (this.dragData.type === 'model') {
            this.dragPreview.textContent = `${this.dragData.data.icon} ${this.dragData.data.name}`;
        }
    }

    showDragPreview() {
        if (this.isDragging && this.dragData) {
            this.dragPreview.style.display = 'block';
        }
    }

    hideDragPreview() {
        this.dragPreview.style.display = 'none';
    }

    handleDrop(event) {
        if (!this.dragData) return;

        // 计算鼠标在3D场景中的位置
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);

        if (this.dragData.type === 'material') {
            this.handleMaterialDrop();
        } else if (this.dragData.type === 'model') {
            this.handleModelDrop();
        }
    }

    handleMaterialDrop() {
        // 检测与场景中所有可材质化的对象的碰撞
        const intersectableObjects = [];
        
        this.sceneManager.scene.traverse((child) => {
            if (child.isMesh && child.material && child.visible) {
                // 排除一些不应该被材质化的对象
                if (!child.userData.isHelper && !child.userData.isGizmo) {
                    intersectableObjects.push(child);
                }
            }
        });

        const intersects = this.raycaster.intersectObjects(intersectableObjects);
        
        if (intersects.length > 0) {
            const targetMesh = intersects[0].object;
            this.applyMaterialToMesh(targetMesh, this.dragData.data);
        } else {
            console.log('没有找到可应用材质的对象');
        }
    }

    applyMaterialToMesh(mesh, materialData) {
        // 保存原有材质的一些重要属性
        const originalMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const preserveProperties = {};
        
        if (originalMaterial) {
            // 保存一些可能影响交互的属性
            preserveProperties.side = originalMaterial.side;
            preserveProperties.alphaTest = originalMaterial.alphaTest;
            preserveProperties.depthTest = originalMaterial.depthTest;
            preserveProperties.depthWrite = originalMaterial.depthWrite;
            preserveProperties.blending = originalMaterial.blending;
            preserveProperties.polygonOffset = originalMaterial.polygonOffset;
            preserveProperties.polygonOffsetFactor = originalMaterial.polygonOffsetFactor;
        }

        // 创建新材质，保留原有的重要属性
        const newMaterial = new THREE.MeshStandardMaterial({
            color: materialData.color,
            roughness: materialData.roughness,
            metalness: materialData.metalness,
            transparent: materialData.transparent || false,
            opacity: materialData.opacity || 1.0,
            ...preserveProperties // 合并保存的属性
        });

        // 如果是数组材质（多材质），更新所有材质
        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map(() => {
                const clonedMaterial = newMaterial.clone();
                clonedMaterial.needsUpdate = true;
                return clonedMaterial;
            });
        } else {
            mesh.material = newMaterial;
            mesh.material.needsUpdate = true;
        }

        // 强制几何体更新
        if (mesh.geometry) {
            mesh.geometry.computeBoundingBox();
            mesh.geometry.computeBoundingSphere();
        }
        
        // 存储材质信息到userData，但保留原有的其他userData
        if (!mesh.userData.appliedMaterial) {
            mesh.userData.appliedMaterial = {};
        }
        mesh.userData.appliedMaterial = {
            name: materialData.name,
            ...materialData
        };

        console.log(`已将 ${materialData.name} 材质应用到对象`, mesh);
        console.log('应用材质后的对象信息:', {
            type: mesh.userData.type,
            hasGeometry: !!mesh.geometry,
            hasMaterial: !!mesh.material,
            visible: mesh.visible,
            matrixAutoUpdate: mesh.matrixAutoUpdate,
            userData: mesh.userData
        });
        
        // 触发材质应用事件
        if (this.onMaterialApplied) {
            this.onMaterialApplied(mesh, materialData);
        }
    }

    handleModelDrop() {
        console.log('处理模型拖拽放置，数据:', this.dragData.data);
        
        // 先尝试与现有场景对象相交
        const allObjects = [];
        this.sceneManager.scene.traverse((child) => {
            if (child.isMesh && child.visible && !child.userData.isHelper) {
                allObjects.push(child);
            }
        });
        
        // 包含地面平面
        const groundPlane = this.getGroundPlane();
        allObjects.push(groundPlane);
        
        const intersects = this.raycaster.intersectObjects(allObjects);
        let position = new THREE.Vector3(0, 0, 0);
        
        if (intersects.length > 0) {
            position = intersects[0].point.clone();
            console.log('射线检测到交点:', position);
        } else {
            // 如果没有交点，在摄像机前方放置
            const direction = new THREE.Vector3();
            this.sceneManager.camera.getWorldDirection(direction);
            position.copy(this.sceneManager.camera.position).add(direction.multiplyScalar(8));
            position.z = Math.max(0, position.z); // 确保不在地面以下（Z轴是高度）
            console.log('使用摄像机前方位置:', position);
        }

        // 稍微抬高一点，避免Z-fighting（Z轴是高度）
        position.z += 0.01;
        
        const createdModel = this.createModel(this.dragData.data, position);
        
        if (createdModel) {
            console.log('模型创建成功，已添加到场景');
        } else {
            console.error('模型创建失败');
        }
    }

    getGroundPlane() {
        // 创建一个虚拟的地面平面用于计算放置位置
        if (!this.groundPlane) {
            const geometry = new THREE.PlaneGeometry(1000, 1000);
            const material = new THREE.MeshBasicMaterial({ 
                visible: false,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide
            });
            this.groundPlane = new THREE.Mesh(geometry, material);
            // 地面是XOY平面，Z=0为地面高度，不需要旋转
            this.groundPlane.position.z = 0; // 地面Z=0
            this.groundPlane.userData = {
                isHelper: true,
                isGroundPlane: true
            };
            this.sceneManager.scene.add(this.groundPlane);
            console.log('已创建地面平面用于模型放置');
        }
        return this.groundPlane;
    }

    createModel(modelData, position) {
        let geometry, material, mesh;
        
        console.log(`开始创建模型: ${modelData.name}, 类型: ${modelData.type}, 位置:`, position);

        // 根据模型类型创建几何体 - 按建筑尺度调整（墙高2800）
        switch (modelData.type) {
            // 基本几何体 - 使用建筑级尺寸
            case 'box':
                geometry = new THREE.BoxGeometry(500, 500, 500); // 0.5m x 0.5m x 0.5m 的箱子
                break;
            case 'sphere':
                geometry = new THREE.SphereGeometry(250, 32, 32); // 直径0.5m的球体
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(200, 200, 800, 32); // 直径0.4m，高0.8m的圆柱
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(200, 600, 32); // 底面直径0.4m，高0.6m的圆锥
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(300, 100, 16, 100); // 大半径0.3m，小半径0.1m的环形
                break;
            case 'plane':
                geometry = new THREE.PlaneGeometry(1000, 1000); // 1m x 1m 的平面
                break;
            case 'octahedron':
                geometry = new THREE.OctahedronGeometry(200); // 八面体，半径0.2m
                break;
            case 'dodecahedron':
                geometry = new THREE.DodecahedronGeometry(200); // 十二面体，半径0.2m
                break;
            case 'icosahedron':
                geometry = new THREE.IcosahedronGeometry(200); // 二十面体，半径0.2m
                break;
            case 'tetrahedron':
                geometry = new THREE.TetrahedronGeometry(200); // 四面体，半径0.2m
                break;
            case 'ring':
                geometry = new THREE.RingGeometry(150, 350, 32); // 内径0.3m，外径0.7m的圆环
                break;
            case 'capsule':
                // CapsuleGeometry可能在某些版本中不可用，使用替代方案
                try {
                    geometry = new THREE.CapsuleGeometry(150, 400, 4, 8); // 半径0.15m，高0.4m的胶囊
                } catch (error) {
                    console.warn('CapsuleGeometry不可用，使用圆柱体替代');
                    geometry = new THREE.CylinderGeometry(150, 150, 400, 8); // 替代圆柱体
                }
                break;
            // 复合模型
            case 'chair':
                mesh = this.createChairModel();
                break;
            case 'table':
                mesh = this.createTableModel();
                break;
            case 'lamp':
                mesh = this.createLampModel();
                break;
            case 'plant':
                mesh = this.createPlantModel();
                break;
            default:
                console.warn(`未知模型类型: ${modelData.type}, 使用默认立方体`);
                geometry = new THREE.BoxGeometry(1, 1, 1);
        }

        // 如果不是复合模型，创建基本mesh
        if (!mesh && geometry) {
            // 根据几何体类型选择合适的材质
            const materialColor = this.getMaterialColorForType(modelData.type);
            material = new THREE.MeshStandardMaterial({
                color: materialColor,
                roughness: 0.3,
                metalness: modelData.type === 'ring' ? 0.8 : 0.2,
                transparent: modelData.type === 'plane',
                opacity: modelData.type === 'plane' ? 0.8 : 1.0,
                side: modelData.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
                emissive: new THREE.Color(materialColor).multiplyScalar(0.1) // 添加一点发光
            });
            mesh = new THREE.Mesh(geometry, material);
            
            // 特殊处理某些几何体的旋转
            if (modelData.type === 'plane') {
                mesh.rotation.x = -Math.PI / 2; // 平面水平放置
            } else if (modelData.type === 'ring') {
                mesh.rotation.x = -Math.PI / 2; // 圆环水平放置
            }
        }

        if (!mesh) {
            console.error('无法创建模型:', modelData);
            return null;
        }

        // 计算几何体的包围盒以正确放置在地面上
        if (geometry) {
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            const height = Math.abs(box.max.z - box.min.z); // Z轴是高度轴
            
            // 设置位置，确保底部在地面上（Z=0）
            mesh.position.copy(position);
            
            // 对于大多数几何体，将Z位置调整为几何体高度的一半，使底部接触地面
            if (modelData.type !== 'plane' && modelData.type !== 'ring') {
                mesh.position.z = height / 2; // 直接设置为高度的一半
            } else if (modelData.type === 'plane') {
                mesh.position.z = 1; // 平面稍微抬高一点避免Z-fighting
            } else if (modelData.type === 'ring') {
                mesh.position.z = 1; // 圆环也稍微抬高
            }
            
            console.log(`模型 ${modelData.name} 几何体信息:`, {
                boundingBox: box,
                height: height,
                finalZ: mesh.position.z,
                type: modelData.type
            });
        } else {
            // 对于复合模型（Group），已经在创建时正确设置了内部组件的Z位置
            mesh.position.copy(position);
            mesh.position.z = 0; // 复合模型放在地面上
            console.log(`复合模型 ${modelData.name} 位置设置为:`, mesh.position);
        }

        mesh.userData = {
            type: 'placedModel',
            modelType: modelData.type,
            name: modelData.name,
            draggable: true,
            createdAt: Date.now()
        };

        // 添加到场景
        this.sceneManager.scene.add(mesh);

        console.log(`已成功创建 ${modelData.name} 模型:`, {
            position: mesh.position,
            geometry: geometry?.type || 'Group',
            material: material?.type || 'Multiple',
            userData: mesh.userData
        });
        
        // 触发模型创建事件
        if (this.onModelCreated) {
            this.onModelCreated(mesh, modelData);
        }

        return mesh;
    }

    // 根据几何体类型获取合适的材质颜色
    getMaterialColorForType(type) {
        const colorMap = {
            'box': 0x8B4513,        // 棕色
            'sphere': 0xFF6B6B,     // 红色
            'cylinder': 0x4ECDC4,   // 青色
            'cone': 0xFFE66D,       // 黄色
            'torus': 0xFF8B94,      // 粉红色
            'plane': 0xC7CEEA,      // 淡紫色
            'octahedron': 0x95E1D3, // 薄荷绿
            'dodecahedron': 0xF38BA8, // 玫瑰色
            'icosahedron': 0xA8E6CF, // 淡绿色
            'tetrahedron': 0xFFD93D, // 金黄色
            'ring': 0xC0C0C0,       // 银色
            'capsule': 0x87CEEB     // 天空蓝
        };
        return colorMap[type] || 0x8B4513;
    }

    createChairModel() {
        const group = new THREE.Group();
        
        // 椅座 - 标准椅子尺寸 45cm x 45cm x 5cm，Z轴高度45cm
        const seatGeometry = new THREE.BoxGeometry(450, 450, 50);
        const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const seat = new THREE.Mesh(seatGeometry, seatMaterial);
        seat.position.z = 450; // 椅座距地面45cm（Z轴）
        group.add(seat);
        
        // 椅背 - 45cm宽，80cm高，5cm厚，在椅座后方
        const backGeometry = new THREE.BoxGeometry(450, 50, 800);
        const back = new THREE.Mesh(backGeometry, seatMaterial);
        back.position.set(0, -200, 850); // X=0, Y=-200(向后20cm), Z=850(高度)
        group.add(back);
        
        // 椅腿 - 5cm x 5cm x 45cm高
        const legGeometry = new THREE.BoxGeometry(50, 50, 450);
        const legPositions = [
            [-175, -175, 225], [175, -175, 225], // 后腿
            [-175, 175, 225], [175, 175, 225]   // 前腿
        ];
        
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, seatMaterial);
            leg.position.set(...pos); // (X, Y, Z) - Z为高度中心
            group.add(leg);
        });
        
        // 椅子已经以地面(Z=0)为基准构建，椅腿底部在Z=0
        
        return group;
    }

    createTableModel() {
        const group = new THREE.Group();
        
        // 桌面 - 120cm x 80cm x 5cm，高度75cm（Z轴是高度轴）
        const topGeometry = new THREE.BoxGeometry(1200, 800, 50);
        const topMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const top = new THREE.Mesh(topGeometry, topMaterial);
        top.position.z = 750; // 桌面距地面75cm（Z轴）
        group.add(top);
        
        // 桌腿 - 5cm x 5cm x 75cm高
        const legGeometry = new THREE.BoxGeometry(50, 50, 750);
        const legPositions = [
            [-550, -350, 375], [550, -350, 375], // 后腿：Z=375为高度中心（75cm的一半）
            [-550, 350, 375], [550, 350, 375]   // 前腿
        ];
        
        legPositions.forEach(pos => {
            const leg = new THREE.Mesh(legGeometry, topMaterial);
            leg.position.set(...pos); // (X, Y, Z) - Z为高度
            group.add(leg);
        });
        
        // 桌子已经以地面(Z=0)为基准构建，桌腿底部在Z=0
        
        return group;
    }

    createLampModel() {
        const group = new THREE.Group();
        
        // 灯座 - 直径30cm，厚度8cm（Z轴是高度轴）
        const baseGeometry = new THREE.CylinderGeometry(150, 150, 80, 16);
        const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.rotation.x = Math.PI / 2; // 旋转圆柱体使其Z轴为高度
        base.position.z = 40; // 灯座中心距地面4cm（厚度的一半，Z轴）
        group.add(base);
        
        // 灯杆 - 直径2cm，高度150cm
        const poleGeometry = new THREE.CylinderGeometry(10, 10, 1500, 8);
        const pole = new THREE.Mesh(poleGeometry, baseMaterial);
        pole.rotation.x = Math.PI / 2; // 旋转圆柱体使其Z轴为高度
        pole.position.z = 830; // 灯座顶部(80) + 灯杆高度的一半(750) = 830
        group.add(pole);
        
        // 灯罩 - 底面直径30cm，高度25cm
        const shadeGeometry = new THREE.ConeGeometry(150, 250, 16, 1, true);
        const shadeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFFFE0,
            transparent: true,
            opacity: 0.8
        });
        const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
        shade.rotation.x = Math.PI / 2; // 旋转圆锥体使其Z轴为高度
        shade.position.z = 1705; // 灯杆顶部(1580) + 灯罩高度的一半(125) = 1705
        group.add(shade);
        
        // 灯具已经以地面(Z=0)为基准构建，灯座底部在Z=0
        
        return group;
    }

    createPlantModel() {
        const group = new THREE.Group();
        
        // 花盆 - 上径30cm，下径20cm，高40cm（Z轴是高度轴）
        const potGeometry = new THREE.CylinderGeometry(150, 100, 400, 16);
        const potMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const pot = new THREE.Mesh(potGeometry, potMaterial);
        pot.rotation.x = Math.PI / 2; // 旋转圆柱体使其Z轴为高度
        pot.position.z = 200; // 花盆中心距地面20cm（高度的一半，Z轴）
        group.add(pot);
        
        // 植物茎 - 直径2cm，高80cm
        const stemGeometry = new THREE.CylinderGeometry(10, 10, 800, 8);
        const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const stem = new THREE.Mesh(stemGeometry, stemMaterial);
        stem.rotation.x = Math.PI / 2; // 旋转圆柱体使其Z轴为高度
        stem.position.z = 800; // 花盆顶部(400) + 茎高度的一半(400) = 800
        group.add(stem);
        
        // 叶子 - 直径60cm的椭球体
        const leafGeometry = new THREE.SphereGeometry(300, 8, 8);
        const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x32CD32 });
        const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
        leaf.position.z = 1200; // 茎顶部位置（Z轴）
        leaf.scale.z = 0.5; // 在Z轴方向压扁成椭球形
        group.add(leaf);
        
        // 植物已经以地面(Z=0)为基准构建，花盆底部在Z=0
        
        return group;
    }

    destroy() {
        if (this.dragPreview) {
            this.dragPreview.remove();
        }
        
        if (this.groundPlane) {
            this.sceneManager.scene.remove(this.groundPlane);
        }
    }
}