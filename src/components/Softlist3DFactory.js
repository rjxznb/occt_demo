import * as THREE from 'three';

/**
 * 软装 3D 占位工厂
 *
 * 软装没有真实 3D 模型（数据里只有 2D 图例几何），所以在 3D 空间用挤出的 box
 * 占位——按软装方块的世界坐标轮廓（footprint）挤出一个矮柱体，摆在户型里表示
 * 「这里有一件家具、多大、什么朝向」。颜色默认中性，应用模板时按 TypeId 上色。
 */

const DEFAULT_HEIGHT = 400;      // 占位体默认高度（mm）
const DEFAULT_COLOR = 0xB8B0A0;  // 中性米灰，未应用模板时的默认色

export class Softlist3DFactory {
    /**
     * 由软装清单批量创建占位 box。
     * @param {Array} softlists - parse_data.SoftLists 里 kind==='softlist' 的项，
     *                            每项含 { id, typeId, footprint:[{x,y}] }
     * @returns {Array<THREE.Mesh>}
     */
    static createBoxes(softlists) {
        const meshes = [];

        (softlists || []).forEach(item => {
            if (item.kind !== 'softlist') return;         // 跳过同存的门/窗
            const fp = item.footprint;
            if (!Array.isArray(fp) || fp.length < 3) return;

            try {
                const mesh = this._createBox(fp);
                if (!mesh) return;
                mesh.userData = {
                    type: 'softlist',
                    softlistId: item.id,
                    typeId: item.typeId,
                };
                meshes.push(mesh);
            } catch (error) {
                console.warn(`软装占位 ${item.id} 创建失败:`, error.message);
            }
        });

        return meshes;
    }

    /** 由世界坐标轮廓挤出一个矮柱体（footprint 已是绝对坐标，直接用） */
    static _createBox(footprint) {
        const shape = new THREE.Shape();
        shape.moveTo(footprint[0].x, footprint[0].y);
        for (let i = 1; i < footprint.length; i++) {
            shape.lineTo(footprint[i].x, footprint[i].y);
        }
        shape.closePath();

        const geometry = new THREE.ExtrudeGeometry(shape, {
            steps: 1,
            depth: DEFAULT_HEIGHT,
            bevelEnabled: false,
        });
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: DEFAULT_COLOR,
            roughness: 0.85,
            metalness: 0.0,
        });

        const mesh = new THREE.Mesh(geometry, material);
        // 略微离地，避免底面与地板共面 z-fighting
        mesh.position.z = 1;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }
}

export default Softlist3DFactory;
