import * as THREE from 'three';

const GLASS_MARKERS = ['glass', '玻璃', '窗玻璃'];

function isNamedGlass(mesh, material) {
    const label = `${mesh?.name ?? ''} ${material?.name ?? ''}`.toLowerCase();
    return GLASS_MARKERS.some(marker => label.includes(marker));
}

function normalizeMaterial(mesh, material) {
    if (!material?.isMaterial || !isNamedGlass(mesh, material)) return material;

    const clone = material.clone();
    clone.transparent = true;
    clone.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, 0.32);
    clone.depthWrite = false;
    clone.side = THREE.DoubleSide;
    clone.needsUpdate = true;
    return clone;
}

export function applyWindowGlassMaterials(root, instance) {
    if (!root?.isObject3D || instance?.sourceList !== 'window_list') return root;

    root.traverse(child => {
        if (!child.isMesh || !child.material) return;
        child.material = Array.isArray(child.material)
            ? child.material.map(material => normalizeMaterial(child, material))
            : normalizeMaterial(child, child.material);
    });
    return root;
}
