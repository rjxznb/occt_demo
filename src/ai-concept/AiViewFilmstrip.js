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

function groupByRoom(views) {
    const groups = [];
    const byId = new Map();
    for (const view of views) {
        let group = byId.get(view.roomId);
        if (!group) {
            group = { id: view.roomId, name: view.roomName || '未命名房间', views: [] };
            byId.set(view.roomId, group);
            groups.push(group);
        }
        group.views.push(view);
    }
    return groups;
}

export class AiViewFilmstrip {
    constructor(container, {
        documentRef = globalThis.document,
        onActivate = () => {},
        onEdit = () => {},
        onDelete = () => {},
        onRestore = () => {},
        onAdd = () => {},
        onRetryThumbnail = () => {},
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.handlers = {
            onActivate, onEdit, onDelete, onRestore, onAdd, onRetryThumbnail,
        };
    }

    render({ views = [], activeViewId = null, thumbnails = new Map() } = {}) {
        if (!this.container || !this.document) return;
        const previousTrack = Array.from(this.container.children ?? [])
            .find(element => element.classList?.contains('ai-view-track'));
        const previousScrollLeft = Number(previousTrack?.scrollLeft) || 0;
        const visible = views.filter(view => !['excluded', 'disabled'].includes(view.status));
        const track = this.document.createElement('div');
        track.classList.add('ai-view-track');
        for (const group of groupByRoom(visible)) {
            const room = this.document.createElement('section');
            room.classList.add('ai-view-room-group');
            room.dataset.roomGroupId = group.id;
            const title = this.document.createElement('strong');
            title.classList.add('ai-view-room-title');
            title.textContent = group.name;
            const cards = this.document.createElement('div');
            cards.classList.add('ai-view-room-cards');
            for (const view of group.views) {
                cards.appendChild(this._card(view, view.id === activeViewId, thumbnails.get(view.id)));
            }
            room.appendChild(title);
            room.appendChild(cards);
            track.appendChild(room);
        }

        const add = button(this.document, '＋ 添加自定义视角', 'add', this.handlers.onAdd);
        add.classList.add('ai-view-add');
        track.appendChild(add);

        const footer = this.document.createElement('div');
        footer.classList.add('ai-filmstrip-footer');
        if (views.some(view => view.status === 'excluded')) {
            footer.appendChild(button(this.document, '恢复已排除视角', 'restore', this.handlers.onRestore));
        }
        track.scrollLeft = previousScrollLeft;
        this.container.replaceChildren(track, footer);
    }

    _thumbnail(view, thumbnail) {
        const preview = this.document.createElement('div');
        preview.classList.add('ai-view-thumbnail');
        const status = thumbnail?.status === 'ready' && thumbnail.url
            ? 'ready'
            : thumbnail?.status === 'error' ? 'error' : 'loading';
        if (status === 'ready') {
            const image = this.document.createElement('img');
            image.setAttribute('src', thumbnail.url);
            image.setAttribute('alt', `${view.roomName} ${view.name}`);
            image.setAttribute('loading', 'lazy');
            image.setAttribute('decoding', 'async');
            preview.appendChild(image);
        } else if (status === 'error') {
            const retry = button(
                this.document,
                '重新生成',
                'retry-thumbnail',
                () => this.handlers.onRetryThumbnail(view.id),
                { 'aria-label': `重新生成${view.name}缩略图` },
            );
            preview.appendChild(retry);
        } else {
            preview.setAttribute('role', 'status');
            preview.setAttribute('aria-label', `${view.name}缩略图生成中`);
        }
        return { preview, status };
    }

    _card(view, active, thumbnail) {
        const card = this.document.createElement('article');
        card.dataset.viewId = view.id;
        card.classList.add('ai-view-card');
        card.classList.toggle('is-active', active);
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

        const { preview, status } = this._thumbnail(view, thumbnail);
        card.dataset.thumbnailState = status;
        const activate = button(
            this.document,
            `${view.roomName} ${view.name}`,
            'activate',
            () => this.handlers.onActivate(view.id),
            { 'aria-current': active ? 'true' : 'false' },
        );
        activate.classList.add('ai-view-preview');
        activate.appendChild(preview);

        card.appendChild(toolbar);
        card.appendChild(activate);
        return card;
    }

    scrollViewIntoView(viewId) {
        const track = Array.from(this.container?.children ?? [])
            .find(element => element.classList?.contains('ai-view-track'));
        if (!track) return;

        const card = Array.from(track.children ?? [])
            .flatMap(child => Array.from(child.children ?? []))
            .flatMap(child => Array.from(child.children ?? []))
            .find(element => element.dataset?.viewId === viewId);
        if (!card || typeof track.scrollTo !== 'function') return;

        const trackRect = track.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const currentLeft = Number(track.scrollLeft) || 0;
        const centeredLeft = currentLeft
            + cardRect.left + cardRect.width / 2
            - (trackRect.left + trackRect.width / 2);
        const maximumLeft = Math.max(
            0,
            (Number(track.scrollWidth) || 0) - (Number(track.clientWidth) || trackRect.width),
        );
        const left = Math.min(maximumLeft, Math.max(0, centeredLeft));

        track.scrollTo({ left, behavior: 'smooth' });
    }
}
