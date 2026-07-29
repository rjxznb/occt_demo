import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { RoomRenderer } from './components/RoomRenderer.js';
import { geometryService } from './core/GeometryService.js';
import { BundledDataSource } from './core/DataSource.js';
import { FirstPersonControls } from './vr/FirstPersonControls.js';

/**
 * VR 看房（第一人称漫游）应用。
 *
 * 复用 SceneManager（场景/光照/IBL/阴影/渲染器）与 RoomRenderer（墙、地板、
 * 门窗挖洞、软装占位盒）搭好户型，再补上：
 * - 吊顶：克隆每间房的地板抬到层高，把室内封顶；
 * - 室内灯：每间房吊顶下一盏暖光，补上被吊顶挡住的天光；
 * - 第一人称相机 + WASD/鼠标漫游，锁在视点高度、限制在户型轮廓内；
 * - 房间快速切换：点列表瞬移到对应房间中心。
 *
 * 用作 CAD 插件渲染预览「页面三」。暂用内置示例数据。
 */

const CEILING_Z = 2800;   // 层高 = 墙体挤出高度 (mm)，吊顶盖在墙顶

class VRHouseApp {
    constructor() {
        this.sceneManager = null;
        this.roomRenderer = null;
        this.controls = null;
        this.clock = new THREE.Clock();
        this.rooms = [];          // [{name, center:{x,y}}]
        this.outlineRing = null;  // 外轮廓点（限制漫游范围）
        this.paused = false;
        this.rafId = null;

        this.ui = {
            info: document.getElementById('info'),
            overlay: document.getElementById('vr-enter'),
            roomList: document.getElementById('vr-room-list'),
            hint: document.getElementById('vr-hint'),
        };

        this.init();
    }

    async init() {
        try {
            const container = document.getElementById('canvas-3d');
            this.sceneManager = new SceneManager(container);

            // 弃用轨道控制与自动旋转——本页是第一人称
            this.sceneManager.controls?.dispose();
            this.sceneManager.autoRotationManager?.destroy?.();

            this.roomRenderer = new RoomRenderer(this.sceneManager);
            this.roomRenderer.setProgressCallback((c, t) =>
                this._status(`正在挖洞门窗: ${c}/${t}`));

            this._status('正在加载数据...');
            const data = await this._loadData();

            this._status('正在构建户型...');
            // 桩 wallSelector：VR 不需要墙面拾取，吞掉 RoomRenderer 的登记调用即可
            const result = await this.roomRenderer.render(data, { addWall() {}, addWalls() {} });

            this._buildCeilings(result.floorMeshes || []);
            this._addInteriorLights(data.rooms?.roomInfo || []);
            this._tuneLightingForInterior();
            this._hideOrbitOnlyObjects();

            // 漫游范围：外轮廓外环
            this.outlineRing = this._normalizeRing(data.outline?.outlinePoints || []);

            this._setupControls();
            this._buildRoomList(data.rooms?.roomInfo || []);

            // 落到第一间房
            if (this.rooms.length) this._enterRoom(0, false);

            this._startLoop();
            this._setupHostLifecycle();
            this._status('就绪');
        } catch (err) {
            console.error('VR 初始化失败:', err);
            this._status('初始化失败: ' + err.message);
        }
    }

    async _loadData() {
        await geometryService.init();
        const [outline, rooms, doorWindows, softlists, contentModels] = await Promise.all([
            geometryService.getOutline(),
            geometryService.getRooms(),
            geometryService.getDoorsAndWindows(),
            geometryService.getSoftlists(),
            geometryService.getContentModels(),
        ]);
        return { outline, rooms, doorWindows, softlists, contentModels };
    }

