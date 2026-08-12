function button(documentRef, text, action, handler, attributes = {}) {
    const element = documentRef.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.dataset.action = action;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.addEventListener('click', event => {
        event.stopPropagation?.();
        handler();
    });
    return element;
}
export class AiViewFilmstrip {
    constructor(container, {
        documentRef = globalThis.document,
        onActivate = () => {},
        onToggleSelected = () => {},
        onEdit = () => {},
        onDelete = () => {},
        onRestore = () => {},
        onAdd = () => {},
        onRoomFilter = () => {},
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.handlers = { onActivate, onToggleSelected, onEdit, onDelete, onRestore, onAdd, onRoomFilter };
    }

    render({ views = [], activeViewId = null, activeRoomId = null } = {}) {
        if (!this.container || !this.document) return;
        const visible = views.filter(view => !['excluded', 'disabled'].includes(view.status));
        const rooms = [];
        for (const view of visible) {
            if (!rooms.some(room => room.id === view.roomId)) {
                rooms.push({ id: view.roomId, name: view.roomName || '未命名房间' });
            }
        }

        const roomNav = this.document.createElement('nav');
        roomNav.classList.add('ai-room-tabs');
        roomNav.setAttribute('aria-label', '房间筛选');
        for (const room of rooms) {
            const roomButton = button(
                this.document,
                room.name,
                'room-filter',
                () => this.handlers.onRoomFilter(room.id),
                { 'aria-pressed': String(room.id === activeRoomId) },
            );
            roomButton.dataset.roomId = room.id;
            roomButton.classList.toggle('is-active', room.id === activeRoomId);
            roomNav.appendChild(roomButton);
        }

        const track = this.document.createElement('div');
        track.classList.add('ai-view-track');
        const filtered = visible.filter(view => !activeRoomId || view.roomId === activeRoomId);
        for (const view of filtered) track.appendChild(this._card(view, view.id === activeViewId));

        const add = button(this.document, '＋ 添加自定义视角', 'add', this.handlers.onAdd);
        add.classList.add('ai-view-add');
        track.appendChild(add);

        const footer = this.document.createElement('div');
        footer.classList.add('ai-filmstrip-footer');
        if (views.some(view => view.status === 'excluded')) {
            footer.appendChild(button(this.document, '恢复已排除视角', 'restore', this.handlers.onRestore));
        }

        this.container.replaceChildren(roomNav, track, footer);
    }

    _card(view, active) {
        const card = this.document.createElement('article');
        card.dataset.viewId = view.id;
        card.classList.add('ai-view-card');
        card.classList.toggle('is-active', active);
        card.classList.toggle('is-selected', Boolean(view.selected));
        card.classList.toggle('is-invalid', view.valid === false);
        card.textContent = `${view.roomName} ${view.name}`;

        const toolbar = this.document.createElement('div');
        toolbar.classList.add('ai-view-card-toolbar');
        toolbar.appendChild(button(this.document, '微调', 'edit', () => this.handlers.onEdit(view.id)));
        const trash = button(
            this.document,
            '',
            'delete',
            () => this.handlers.onDelete(view.id),
            { 'aria-label': `删除${view.name}` },
        );
        const icon = this.document.createElement('span');
        icon.textContent = '🗑';
        icon.setAttribute('aria-label', '垃圾桶');
        trash.appendChild(icon);
        toolbar.appendChild(trash);

        const activate = button(
            this.document,
            `${view.roomName} ${view.name}`,
            'activate',
            () => this.handlers.onActivate(view.id),
            { 'aria-current': active ? 'true' : 'false' },
        );
        activate.classList.add('ai-view-preview');

        const select = button(
            this.document,
            view.selected ? '已选' : '选择',
            'toggle-selected',
            () => this.handlers.onToggleSelected(view.id),
            { 'aria-pressed': String(Boolean(view.selected)) },
        );
        select.disabled = view.valid === false;

        card.appendChild(toolbar);
        card.appendChild(activate);
        card.appendChild(select);
        return card;
    }
}
