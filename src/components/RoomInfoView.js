import * as THREE from 'three';

/**
 * 房间信息查看
 *
 * 在 3D 视图里点击某个房间（地板或它的名称标注），弹出一个信息卡片，显示
 * 房间名、面积、周长，以及各段内墙的长度。用独立的 raycaster，只认房间相关的
 * 对象（type='floor' / 'roomLabel'），不干扰现有的选择/材质交互。
 */
export class RoomInfoView {
    /**
     * @param {SceneManager} sceneManager - 提供相机、控制器、renderer.domElement
     * @param {THREE.Object3D} sceneGroup - 场景组（含地板、房间标注）
     */
    constructor(sceneManager, sceneGroup) {
        this.sceneManager = sceneManager;
        this.sceneGroup = sceneGroup;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.panel = null;
        this.enabled = true;

        this._injectStyles();
        this._bind();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this._hide();
    }

    _bind() {
        const dom = this.sceneManager.renderer.domElement;
        // 用 down/up 位移判断是「点击」还是「拖拽旋转」——拖拽不弹面板
        let downX = 0, downY = 0;
        dom.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
        dom.addEventListener('pointerup', e => {
            if (!this.enabled) return;
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // 拖拽，忽略
            this._onClick(e);
        });
    }

    _onClick(event) {
        const dom = this.sceneManager.renderer.domElement;
        const rect = dom.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.sceneManager.getCamera());

        // 收集房间相关对象（地板 + 标注），取最近命中
        const targets = [];
        this.sceneGroup.traverse(o => {
            if (o.userData?.type === 'floor' || o.userData?.type === 'roomLabel') targets.push(o);
        });
        const hits = this.raycaster.intersectObjects(targets, false);
        if (hits.length === 0) { this._hide(); return; }

        const info = hits[0].object.userData.roomInfo;
        if (info) this._show(info, event.clientX, event.clientY);
        else this._hide();
    }

    _show(info, x, y) {
        if (!this.panel) {
            this.panel = document.createElement('div');
            this.panel.className = 'room-info-panel';
            document.body.appendChild(this.panel);
        }

        const area = info.area ? `${Number(info.area).toFixed(2)} m²` : '—';
        const perim = info.perimeter ? `${Number(info.perimeter).toFixed(2)} m` : '—';
        const walls = (info.wallLengths || []).slice().sort((a, b) => b - a);
        const wallRows = walls.length
            ? walls.map((w, i) => `<div class="rip-wall"><span>墙${i + 1}</span><span>${(w / 1000).toFixed(2)} m</span></div>`).join('')
            : '<div class="rip-empty">无内墙数据</div>';

        this.panel.innerHTML = `
            <div class="rip-head">
                <span>${info.name || '房间'}</span>
                <button class="rip-close" title="关闭">×</button>
            </div>
            <div class="rip-row"><span>面积</span><span>${area}</span></div>
            <div class="rip-row"><span>周长</span><span>${perim}</span></div>
            <div class="rip-sub">内墙尺寸（${walls.length} 段）</div>
            <div class="rip-walls">${wallRows}</div>
        `;
        this.panel.querySelector('.rip-close').onclick = () => this._hide();

        // 放在点击点附近，避免超出视口右/下边
        const px = Math.min(x + 12, window.innerWidth - 240);
        const py = Math.min(y + 12, window.innerHeight - 320);
        this.panel.style.left = px + 'px';
        this.panel.style.top = py + 'px';
        this.panel.style.display = 'block';
    }

    _hide() {
        if (this.panel) this.panel.style.display = 'none';
    }

    _injectStyles() {
        if (document.getElementById('room-info-styles')) return;
        const style = document.createElement('style');
        style.id = 'room-info-styles';
        style.textContent = `
            .room-info-panel {
                position: fixed; z-index: 9997; display: none;
                width: 220px; max-height: 300px; overflow-y: auto;
                background: #242424; color: #e8e8e8;
                border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
                padding: 12px 14px; font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            }
            .rip-head { display: flex; justify-content: space-between; align-items: center;
                font-size: 15px; font-weight: 600; margin-bottom: 10px; }
            .rip-close { background: none; border: none; color: #aaa; font-size: 20px;
                cursor: pointer; line-height: 1; padding: 0 2px; }
            .rip-close:hover { color: #fff; }
            .rip-row { display: flex; justify-content: space-between; padding: 3px 0; color: #cfd8dc; }
            .rip-sub { margin: 10px 0 6px; font-size: 12px; color: #8a8a8a;
                border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
            .rip-wall { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
            .rip-wall span:first-child { color: #8a8a8a; }
            .rip-empty { color: #8a8a8a; font-size: 12px; }
        `;
        document.head.appendChild(style);
    }
}
