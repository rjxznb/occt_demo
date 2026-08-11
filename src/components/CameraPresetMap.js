const CAMERA_TYPE_IDS = new Set(['27d2', '27d202']);
const DEFAULT_CAMERA_HEIGHT = 1500;

function pointX(point) {
    return Number(Array.isArray(point) ? point[0] : point?.x);
}

function pointY(point) {
    return Number(Array.isArray(point) ? point[1] : point?.y);
}

export function parseCadVector(value) {
    if (value && typeof value === 'object') {
        const x = Number(value.x ?? value.X);
        const y = Number(value.y ?? value.Y);
        const z = Number(value.z ?? value.Z);
        if ([x, y, z].some(Number.isFinite)) {
            return {
                x: Number.isFinite(x) ? x : 0,
                y: Number.isFinite(y) ? y : 0,
                z: Number.isFinite(z) ? z : 0,
            };
        }
    }
    const text = String(value ?? '');
    const numberFor = axis => {
        const match = text.match(new RegExp(`${axis}=([-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?)`, 'i'));
        return match ? Number(match[1]) : 0;
    };
    return { x: numberFor('X'), y: numberFor('Y'), z: numberFor('Z') };
}

export function normalizeCameraPresets(cameraList) {
    if (!Array.isArray(cameraList)) return [];

    return cameraList.flatMap((record, sourceIndex) => {
        if (!record || typeof record !== 'object') return [];
        const typeId = String(record.TypeId ?? record.typeId ?? '').toLowerCase();
        if (typeId && !CAMERA_TYPE_IDS.has(typeId)) return [];

        const basePoint = parseCadVector(record.BasePoint ?? record.basePoint);
        const block = record.BlockInnerInfo ?? record.blockInnerInfo ?? {};
        const rotation = parseCadVector(block.Rotation ?? record.Rotation);
        const hasRotationVector = block.Rotation != null || record.Rotation != null;
        const height = Number(block['离地高度'] ?? block.liftoffHeight ?? basePoint.z);
        const yaw = hasRotationVector
            ? rotation.y
            : Number(block['旋转角度'] ?? block.rotationAngle ?? record.OutRotateRadian ?? 0);
        const pitch = hasRotationVector ? rotation.x : Number(block.Pitch ?? 0);
        const fov = Number(block.FOV ?? block.fov ?? record.FOV ?? 90);

        if (![basePoint.x, basePoint.y].every(Number.isFinite)) return [];
        return [{
            sourceIndex,
            typeId: typeId || '27d2',
            name: String(record.DisplayName ?? record.Name ?? `点位 ${sourceIndex + 1}`),
            x: basePoint.x,
            y: basePoint.y,
            z: Number.isFinite(height) && height > 0 ? height : DEFAULT_CAMERA_HEIGHT,
            yaw: Number.isFinite(yaw) ? yaw : 0,
            pitch: Number.isFinite(pitch) ? pitch : 0,
            fov: Number.isFinite(fov) ? Math.min(150, Math.max(30, fov)) : 90,
            raw: record,
        }];
    });
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
