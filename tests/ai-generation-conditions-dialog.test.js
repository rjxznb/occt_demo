import test from 'node:test';
import assert from 'node:assert/strict';

import { AiGenerationConditionsDialog } from '../src/ai-concept/AiGenerationConditionsDialog.js';
import { ENVIRONMENT_CATALOG, STYLE_CATALOG } from '../src/ai-concept/AiGenerationCatalog.js';
import { FakeDocument, FakeElement, descendants, findByDataset } from './helpers/fake-dom.js';

class EventTargetDouble {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    dispatch(type, event = {}) { this.listeners.get(type)?.({ type, ...event }); }
}

function createDialog({ onSubmit = () => {}, onCancel = () => {} } = {}) {
    const container = new FakeElement('section');
    const documentRef = new FakeDocument();
    const eventTarget = new EventTargetDouble();
    const dialog = new AiGenerationConditionsDialog(container, {
        documentRef, eventTarget, onSubmit, onCancel,
    });
    dialog.open({
        catalog: {
            styles: STYLE_CATALOG,
            environments: ENVIRONMENT_CATALOG,
            maxImagesPerJob: 24,
        },
        conditions: { styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'] },
        viewCount: 12,
    });
    return { container, dialog, eventTarget };
}

test('dialog renders eight visible reference styles then expands all twelve', () => {
    const { container } = createDialog();
    const styleCards = descendants(container).filter(element => element.dataset.styleId);
    assert.equal(styleCards.length, 12);
    assert.equal(styleCards.filter(card => !card.hidden).length, 8);
    const firstImage = descendants(styleCards[0]).find(element => element.tagName === 'IMG');
    assert.equal(firstImage.getAttribute('src'), './assets/ai-styles/modern-minimalist.png');
    assert.equal(firstImage.getAttribute('alt'), '现代简约室内风格示意图');

    findByDataset(container, 'action', 'expand-styles').click();
    assert.equal(styleCards.filter(card => !card.hidden).length, 12);
});

test('dialog toggles style and environment selections and reports the matrix count', () => {
    const { container } = createDialog();
    findByDataset(container, 'styleId', 'fresh-cream').click();
    findByDataset(container, 'environmentId', 'night-ambience').click();
    const count = findByDataset(container, 'role', 'generation-count');
    assert.match(count.textContent, /12 个视角 × 2 种风格 × 2 种环境/);
    assert.match(count.textContent, /预计 48 张/);
    assert.equal(findByDataset(container, 'action', 'submit').disabled, true);
    assert.match(findByDataset(container, 'role', 'validation').textContent, /最多生成 24 张/);
});

test('dialog submits normalized choices once and locks dismissal while submitting', () => {
    const submissions = [];
    const cancellations = [];
    const { container, dialog, eventTarget } = createDialog({
        onSubmit: conditions => submissions.push(conditions),
        onCancel: () => cancellations.push(true),
    });
    findByDataset(container, 'action', 'submit').click();
    assert.deepEqual(submissions, [{
        styleIds: ['modern-minimalist'], environmentIds: ['sunny-day'],
    }]);
    dialog.setSubmitting(true);
    findByDataset(container, 'action', 'cancel').click();
    eventTarget.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(cancellations, []);
    assert.equal(findByDataset(container, 'action', 'submit').disabled, true);
});

test('dialog supports cancellation and stable image fallback before disposal', () => {
    const cancellations = [];
    const { container, dialog, eventTarget } = createDialog({ onCancel: () => cancellations.push(true) });
    const image = descendants(findByDataset(container, 'styleId', 'modern-minimalist'))
        .find(element => element.tagName === 'IMG');
    image.dispatch('error');
    assert.equal(image.parentNode.classList.contains('has-image-error'), true);
    eventTarget.dispatch('keydown', { key: 'Escape' });
    assert.deepEqual(cancellations, [true]);
    assert.equal(container.hidden, true);
    dialog.dispose();
    assert.equal(eventTarget.listeners.size, 0);
});
