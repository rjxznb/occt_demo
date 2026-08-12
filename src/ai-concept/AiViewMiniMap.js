import { calculateMiniMapLayout } from '../components/CameraPresetMap.js';

function pointX(point) {
    return Number(Array.isArray(point) ? point[0] : point?.x);
}

function pointY(point) {
    return Number(Array.isArray(point) ? point[1] : point?.y);
}

export class AiViewMiniMap {
    constructor(container, {
        documentRef = globalThis.document,
        onSelect = () => {},
        padding = 240,
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.onSelect = onSelect;
        this.padding = padding;
    }

    render({ roomPoints = [], views = [], activeViewId = null } = {}) {
        if (!this.container || !this.document) return;
        const visible = views.filter(view => !['excluded', 'disabled'].includes(view.status)
            && Number.isFinite(Number(view.x)) && Number.isFinite(Number(view.y)));
        const layout = calculateMiniMapLayout(roomPoints, visible, this.padding);
        this.container.replaceChildren();
        this.container.hidden = !layout;
        if (!layout) return;

        const header = this.document.createElement('header');
        header.classList.add('ai-view-minimap-header');
        header.textContent = '候选视角';
        const stage = this.document.createElement('div');
        stage.classList.add('ai-view-minimap-stage');
        const svg = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `${layout.minX} ${-layout.maxY} ${layout.width} ${layout.height}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('aria-hidden', 'true');
        for (const room of roomPoints) {
            if (!Array.isArray(room) || room.length < 3) continue;
            const polygon = this.document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.classList.add('ai-view-minimap-room');
            polygon.setAttribute('points', room.map(point => `${pointX(point)},${-pointY(point)}`).join(' '));
            svg.appendChild(polygon);
        }
        stage.appendChild(svg);

        for (const view of visible) {
            const position = layout.toPercent(Number(view.x), Number(view.y));
            const marker = this.document.createElement('button');
            marker.type = 'button';
            marker.classList.add('ai-view-map-point');
            marker.classList.toggle('is-active', view.id === activeViewId);
            marker.dataset.viewId = view.id;
            marker.style.left = `${position.left}%`;
            marker.style.top = `${position.top}%`;
            marker.title = `${view.roomName || '房间'} · ${view.name || '候选视角'}`;
            marker.setAttribute('aria-label', `进入${view.roomName || ''}${view.name || '候选视角'}`);
            marker.setAttribute('aria-pressed', String(view.id === activeViewId));
            marker.addEventListener('click', event => {
                event.stopPropagation?.();
                this.onSelect(view.id);
            });
            stage.appendChild(marker);
        }
        this.container.appendChild(header);
        this.container.appendChild(stage);
    }

    dispose() {
        this.container?.replaceChildren?.();
    }
}
