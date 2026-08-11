import * as THREE from 'three';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function projectPanoramaHotspot(point, camera, {
    width,
    height,
    margin = 40,
} = {}) {
    const world = new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z));
    const local = world.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = world.clone().project(camera);
    const inFront = local.z < 0;
    const inView = inFront
        && Math.abs(ndc.x) <= 1
        && Math.abs(ndc.y) <= 1
        && ndc.z >= -1
        && ndc.z <= 1;
    if (inView) {
        return {
            inView: true,
            left: ((ndc.x + 1) / 2) * width,
            top: ((1 - ndc.y) / 2) * height,
            angle: 0,
        };
    }

    let directionX = local.x;
    let directionY = -local.y;
    if (!inFront) {
        directionX *= -1;
        directionY *= -1;
    }
    if (Math.abs(directionX) + Math.abs(directionY) < 1e-9) directionY = -1;
    const length = Math.hypot(directionX, directionY) || 1;
    directionX /= length;
    directionY /= length;
    const halfWidth = Math.max(0, width / 2 - margin);
    const halfHeight = Math.max(0, height / 2 - margin);
    const scale = Math.min(
        Math.abs(directionX) > 1e-9 ? halfWidth / Math.abs(directionX) : Infinity,
        Math.abs(directionY) > 1e-9 ? halfHeight / Math.abs(directionY) : Infinity,
    );
    return {
        inView: false,
        left: clamp(width / 2 + directionX * scale, margin, width - margin),
        top: clamp(height / 2 + directionY * scale, margin, height - margin),
        angle: Math.atan2(directionY, directionX) * 180 / Math.PI,
    };
}

export class PanoramaHotspots {
    constructor(container, {
        onSelect = () => {},
        documentRef = globalThis.document,
        margin = 40,
    } = {}) {
        this.container = container;
        this.onSelect = onSelect;
        this.document = documentRef;
        this.margin = margin;
        this.visible = true;
        this.nodes = new Map();
    }

    render({ points = [], activePointId = null, visible = this.visible } = {}) {
        this.visible = Boolean(visible);
        this.container.replaceChildren();
        this.nodes.clear();
        for (const point of points) {
            if (point.id === activePointId || point.valid === false) continue;
            const button = this.document.createElement('button');
            button.type = 'button';
            button.classList.add('panorama-hotspot');
            button.dataset.pointId = point.id;
            button.textContent = point.roomName ? `${point.name} · ${point.roomName}` : point.name;
            button.setAttribute('aria-label', `进入${point.name}`);
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (this.visible) this.onSelect(point.id);
            });
            this.nodes.set(point.id, { button, point: { ...point } });
            this.container.appendChild(button);
        }
        this.setVisible(this.visible);
    }

    update(camera) {
        if (!this.visible || !camera) return;
        const rect = this.container.getBoundingClientRect();
        for (const { button, point } of this.nodes.values()) {
            const projection = projectPanoramaHotspot(point, camera, {
                width: rect.width,
                height: rect.height,
                margin: this.margin,
            });
            button.style.left = `${projection.left}px`;
            button.style.top = `${projection.top}px`;
            button.style.setProperty?.('--hotspot-angle', `${projection.angle}deg`);
            button.classList.toggle('is-offscreen', !projection.inView);
        }
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.container.hidden = !this.visible;
        this.container.setAttribute('aria-hidden', String(!this.visible));
        return this.visible;
    }

    dispose() {
        this.nodes.clear();
        this.container.replaceChildren();
    }
}
