import {
    normalizeCameraPresets,
    parseCadVector,
} from '../panorama/PanoramaPointModel.js';

export { normalizeCameraPresets, parseCadVector };

function pointX(point) {
    return Number(Array.isArray(point) ? point[0] : point?.x);
}

function pointY(point) {
    return Number(Array.isArray(point) ? point[1] : point?.y);
}

export function calculateMiniMapLayout(roomPoints, presets, padding = 240) {
    const points = [
        ...(roomPoints || []).flatMap(room => room || []),
        ...(presets || []).map(point => ({ x: point.x, y: point.y })),
    ].filter(point => Number.isFinite(pointX(point)) && Number.isFinite(pointY(point)));

    if (!points.length) return null;
    const xs = points.map(pointX);
    const ys = points.map(pointY);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
        minX, maxX, minY, maxY, width, height,
        toPercent(x, y) {
            return {
                left: ((x - minX) / width) * 100,
                top: ((maxY - y) / height) * 100,
            };
        },
    };
}

function createSvgElement(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
}

export class CameraPresetMap {
    constructor(container, { onSelect } = {}) {
        this.container = container;
        this.onSelect = onSelect;
        this.presets = [];
        this.activeIndex = -1;
    }

    setData(roomPoints, cameraList) {
        this.presets = normalizeCameraPresets(cameraList);
        this.container.replaceChildren();
        this.container.hidden = this.presets.length === 0;
        if (!this.presets.length) return;

        const layout = calculateMiniMapLayout(roomPoints, this.presets);
        if (!layout) return;

        const header = document.createElement('div');
        header.className = 'camera-minimap-header';
        header.innerHTML = '<span>全景点位</span><small>点击黄色点进入</small>';
        this.container.appendChild(header);

        const stage = document.createElement('div');
        stage.className = 'camera-minimap-stage';
        const svg = createSvgElement('svg');
        svg.setAttribute('viewBox', `${layout.minX} ${-layout.maxY} ${layout.width} ${layout.height}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('aria-hidden', 'true');

        (roomPoints || []).forEach(room => {
            if (!Array.isArray(room) || room.length < 3) return;
            const polygon = createSvgElement('polygon');
            polygon.setAttribute('points', room.map(point => `${pointX(point)},${-pointY(point)}`).join(' '));
            polygon.setAttribute('class', 'camera-minimap-room');
            svg.appendChild(polygon);
        });
        stage.appendChild(svg);

        this.presets.forEach((preset, index) => {
            const position = layout.toPercent(preset.x, preset.y);
            const marker = document.createElement('button');
            marker.type = 'button';
            marker.className = 'camera-map-point';
            marker.style.left = `${position.left}%`;
            marker.style.top = `${position.top}%`;
            marker.title = `${preset.name} · 高度 ${Math.round(preset.z)} mm`;
            marker.setAttribute('aria-label', `进入${preset.name}`);
            marker.dataset.cameraIndex = String(index);

            const direction = document.createElement('span');
            direction.className = 'camera-map-direction';
            direction.style.transform = `rotate(${90 - preset.yaw}deg)`;
            marker.appendChild(direction);
            marker.addEventListener('click', event => {
                event.stopPropagation();
                this.setActive(index);
                this.onSelect?.(preset, index);
            });
            stage.appendChild(marker);
        });

        this.container.appendChild(stage);
        this.setActive(-1);
    }

    setActive(index) {
        this.activeIndex = index;
        this.container.querySelectorAll('.camera-map-point').forEach((marker, markerIndex) => {
            marker.classList.toggle('active', markerIndex === index);
            marker.setAttribute('aria-pressed', String(markerIndex === index));
        });
    }

    dispose() {
        this.container.replaceChildren();
        this.presets = [];
    }
}