    /** 克隆每间房地板抬到层高，作为吊顶封顶 */
    _buildCeilings(floorMeshes) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0xF0ECE4, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
        });
        for (const floor of floorMeshes) {
            const ceiling = new THREE.Mesh(floor.geometry, mat);
            ceiling.position.set(floor.position.x, floor.position.y, CEILING_Z);
            ceiling.userData.type = 'ceiling';
            ceiling.castShadow = false;
            ceiling.receiveShadow = true;
            this.sceneManager.scene.add(ceiling);
        }
    }

    /** 每间房吊顶下一盏暖色点光，补被吊顶挡掉的天光 */
    _addInteriorLights(roomInfo) {
        for (const info of roomInfo) {
            if (!info?.center) continue;
            // 物理衰减(decay=2)：光随距离²衰减，各房间的灯只照亮自己，避免跨房叠加过曝。
            // mm 尺度下要达到可见亮度，强度量级需较大（≈层高² × 目标照度）。
            const light = new THREE.PointLight(0xFFE6C0, 9.0e6, 0, 2);
            light.position.set(info.center.x, info.center.y, CEILING_Z - 250);
            light.castShadow = false;
            this.sceneManager.scene.add(light);
        }
    }

    /** 室内观感调校：吊顶挡住天光，压曝光与冷色天光、弱化环境，改由暖点光主导 */
    _tuneLightingForInterior() {
        this.sceneManager.renderer.toneMappingExposure = 0.92;
        this.sceneManager.scene.environmentIntensity = 0.55;
        this.sceneManager.scene.traverse(o => {
            if (o.isHemisphereLight) o.intensity = 0.3;   // 冷色天光是墙面发青的主因，压低
            else if (o.isAmbientLight) o.intensity = 0.1;
            else if (o.isDirectionalLight) o.intensity *= 0.6; // 主光被吊顶挡住，留一点从窗透入
        });
    }

    /** 隐藏只服务于俯视的物件（房间名文字牌） */
    _hideOrbitOnlyObjects() {
        this.roomRenderer.sceneGroup?.traverse(o => {
            if (o.userData?.type === 'roomLabel') o.visible = false;
        });
    }

    _setupControls() {
        const cam = this.sceneManager.camera;
        cam.near = 10;
        cam.updateProjectionMatrix();
        this.controls = new FirstPersonControls(cam, this.sceneManager.renderer.domElement);
        this.controls.enabled = true;
        // 限制在户型轮廓内（可穿内墙，但走不出屋）
        this.controls.boundaryCheck = (x, y) =>
            !this.outlineRing || this._pointInRing(x, y, this.outlineRing);

        this.controls.onLockChange = (locked) => {
            this.ui.overlay.style.display = locked ? 'none' : '';
            this.ui.hint.style.display = locked ? '' : 'none';
        };

        // 点击画布/遮罩进入漫游
        const enter = () => this.controls.lock();
        this.sceneManager.renderer.domElement.addEventListener('click', enter);
        this.ui.overlay.addEventListener('click', enter);
    }

    _buildRoomList(roomInfo) {
        this.rooms = roomInfo
            .filter(r => r?.center)
            .map(r => ({ name: r.name || '房间', center: r.center }));

        this.ui.roomList.innerHTML = '';
        this.rooms.forEach((room, i) => {
            const btn = document.createElement('button');
            btn.className = 'vr-room-btn';
            // 前 9 间标出数字快捷键
            const key = i < 9 ? `<span class="key">${i + 1}</span>` : '<span class="key"></span>';
            btn.innerHTML = `${key}<span>${room.name}</span>`;
            btn.addEventListener('click', () => {
                this._enterRoom(i, true);
                this.controls.lock();     // 点按钮的手势顺带重新进入漫游
            });
            this.ui.roomList.appendChild(btn);
        });

        // 数字键 1~9 切换房间——漫游中鼠标被锁住，这是切房间的主要方式
        this._onRoomHotkey = (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            let n = -1;
            if (e.code.startsWith('Digit')) n = +e.code.slice(5);
            else if (e.code.startsWith('Numpad') && /Numpad[0-9]/.test(e.code)) n = +e.code.slice(6);
            if (n >= 1 && n <= this.rooms.length) {
                this._enterRoom(n - 1, true);   // 保持锁定，直接跳过去
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', this._onRoomHotkey);
    }

    _enterRoom(index, lookAtCenter) {
        const room = this.rooms[index];
        if (!room) return;
        // 站到房间中心稍偏一点，朝向中心，方便一眼看清
        this.controls.teleport(room.center.x, room.center.y);
        if (lookAtCenter) this.controls.lookAt(room.center.x, room.center.y);
        [...this.ui.roomList.children].forEach((b, i) =>
            b.classList.toggle('active', i === index));
        this._status(`已进入：${room.name}`);
    }

    // -- 几何辅助 --------------------------------------------------------------

    _normalizeRing(ring) {
        return ring.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
    }

    /** 射线法点在多边形内判定 */
    _pointInRing(x, y, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
            if (((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    // -- 渲染循环 --------------------------------------------------------------

    _startLoop() {
        const tick = () => {
            this.rafId = requestAnimationFrame(tick);
            if (this.paused) return;
            const dt = Math.min(0.05, this.clock.getDelta());
            this.controls.update(dt);
            this.sceneManager.renderer.render(this.sceneManager.scene, this.sceneManager.camera);
        };
        tick();
    }

    // -- 插件外壳生命周期 ------------------------------------------------------

    _setupHostLifecycle() {
        if (window.parent === window) return;
        const CHANNEL = 'renderer-preview', VERSION = 1;
        this._onHostMessage = (e) => {
            const m = e.data;
            if (e.source !== window.parent || !m || m.channel !== CHANNEL || m.version !== VERSION) return;
            if (m.type === 'activate') this.paused = false;
            else if (m.type === 'deactivate') { this.paused = true; this.controls?.unlock(); }
            else if (m.type === 'dispose') this.dispose();
        };
        window.addEventListener('message', this._onHostMessage);
    }

    _status(msg) {
        if (this.ui.info) this.ui.info.textContent = msg;
    }

    dispose() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.controls?.dispose();
        this.sceneManager?.destroy();
        if (this._onRoomHotkey) document.removeEventListener('keydown', this._onRoomHotkey);
        if (this._onHostMessage) window.removeEventListener('message', this._onHostMessage);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    geometryService.setDataSource(new BundledDataSource('data/Drawing2.json', 'data/parsed_dxf'));
    window.vrApp = new VRHouseApp();
});

window.addEventListener('beforeunload', () => window.vrApp?.dispose());
