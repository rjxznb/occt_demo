import * as THREE from 'three';

/**
 * 配色模板应用
 *
 * 解析 CAD 侧导出的配色模板 JSON（如「M系列-白色浪漫.json」），把颜色应用到 3D 场景。
 *
 * 模板里包含很多东西，但只解析当前 3D 空间里真实存在的实体：
 *   - Wall   → 墙（外壳 + 墙段），取 NormalWall 颜色
 *   - Floor  → 地板，按房间名匹配 RoomList，取对应颜色（空 RoomList 那项为默认）
 *   - BackGround → 场景背景色
 *
 * 跳过的（3D 里没有对应实体或无对应样式）：
 *   - LegendCategoryStyle / SpaceOrnament（软装，只在 2D 彩平图）
 *   - SpaceMarkRuler（尺寸标注，2D）
 *   - LightStyle（灯带，软装图例）、Shadow（2D 彩平的阴影参数）
 *   - 门、窗（模板未提供门窗配色）
 *
 * 贴图（Texture 字段指向 //cartoon_style//... 等外部文件）本地没有，故只应用颜色。
 */
export class TemplateApplier {
    /**
     * @param {Object} template - 模板 JSON
     */
    constructor(template) {
        this.template = template || {};
        this.wallColor = this._parseColor(this.template.Wall?.NormalWall?.Color);
        this.bgColor = this._parseColor(this.template.BackGround?.Color);
        this.floorStyles = this._buildFloorStyles(this.template.Floor);
        this.softlistColorByTypeId = this._buildSoftlistColors(this.template.LegendCategoryStyle);
    }

    /**
     * 把模板应用到 3D 场景。
     * @param {THREE.Object3D} sceneGroup - RoomRenderer 的 sceneGroup（含墙、地板等）
     * @param {THREE.Scene} [scene] - 用于设置背景色（可选）
     */
    apply(sceneGroup, scene) {
        if (!sceneGroup) return;

        let walls = 0, floors = 0, softlists = 0;
        sceneGroup.traverse(obj => {
            if (!obj.isMesh || !obj.material) return;
            const ud = obj.userData || {};

            // 墙：外壳（outWall）与墙段（有 segmentType）
            if ((ud.type === 'outWall' || ud.segmentType) && this.wallColor) {
                this._setColor(obj, this.wallColor);
                walls++;
                return;
            }

            // 地板：按房间名取对应颜色，取不到用默认
            if (ud.type === 'floor') {
                const color = this._floorColorFor(ud.roomName);
                if (color) {
                    this._setColor(obj, color);
                    floors++;
                }
                return;
            }

            // 软装占位 box：按 TypeId 在 LegendCategoryStyle 里查类别取 PaddingColor
            if (ud.type === 'softlist') {
                const color = this.softlistColorByTypeId.get(ud.typeId);
                if (color) {
                    this._setColor(obj, color);
                    softlists++;
                }
            }
            // 门、窗：模板未提供门窗配色，保持原样
        });

        // 背景（可选）：模板背景多为纯白，会盖掉现有渐变天空，故默认不动背景，
        // 只在调用方明确要求时才改。这里保留能力但不主动应用。

        console.log(`模板已应用：墙 ${walls} 面，地板 ${floors} 块，软装 ${softlists} 件`);
        return { walls, floors, softlists };
    }

    /** 背景色（供调用方决定要不要设） */
    getBackgroundColor() {
        return this.bgColor;
    }

    // ── 内部 ──

    /** "R,G,B,A"(0-255) → THREE.Color（按 sRGB 解释，转到渲染用的线性空间） */
    _parseColor(str) {
        if (!str || typeof str !== 'string') return null;
        const parts = str.split(',').map(Number);
        if (parts.length < 3 || parts.some(n => Number.isNaN(n))) return null;
        const [r, g, b] = parts;
        return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    }

    /**
     * 把 Floor 数组整理成 { byRoom: Map<房间名, Color>, default: Color }。
     * 每个 Floor 条目有 RoomList（适用房间）与 Color；空 RoomList 的作默认。
     */
    _buildFloorStyles(floorArr) {
        const byRoom = new Map();
        let def = null;
        (floorArr || []).forEach(f => {
            const color = this._parseColor(f.Color);
            if (!color) return;
            const rooms = f.RoomList || [];
            if (rooms.length === 0) {
                def = def || color;   // 第一个空 RoomList 的作默认
            } else {
                rooms.forEach(name => byRoom.set(name, color));
            }
        });
        return { byRoom, default: def };
    }

    _floorColorFor(roomName) {
        return this.floorStyles.byRoom.get(roomName) || this.floorStyles.default;
    }

    /**
     * 由 LegendCategoryStyle 建 TypeId → 颜色 的映射。
     * 每个类别（chuang=床、shafa=沙发…）有 ItemID（该类的 TypeId 列表）与 PaddingColor（填充色）。
     */
    _buildSoftlistColors(legendStyle) {
        const map = new Map();
        Object.values(legendStyle || {}).forEach(cat => {
            const color = this._parseColor(cat.PaddingColor);
            if (!color) return;
            (cat.ItemID || []).forEach(id => map.set(id, color));
        });
        return map;
    }

    /** 给 mesh 上色。CSG 结果 mesh 可能共享材质引用，克隆后再改避免波及其它 mesh。 */
    _setColor(mesh, color) {
        if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map(m => {
                const c = m.clone();
                c.color.copy(color);
                return c;
            });
        } else {
            mesh.material = mesh.material.clone();
            mesh.material.color.copy(color);
        }
    }
}
