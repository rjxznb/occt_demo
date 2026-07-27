import * as THREE from 'three';
import {
    classifySceneClick,
    decideRoomPanelAction,
    logParametricSoftlistDebug,
} from './SceneClickInteraction.js';

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
        this.activeRoomIndex = null;

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

        // 房间与参数化软装共用一次射线检测，避免点击模型时穿透到底层地板。
        const targets = [];
        this.sceneGroup.traverse(object => {
            const type = object.userData?.type;
            if (!object.visible) return;
            if (type === 'floor' || type === 'roomLabel' ||
                (type === 'parametric-softlist' && object.isMesh)) {
                targets.push(object);
            }
        });
        const hits = this.raycaster.intersectObjects(targets, false);
        if (hits.length === 0) { this._hide(); return; }

        const target = classifySceneClick(hits[0].object);
        if (target.kind === 'model') {
            logParametricSoftlistDebug(target.modelRoot, window.location.hash);
            return;
        }
        if (target.kind !== 'room') {
            this._hide();
            return;
        }
        if (target.roomIndex == null || !target.roomInfo) {
            if (window.location.hash === '#debug') {
                console.warn('[房间信息] 命中对象缺少 roomIndex 或 roomInfo');
            }
            this._hide();
            return;
        }

        const decision = decideRoomPanelAction(
            this.activeRoomIndex,
            this._isPanelVisible(),
            target.roomIndex,
        );
        if (decision.action === 'hide') {
            this._hide();
            return;
        }

        this.activeRoomIndex = decision.roomIndex;
        this._show(target.roomInfo, event.clientX, event.clientY);
    }

    _show(info, x, y) {
        if (!this.panel) {
            this.panel = document.createElement('div');
            this.panel.className = 'room-info-panel';
            document.body.appendChild(this.panel);
        }

        const area = info.area ? `${Number(info.area).toFixed(2)} m²` : '—';
        const perim = info.perimeter ? `${Number(info.perimeter).toFixed(2)} m` : '—';
        const walls = info.walls || [];

        this.panel.innerHTML = `
            <div class="rip-head">
                <span>${info.name || '房间'}</span>
                <button class="rip-close" title="关闭">×</button>
            </div>
            <div class="rip-row"><span>面积</span><span>${area}</span></div>
            <div class="rip-row"><span>周长</span><span>${perim}</span></div>
            <div class="rip-sub">内墙尺寸（俯视图 · ${walls.length} 段）</div>
            <canvas class="rip-plan" width="280" height="280"></canvas>
        `;
        this.panel.querySelector('.rip-close').onclick = () => this._hide();
        this._makeDraggable(this.panel.querySelector('.rip-head'));
        this._drawPlan(this.panel.querySelector('.rip-plan'), info);

        // 放在点击点附近，避免超出视口右/下边
        const px = Math.min(x + 12, window.innerWidth - 320);
        const py = Math.min(y + 12, window.innerHeight - 400);
        this.panel.style.left = px + 'px';
        this.panel.style.top = py + 'px';
        this.panel.style.display = 'block';
    }

    /**
     * 初始化俯视图：算好「世界 → 基准画布」的等比拟合变换，建立可缩放/平移的
     * 视口，绑定交互后首帧渲染。
     *
     * 缩放的关键：几何(轮廓、墙锚点)随 zoom 放大、但文字保持屏幕尺寸不变——
     * 这样放大密集处时标签才会真正散开；若文字一起放大则永远等比重叠、白缩放。
     * 世界坐标 y 朝上、canvas y 朝下，拟合时翻转 y。
     */
    _drawPlan(canvas, info) {
        const outline = info.outline || [];
        if (outline.length < 3) return;

        const dpr = window.devicePixelRatio || 1;
        const CSS = 280;
        canvas.width = CSS * dpr;
        canvas.height = CSS * dpr;
        canvas.style.width = CSS + 'px';
        canvas.style.height = CSS + 'px';

        // 包围盒 → 等比拟合居中，留边给标注
        const PAD = 46;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of outline) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
        const scale = Math.min((CSS - 2 * PAD) / bw, (CSS - 2 * PAD) / bh);
        const ox = (CSS - bw * scale) / 2, oy = (CSS - bh * scale) / 2;
        // 世界 → 基准画布（未叠加缩放/平移）
        const T0 = p => ({ x: ox + (p.x - minX) * scale, y: oy + (maxY - p.y) * scale });

        this._plan = {
            canvas, ctx: canvas.getContext('2d'), info, CSS, dpr, scale, T0,
            view: { zoom: 1, panX: 0, panY: 0 },  // 视口：基准画布 → 屏幕
        };
        this._bindPlanInteraction(canvas);
        this._renderPlan();
    }

    /** 按当前视口(zoom/pan)重绘俯视图 */
    _renderPlan() {
        const P = this._plan;
        if (!P) return;
        const { ctx, CSS, dpr, scale, T0, info } = P;
        const { zoom, panX, panY } = P.view;
        const walls = info.walls || [];
        const outline = info.outline || [];

        // 视口变换：基准画布坐标 → 屏幕坐标（几何缩放，文字尺寸后面单独固定）
        const V = q => ({ x: q.x * zoom + panX, y: q.y * zoom + panY });
        const T = p => V(T0(p));   // 世界 → 屏幕

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, CSS, CSS);

        // 轮廓中心（屏幕空间），用于把标注推向墙的外侧
        const pts = outline.map(T);
        let cx = 0, cy = 0;
        for (const p of pts) { cx += p.x / pts.length; cy += p.y / pts.length; }

        // 填充 + 描边房间轮廓
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(120,170,200,0.16)';
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(150,200,235,0.9)';
        ctx.stroke();

        ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const w of walls) {
            const a = T(w.a), b = T(w.b);

            // 高亮该墙。弧墙不画直线弦（会横切过曲线），由轮廓曲线本身表示。
            if (!w.isArc) {
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = 'rgba(255,220,120,0.95)';
                ctx.stroke();
            }

            // 标注落点。
            let lx, ly;
            if (w.isArc) {
                // 弧墙：锚在弧顶，沿「质心→弧顶」方向外移，落到曲线外沿
                const anchor = T(w.mid);
                let dirx = anchor.x - cx, diry = anchor.y - cy;
                const dlen = Math.hypot(dirx, diry) || 1;
                dirx /= dlen; diry /= dlen;
                lx = anchor.x + dirx * 12; ly = anchor.y + diry * 12;
            } else {
                // 直墙：锚在弦中点，沿墙法线外移——每个标签落在自己那面墙的正外侧，
                // 避免「从质心放射」在拐角处几个短墙标签扎堆重叠。
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                let nx = -(b.y - a.y), ny = b.x - a.x;
                const nlen = Math.hypot(nx, ny) || 1;
                nx /= nlen; ny /= nlen;
                if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
                lx = mx + nx * 14; ly = my + ny * 14;
            }

            const label = (w.len / 1000).toFixed(2);
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(20,20,20,0.78)';
            ctx.fillRect(lx - tw / 2 - 3, ly - 8, tw + 6, 16);
            ctx.fillStyle = '#ffe89a';
            ctx.fillText(label, lx, ly);
        }

        // 角标：单位 + 操作提示（屏幕空间固定，不随缩放）
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8a8a8a';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillText('单位：米', 6, CSS - 8);
        ctx.textAlign = 'right';
        ctx.fillStyle = zoom > 1 ? '#c9a94a' : '#6a6a6a';
        ctx.fillText(zoom > 1 ? `${zoom.toFixed(1)}× · 滚轮缩放 / 拖动 / 双击复位` : '滚轮放大看密集处', CSS - 6, CSS - 8);
    }

    /** 俯视图缩放平移交互：滚轮缩放(以光标为中心)、拖动平移、双击复位 */
    _bindPlanInteraction(canvas) {
        canvas.style.cursor = 'grab';

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const P = this._plan; if (!P) return;
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
            const v = P.view;
            const nz = Math.max(1, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            const k = nz / v.zoom;
            // 让光标下的点保持不动：pan' = c - (c - pan) * k
            v.panX = cx - (cx - v.panX) * k;
            v.panY = cy - (cy - v.panY) * k;
            v.zoom = nz;
            if (nz === 1) { v.panX = 0; v.panY = 0; }   // 回到 1× 时重新居中
            this._renderPlan();
        }, { passive: false });

        let dragging = false, lx = 0, ly = 0;
        canvas.addEventListener('pointerdown', e => {
            dragging = true; lx = e.clientX; ly = e.clientY;
            canvas.setPointerCapture(e.pointerId);
            canvas.style.cursor = 'grabbing';
            e.stopPropagation();   // 不冒泡到面板/3D
        });
        canvas.addEventListener('pointermove', e => {
            if (!dragging) return;
            const v = this._plan.view;
            v.panX += e.clientX - lx; v.panY += e.clientY - ly;
            lx = e.clientX; ly = e.clientY;
            this._renderPlan();
        });
        const end = () => { dragging = false; canvas.style.cursor = 'grab'; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);

        canvas.addEventListener('dblclick', e => {
            e.preventDefault();
            this._plan.view = { zoom: 1, panX: 0, panY: 0 };
            this._renderPlan();
        });
    }

    _isPanelVisible() {
        return this.panel?.style.display === 'block';
    }

    _hide() {
        if (this.panel) this.panel.style.display = 'none';
        this.activeRoomIndex = null;
    }

    /** 拖动标题栏移动面板（点关闭按钮不触发拖动） */
    _makeDraggable(handle) {
        if (!handle) return;
        handle.style.cursor = 'move';
        handle.addEventListener('pointerdown', e => {
            if (e.target.closest('.rip-close')) return;   // 关闭按钮不拖
            e.preventDefault();
            const rect = this.panel.getBoundingClientRect();
            const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
            const move = ev => {
                // 夹在视口内，避免拖出屏幕丢失
                const px = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - rect.width));
                const py = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - rect.height));
                this.panel.style.left = px + 'px';
                this.panel.style.top = py + 'px';
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }

    _injectStyles() {
        if (document.getElementById('room-info-styles')) return;
        const style = document.createElement('style');
        style.id = 'room-info-styles';
        style.textContent = `
            .room-info-panel {
                position: fixed; z-index: 9997; display: none;
                width: 304px;
                background: #242424; color: #e8e8e8;
                border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
                padding: 12px 14px; font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
                box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            }
            .rip-head { display: flex; justify-content: space-between; align-items: center;
                font-size: 15px; font-weight: 600; margin-bottom: 10px; user-select: none; }
            .rip-close { background: none; border: none; color: #aaa; font-size: 20px;
                cursor: pointer; line-height: 1; padding: 0 2px; }
            .rip-close:hover { color: #fff; }
            .rip-row { display: flex; justify-content: space-between; padding: 3px 0; color: #cfd8dc; }
            .rip-sub { margin: 10px 0 6px; font-size: 12px; color: #8a8a8a;
                border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
            .rip-plan { display: block; margin: 2px auto 0; width: 280px; height: 280px;
                background: rgba(0,0,0,0.18); border-radius: 6px; }
        `;
        document.head.appendChild(style);
    }
}
