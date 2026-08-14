import {
    MAX_IMAGES_PER_JOB,
    normalizeGenerationConditions,
    validateGenerationConditions,
} from './AiGenerationCatalog.js';

function element(documentRef, tagName, className, text = '') {
    const node = documentRef.createElement(tagName);
    if (className) node.classList.add(...className.split(/\s+/).filter(Boolean));
    node.textContent = text;
    return node;
}

function button(documentRef, className, text, action) {
    const node = element(documentRef, 'button', className, text);
    node.type = 'button';
    node.dataset.action = action;
    return node;
}

const VALIDATION_MESSAGES = Object.freeze({
    NO_VIEWS: '当前没有可以参与生成的合法视角。',
    NO_STYLES: '请至少选择一种设计风格。',
    NO_ENVIRONMENTS: '请至少选择一种光照环境。',
    TOO_MANY_IMAGES: '单次最多生成 24 张，请减少风格或环境。',
});

export class AiGenerationConditionsDialog {
    constructor(container, {
        documentRef = globalThis.document,
        eventTarget = globalThis.window,
        onSubmit = () => {},
        onCancel = () => {},
    } = {}) {
        this.container = container;
        this.document = documentRef;
        this.eventTarget = eventTarget;
        this.onSubmit = onSubmit;
        this.onCancel = onCancel;
        this.opened = false;
        this.expanded = false;
        this.submitting = false;
        this.viewCount = 0;
        this.maxImages = MAX_IMAGES_PER_JOB;
        this.catalog = { styles: [], environments: [] };
        this.conditions = { styleIds: [], environmentIds: [] };
        this.styleCards = new Map();
        this.environmentButtons = new Map();
        this.ui = {};
        this.keydown = event => {
            if (event?.key === 'Escape') this._requestCancel();
        };
        this.eventTarget?.addEventListener?.('keydown', this.keydown);
    }

    open({ catalog = {}, conditions = {}, viewCount = 0 } = {}) {
        this.catalog = {
            styles: Array.isArray(catalog.styles) ? catalog.styles : [],
            environments: Array.isArray(catalog.environments) ? catalog.environments : [],
        };
        this.maxImages = Math.max(1, Math.floor(Number(catalog.maxImagesPerJob) || MAX_IMAGES_PER_JOB));
        this.conditions = normalizeGenerationConditions(conditions, this.catalog);
        this.viewCount = Math.max(0, Math.floor(Number(viewCount) || 0));
        this.opened = true;
        this.expanded = false;
        this.submitting = false;
        this._render();
        this.container.hidden = false;
        this.container.setAttribute?.('aria-hidden', 'false');
        return true;
    }

    close() {
        this.opened = false;
        this.container.hidden = true;
        this.container.setAttribute?.('aria-hidden', 'true');
    }

    setSubmitting(value) {
        this.submitting = Boolean(value);
        this._updateState();
    }

    showError(message) {
        if (!this.ui.error) return;
        this.ui.error.textContent = String(message ?? '提交失败，请稍后重试。');
        this.ui.error.hidden = false;
    }

