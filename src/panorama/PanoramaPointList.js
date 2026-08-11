export class PanoramaPointList {
    constructor(container, {
        onSelect = () => {},
        onRename = () => {},
        onDelete = () => {},
        onSetInitial = () => {},
        onRestore = () => {},
        documentRef = globalThis.document,
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.callbacks = { onSelect, onRename, onDelete, onSetInitial, onRestore };
    }

    _button(label, action, pointId, callback) {
        const button = this.document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.action = `${action}:${pointId}`;
        button.addEventListener('click', event => {
            event.stopPropagation();
            callback(pointId);
        });
        return button;
    }

    render({
        points = [],
        activePointId = null,
        initialPointId = null,
        dirtyPointIds = [],
    } = {}) {
        this.container.replaceChildren();
        const dirty = new Set(dirtyPointIds);

        for (const point of points) {
            const row = this.document.createElement('article');
            row.classList.add('panorama-point-row');
            row.classList.toggle('is-active', point.id === activePointId);
            row.classList.toggle('is-initial', point.id === initialPointId);
            row.classList.toggle('is-dirty', dirty.has(point.id));
            row.dataset.pointId = point.id;
            row.textContent = `${point.name} · ${point.roomName || '未分配房间'} · ${Math.round(point.z)} mm`;

            const summary = this._button(
                `${point.name} · ${point.roomName || '未分配房间'} · ${Math.round(point.z)} mm`,
                'select',
                point.id,
                this.callbacks.onSelect,
            );
            summary.classList.add('panorama-point-summary');
            summary.setAttribute('aria-pressed', String(point.id === activePointId));

            const actions = this.document.createElement('div');
            actions.classList.add('panorama-point-actions');
            actions.appendChild(this._button('重命名', 'rename', point.id, this.callbacks.onRename));
            actions.appendChild(this._button('删除', 'delete', point.id, this.callbacks.onDelete));
            actions.appendChild(this._button('设为初始', 'initial', point.id, this.callbacks.onSetInitial));
            actions.appendChild(this._button('恢复', 'restore', point.id, this.callbacks.onRestore));

            row.appendChild(summary);
            row.appendChild(actions);
            this.container.appendChild(row);
        }
        this.container.hidden = points.length === 0;
    }

    dispose() {
        this.container.replaceChildren();
    }
}
