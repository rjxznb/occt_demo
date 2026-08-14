import { ENVIRONMENT_CATALOG, STYLE_CATALOG } from './AiGenerationCatalog.js';

const ITEM_LABELS = Object.freeze({
    queued: '等待生成',
    running: '生成中',
    completed: '已完成',
    failed: '生成失败',
    cancelled: '已取消',
    interrupted: '等待重试',
});
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

function element(documentRef, tag, className = '', text = '') {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function catalogName(catalog, id) {
    return catalog.find(item => item.id === id)?.name ?? String(id ?? '--');
}

function image(documentRef, src, alt, className) {
    const node = element(documentRef, 'img', className);
    node.setAttribute('src', src);
    node.setAttribute('alt', alt);
    node.loading = 'lazy';
    return node;
}

export class AiGenerationProgress {
    constructor(container, {
        documentRef = globalThis.document,
        onRetry = () => {},
        onCancel = () => {},
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.onRetry = onRetry;
        this.onCancel = onCancel;
    }

    render(state = {}) {
        if (!this.container) return;
        this.container.replaceChildren();
        const job = state.job;
        if (!job) {
            this.container.appendChild(element(
                this.document,
                'p',
                'ai-generation-progress-empty',
                state.status === 'error' ? `任务加载失败：${state.error ?? 'UNKNOWN_ERROR'}` : '正在加载生成任务…',
            ));
            return;
        }

        const items = Array.isArray(job.items) ? job.items : [];
        const completed = items.filter(item => item.status === 'completed').length;
        const header = element(this.document, 'header', 'ai-generation-progress-header');
        const copy = element(this.document, 'div', 'ai-generation-progress-heading');
        copy.appendChild(element(this.document, 'h2', '', '局部示意图生成'));
        copy.appendChild(element(this.document, 'p', '', `已完成 ${completed} / ${items.length}`));
        header.appendChild(copy);
        if (!TERMINAL_STATUSES.has(job.status)) {
            const cancel = element(this.document, 'button', 'ai-button ai-button-secondary', '取消任务');
            cancel.type = 'button';
            cancel.dataset.action = 'cancel';
            cancel.addEventListener('click', () => this.onCancel());
            header.appendChild(cancel);
        }
        this.container.appendChild(header);

        const grid = element(this.document, 'div', 'ai-generation-progress-grid');
        for (const item of items) grid.appendChild(this._renderItem(item));
        this.container.appendChild(grid);
    }

    _renderItem(item) {
        const card = element(this.document, 'article', `ai-generation-result-card is-${item.status ?? 'queued'}`);
        card.dataset.itemId = String(item.id ?? '');
        const heading = element(this.document, 'header', 'ai-generation-result-heading');
        heading.appendChild(element(this.document, 'strong', '', `${item.view?.roomName ?? '--'} · ${item.view?.name ?? '--'}`));
        heading.appendChild(element(this.document, 'span', 'ai-generation-result-status', ITEM_LABELS[item.status] ?? '未知状态'));
        card.appendChild(heading);
        card.appendChild(element(
            this.document,
            'p',
            'ai-generation-result-meta',
            `${catalogName(STYLE_CATALOG, item.styleId)} · ${catalogName(ENVIRONMENT_CATALOG, item.environmentId)}`,
        ));

        const comparison = element(this.document, 'div', 'ai-generation-comparison');
        const input = element(this.document, 'figure', 'ai-generation-comparison-pane');
        input.appendChild(image(this.document, item.input?.url ?? '', '输入白模', 'ai-generation-comparison-image'));
        input.appendChild(element(this.document, 'figcaption', '', '输入白模'));
        comparison.appendChild(input);
        if (item.status === 'completed' && item.output?.url) {
            const output = element(this.document, 'figure', 'ai-generation-comparison-pane');
            output.appendChild(image(this.document, item.output.url, '方向示意图', 'ai-generation-comparison-image'));
            output.appendChild(element(this.document, 'figcaption', '', '方向示意图'));
            comparison.appendChild(output);
        }
        card.appendChild(comparison);

        if (item.status === 'failed') {
            card.appendChild(element(
                this.document,
                'p',
                'ai-generation-result-error',
                `生成失败：${item.error?.code ?? 'IMAGE_GENERATION_FAILED'}`,
            ));
            if (item.error?.retryable === true) {
                const retry = element(this.document, 'button', 'ai-button ai-button-secondary', '重试该图');
                retry.type = 'button';
                retry.dataset.action = 'retry';
                retry.addEventListener('click', () => this.onRetry(item.id));
                card.appendChild(retry);
            }
        }
        return card;
    }
}