    _render() {
        this.styleCards.clear();
        this.environmentButtons.clear();
        const panel = element(this.document, 'div', 'ai-generation-dialog-panel');
        panel.setAttribute('role', 'document');

        const header = element(this.document, 'header', 'ai-generation-dialog-header');
        const heading = element(this.document, 'div', 'ai-generation-dialog-heading');
        const title = element(this.document, 'h2', '', '设置生图条件');
        title.id = 'ai-generation-dialog-title';
        heading.appendChild(title);
        heading.appendChild(element(
            this.document,
            'p',
            '',
            `当前 ${this.viewCount} 个有效视角将参与生成`,
        ));
        const closeButton = button(this.document, 'ai-generation-dialog-close', '×', 'close');
        closeButton.setAttribute('aria-label', '关闭生图条件');
        closeButton.addEventListener('click', () => this._requestCancel());
        header.appendChild(heading);
        header.appendChild(closeButton);

        const styleSection = element(this.document, 'section', 'ai-generation-section');
        styleSection.appendChild(element(this.document, 'h3', '', '设计风格（可多选）'));
        const styleGrid = element(this.document, 'div', 'ai-generation-style-grid');
        for (const [index, style] of this.catalog.styles.entries()) {
            const card = button(this.document, 'ai-generation-style-card', '', 'toggle-style');
            card.dataset.styleId = style.id;
            card.hidden = index >= 8;
            const imageWrap = element(this.document, 'span', 'ai-generation-style-image');
            const image = this.document.createElement('img');
            image.setAttribute('src', style.imageUrl);
            image.setAttribute('alt', `${style.name}室内风格示意图`);
            image.setAttribute('loading', 'lazy');
            image.setAttribute('decoding', 'async');
            image.addEventListener('error', () => imageWrap.classList.add('has-image-error'));
            const check = element(this.document, 'span', 'ai-generation-style-check', '✓');
            check.setAttribute('aria-hidden', 'true');
            imageWrap.appendChild(image);
            imageWrap.appendChild(check);
            const copy = element(this.document, 'span', 'ai-generation-style-copy');
            copy.appendChild(element(this.document, 'strong', '', style.name));
            copy.appendChild(element(this.document, 'small', '', style.description));
            card.appendChild(imageWrap);
            card.appendChild(copy);
            card.addEventListener('click', () => this._toggle('styleIds', style.id));
            this.styleCards.set(style.id, card);
            styleGrid.appendChild(card);
        }
        styleSection.appendChild(styleGrid);
        const expand = button(this.document, 'ai-generation-expand', '展开更多风格', 'expand-styles');
        expand.hidden = this.catalog.styles.length <= 8;
        expand.addEventListener('click', () => {
            this.expanded = !this.expanded;
            for (const [index, card] of [...this.styleCards.values()].entries()) {
                card.hidden = !this.expanded && index >= 8;
            }
            expand.textContent = this.expanded ? '收起更多风格' : '展开更多风格';
        });
        styleSection.appendChild(expand);

        const environmentSection = element(this.document, 'section', 'ai-generation-section');
        environmentSection.appendChild(element(this.document, 'h3', '', '光照环境（可多选）'));
        const environments = element(this.document, 'div', 'ai-generation-environments');
        for (const environment of this.catalog.environments) {
            const option = button(this.document, 'ai-generation-environment', environment.name, 'toggle-environment');
            option.dataset.environmentId = environment.id;
            option.title = environment.description;
            option.addEventListener('click', () => this._toggle('environmentIds', environment.id));
            this.environmentButtons.set(environment.id, option);
            environments.appendChild(option);
        }
        environmentSection.appendChild(environments);

        const footer = element(this.document, 'footer', 'ai-generation-dialog-footer');
        const summary = element(this.document, 'div', 'ai-generation-summary');
        const count = element(this.document, 'strong', 'ai-generation-count');
        count.dataset.role = 'generation-count';
        const validation = element(this.document, 'span', 'ai-generation-validation');
        validation.dataset.role = 'validation';
        const error = element(this.document, 'span', 'ai-generation-submit-error');
        error.setAttribute('role', 'alert');
        error.hidden = true;
        summary.appendChild(count);
        summary.appendChild(validation);
        summary.appendChild(error);
        const actions = element(this.document, 'div', 'ai-generation-actions');
        const cancel = button(this.document, 'ai-button', '取消', 'cancel');
        cancel.addEventListener('click', () => this._requestCancel());
        const submit = button(this.document, 'ai-button ai-button-primary', '确认并生成', 'submit');
        submit.addEventListener('click', () => {
            if (submit.disabled || this.submitting) return;
            this.onSubmit({
                styleIds: [...this.conditions.styleIds],
                environmentIds: [...this.conditions.environmentIds],
            });
        });
        actions.appendChild(cancel);
        actions.appendChild(submit);
        footer.appendChild(summary);
        footer.appendChild(actions);

        panel.appendChild(header);
        panel.appendChild(styleSection);
        panel.appendChild(environmentSection);
        panel.appendChild(footer);
        this.container.replaceChildren(panel);
        this.ui = { closeButton, expand, count, validation, error, cancel, submit };
        this._updateState();
    }

    _toggle(field, id) {
        if (this.submitting) return;
        const values = this.conditions[field];
        this.conditions = {
            ...this.conditions,
            [field]: values.includes(id) ? values.filter(value => value !== id) : [...values, id],
        };
        this._updateState();
    }

    _updateState() {
        const validation = validateGenerationConditions({
            viewCount: this.viewCount,
            ...this.conditions,
            maxImages: this.maxImages,
        });
        for (const [id, card] of this.styleCards) {
            const selected = this.conditions.styleIds.includes(id);
            card.classList.toggle('is-selected', selected);
            card.setAttribute('aria-pressed', String(selected));
        }
        for (const [id, option] of this.environmentButtons) {
            const selected = this.conditions.environmentIds.includes(id);
            option.classList.toggle('is-selected', selected);
            option.setAttribute('aria-pressed', String(selected));
        }
        if (!this.ui.count) return;
        this.ui.count.textContent = `${this.viewCount} 个视角 × ${this.conditions.styleIds.length}`
            + ` 种风格 × ${this.conditions.environmentIds.length} 种环境 = 预计 ${validation.count} 张`;
        this.ui.validation.textContent = validation.valid ? '' : VALIDATION_MESSAGES[validation.code] ?? '当前条件不可提交。';
        this.ui.submit.disabled = this.submitting || !validation.valid;
        this.ui.submit.textContent = this.submitting ? '正在提交…' : '确认并生成';
        this.ui.cancel.disabled = this.submitting;
        this.ui.closeButton.disabled = this.submitting;
    }

    _requestCancel() {
        if (!this.opened || this.submitting) return false;
        this.close();
        this.onCancel();
        return true;
    }

    dispose() {
        this.eventTarget?.removeEventListener?.('keydown', this.keydown);
        this.close();
        this.styleCards.clear();
        this.environmentButtons.clear();
    }
}
