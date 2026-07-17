import * as THREE from 'three';

/**
 * 房间名标注
 *
 * 在每个房间中心悬一块文字牌（房间名 + 面积），用 canvas 贴图的 Sprite 实现——
 * Sprite 始终朝向相机，从任意角度都能正对着读。
 */

const LABEL_Z = 1400;        // 标注离地高度（约齐腰，避免被家具占位块挡住又不顶到天花）
const WORLD_WIDTH = 2200;    // 标注牌世界尺寸（mm），随房间读起来大小合适

export class RoomLabelFactory {
    /**
     * @param {Array} roomInfo - [{name, area, perimeter, center:{x,y}}]
     * @returns {Array<THREE.Sprite>}
     */
    static createLabels(roomInfo) {
        const labels = [];
        (roomInfo || []).forEach((info, index) => {
            if (!info.name) return;
            const sprite = this._createLabel(info);
            if (!sprite) return;
            sprite.userData = { type: 'roomLabel', roomIndex: index, roomInfo: info };
            labels.push(sprite);
        });
        return labels;
    }

    static _createLabel(info) {
        const areaText = info.area ? `${Number(info.area).toFixed(1)}m²` : '';

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // 半透明圆角底板，提升可读性
        this._roundRect(ctx, 16, 64, 480, 128, 24);
        ctx.fillStyle = 'rgba(30,30,30,0.72)';
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 56px -apple-system, "Microsoft YaHei", sans-serif';
        ctx.fillText(info.name, 256, 120);

        if (areaText) {
            ctx.fillStyle = '#cfd8dc';
            ctx.font = '36px -apple-system, "Microsoft YaHei", sans-serif';
            ctx.fillText(areaText, 256, 168);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,   // 不被墙体遮挡，始终可见
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(material);
        sprite.position.set(info.center.x, info.center.y, LABEL_Z);
        sprite.scale.set(WORLD_WIDTH, WORLD_WIDTH / 2, 1);   // 512x256 → 2:1
        sprite.renderOrder = 999;   // 画在最后，压过场景
        return sprite;
    }

    static _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
}

export default RoomLabelFactory;
