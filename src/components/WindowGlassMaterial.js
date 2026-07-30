import * as THREE from 'three';

const GLASS_MARKERS = ['glass', '\u73bb\u7483', '\u7a97\u73bb\u7483'];

function isGlass(mesh, material) {
    if (material?.userData?.contentMaterialIsGlass === true) return true;
    if (material?.userData?.contentMaterialIsGlass === false) return false;
    const label = `${mesh?.name ?? ''} ${material?.name ?? ''}`.toLowerCase();
    return GLASS_MARKERS.some(marker => label.includes(marker));
}

function normalizeMaterial(mesh, material) {
    if (!material?.isMaterial || !isGlass(mesh, material)) return material;

    const clone = material.clone();
    clone.transparent = true;
    clone.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, 0.32);
    clone.depthWrite = false;
    clone.side = THREE.DoubleSide;
    clone.needsUpdate = true;
    return clone;
}

export function applyWindowGlassMaterials(root) {
    if (!root?.isObject3D) return root;

    root.traverse(child => {
        if (!child.isMesh || !child.material) return;
        child.material = Array.isArray(child.material)
            ? child.material.map(material => normalizeMaterial(child, material))
            : normalizeMaterial(child, child.material);
    });
    return root;
}
