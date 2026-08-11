import { calculateMiniMapLayout } from '../components/CameraPresetMap.js';

function pointX(point) {
    return Number(Array.isArray(point) ? point[0] : point?.x);
}

function pointY(point) {
    return Number(Array.isArray(point) ? point[1] : point?.y);
}

export class PanoramaMiniMap {
    constructor(container, {
        onSelect = () => {},
        onCreate = () => {},
        onToggle = () => {},
        documentRef = globalThis.document,
        padding = 240,
    } = {}) {
        this.container = container;
        this.onSelect = onSelect;
        this.onCreate = onCreate;
        this.onToggle = onToggle;
        this.document = documentRef;
        this.padding = padding;
        this.collapsed = false;
    }

    _element(tagName, className = '') {
        const element = this.document.createElement(tagName);
        if (className) element.classList.add(className);
        return element;
    }

    render({
        roomPoints = [],
        points = [],
        activePointId = null,
        dirtyPointIds = [],
        createMode = false,
        collapsed = this.collapsed,
    } = {}) {
        this.collapsed = Boolean(collapsed);
        this.container.replaceChildren();
        this.container.classList.toggle('is-collapsed', this.collapsed);
        const dirty = new Set(dirtyPointIds);
        const layout = calculateMiniMapLayout(roomPoints, points, this.padding);

        const header = this._element('header', 'panorama-minimap-header');
        const title = this._element('strong');
        title.textContent = '全景点位';
        const toggle = this._element('button', 'panorama-minimap-toggle');
        toggle.type = 'button';
        toggle.dataset.action = 'toggle-map';
        toggle.textContent = this.collapsed ? '展开' : '折叠';
        toggle.setAttribute('aria-expanded', String(!this.collapsed));
        toggle.addEventListener('click', event => {
            event.stopPropagation();
            this.collapsed = !this.collapsed;
            this.container.classList.toggle('is-collapsed', this.collapsed);
            stage.hidden = this.collapsed;
            toggle.textContent = this.collapsed ? '展开' : '折叠';
            toggle.setAttribute('aria-expanded', String(!this.collapsed));
            this.onToggle(this.collapsed);
        });
        header.appendChild(title);
        header.appendChild(toggle);
        this.container.appendChild(header);

        const stage = this._element('div', 'panorama-minimap-stage');
        stage.dataset.role = 'minimap-stage';
        stage.hidden = this.collapsed;
        if (!layout) {
            stage.classList.add('is-empty');
            this.container.appendChild(stage);
            return;
        }

        const svg = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `${layout.minX} ${-layout.maxY} ${layout.width} ${layout.height}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('aria-hidden', 'true');
        for (const room of roomPoints) {
            if (!Array.isArray(room) || room.length < 3) continue;
            const polygon = this.document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('class', 'panorama-minimap-room');
            polygon.setAttribute(
                'points',
                room.map(point => `${pointX(point)},${-pointY(point)}`).join(' '),
            );
            svg.appendChild(polygon);
        }
        stage.appendChild(svg);

        for (const point of points) {
            const position = layout.toPercent(point.x, point.y);
            const marker = this._element('button', 'panorama-map-point');
            marker.type = 'button';
            marker.dataset.pointId = point.id;
            marker.classList.toggle('is-active', point.id === activePointId);
            marker.classList.toggle('is-dirty', dirty.has(point.id));
            marker.style.left = `${position.left}%`;
            marker.style.top = `${position.top}%`;
            marker.title = `${point.name} · ${Math.round(point.z)} mm`;
            marker.setAttribute('aria-label', `进入${point.name}`);
            marker.setAttribute('aria-pressed', String(point.id === activePointId));
            const direction = this._element('span', 'panorama-map-direction');
            direction.style.transform = `rotate(${90 - (Number(point.yaw) || 0)}deg)`;
            marker.appendChild(direction);
            marker.addEventListener('click', event => {
                event.stopPropagation();
                this.onSelect(point.id);
            });
            stage.appendChild(marker);
        }

        stage.addEventListener('click', event => {
            if (!createMode) return;
            const rect = stage.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
            this.onCreate({
                x: layout.minX + ratioX * layout.width,
                y: layout.maxY - ratioY * layout.height,
            });
        });
        this.container.appendChild(stage);
    }

    dispose() {
        this.container.replaceChildren();
    }
}
