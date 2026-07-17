import { TemplateApplier } from '../core/TemplateApplier.js';

/**
 * 配色模板选择器
 *
 * 弹出一个带预览图的模板列表，点击某个模板 → 解析并应用到 3D 场景。
 * 另提供「恢复默认」把场景还原成应用模板前的配色。
 */
export class TemplatePicker {
    /**
     * @param {Object} deps
     * @param {THREE.Object3D} deps.sceneGroup - RoomRenderer 的 sceneGroup
     * @param {THREE.Scene} deps.scene
     */
    constructor({ sceneGroup, scene }) {
        this.sceneGroup = sceneGroup;
        this.scene = scene;
        this.overlay = null;
        this.manifest = null;
        this.originalMaterials = null;   // 首次应用前的材质快照，用于恢复
    }

    async toggle() {
        if (this.overlay) { this.close(); return; }
        this.injectStyles();
        await this.render();
    }

    close() {
        this.overlay?.remove();
        this.overlay = null;
    }

    async render() {
        if (!this.manifest) {
            try {
                this.manifest = await (await fetch('/data/templates/templates.json')).json();
            } catch (e) {
                this.manifest = [];
            }
        }

        const overlay = document.createElement('div');
        overlay.className = 'tpl-overlay';
        overlay.innerHTML = `
            <div class="tpl-panel">
                <div class="tpl-head">
                    <span>配色模板</span>
                    <button class="tpl-close" title="关闭">×</button>
                </div>
                <div class="tpl-grid">
                    ${this.manifest.map(t => `
                        <div class="tpl-card" data-file="${t.file}">
                            <img src="/data/templates/${encodeURIComponent(t.preview)}" loading="lazy" alt="${t.name}">
                            <div class="tpl-name">${t.name}</div>
                        </div>
                    `).join('')}
                </div>
                <button class="tpl-reset">恢复默认配色</button>
            </div>
        `;
        document.body.appendChild(overlay);
        this.overlay = overlay;

        overlay.querySelector('.tpl-close').onclick = () => this.close();
        overlay.querySelector('.tpl-reset').onclick = () => this.reset();
        overlay.querySelectorAll('.tpl-card').forEach(card => {
            card.onclick = () => this.applyByFile(card.dataset.file, card);
        });
    }

    async applyByFile(file, card) {
        try {
            this.snapshotMaterials();
            const template = await (await fetch(`/data/templates/${encodeURIComponent(file)}`)).json();
            new TemplateApplier(template).apply(this.sceneGroup, this.scene);

            // 高亮当前选中
            this.overlay?.querySelectorAll('.tpl-card').forEach(c => c.classList.remove('active'));
            card?.classList.add('active');
        } catch (e) {
            console.error('应用模板失败:', e);
        }
    }

    /** 记录首次应用前的材质，供恢复 */
    snapshotMaterials() {
        if (this.originalMaterials) return;
        this.originalMaterials = new Map();
        this.sceneGroup.traverse(obj => {
            if (obj.isMesh && obj.material) {
                this.originalMaterials.set(obj, obj.material);
            }
        });
    }

    reset() {
        if (!this.originalMaterials) return;
        this.originalMaterials.forEach((mat, obj) => { obj.material = mat; });
        this.overlay?.querySelectorAll('.tpl-card').forEach(c => c.classList.remove('active'));
    }

    injectStyles() {
        if (document.getElementById('tpl-styles')) return;
        const style = document.createElement('style');
        style.id = 'tpl-styles';
        style.textContent = `
            .tpl-overlay {
                position: fixed; inset: 0; z-index: 9998;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0,0,0,0.45);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .tpl-panel {
                width: 720px; max-width: 92vw; max-height: 86vh;
                background: #242424; color: #e8e8e8;
                border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
                padding: 20px; display: flex; flex-direction: column;
            }
            .tpl-head { display: flex; justify-content: space-between; align-items: center;
                font-size: 16px; font-weight: 600; margin-bottom: 16px; }
            .tpl-close { background: none; border: none; color: #aaa; font-size: 22px;
                cursor: pointer; line-height: 1; padding: 0 4px; }
            .tpl-close:hover { color: #fff; }
            .tpl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
                overflow-y: auto; padding: 2px; }
            .tpl-card { background: #1c1c1c; border: 2px solid transparent; border-radius: 8px;
                overflow: hidden; cursor: pointer; transition: border-color .15s; }
            .tpl-card:hover { border-color: #4a8be5; }
            .tpl-card.active { border-color: #e8672c; }
            .tpl-card img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #333; }
            .tpl-name { padding: 8px; font-size: 13px; text-align: center; }
            .tpl-reset { margin-top: 16px; padding: 10px; background: #333; color: #e8e8e8;
                border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; font-size: 13px; }
            .tpl-reset:hover { background: #3d3d3d; }
        `;
        document.head.appendChild(style);
    }
}
