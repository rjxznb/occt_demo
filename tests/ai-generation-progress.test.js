import assert from 'node:assert/strict';
import test from 'node:test';

import { AiGenerationProgress } from '../src/ai-concept/AiGenerationProgress.js';
import { FakeDocument, FakeElement, descendants, findByDataset } from './helpers/fake-dom.js';

const job = {
    id: 'job-1',
    status: 'running',
    items: [
        {
            id: 'queued', status: 'queued', styleId: 'modern-minimalist', environmentId: 'sunny-day',
            view: { roomName: '客厅', name: '入口视角' }, input: { url: '/input-1.webp' },
        },
        {
            id: 'running', status: 'running', styleId: 'fresh-cream', environmentId: 'overcast-soft',
            view: { roomName: '主卧', name: '主墙构图' }, input: { url: '/input-2.webp' },
        },
        {
            id: 'completed', status: 'completed', styleId: 'natural-wood', environmentId: 'warm-dusk',
            view: { roomName: '书房', name: '窗边视角' }, input: { url: '/input-3.webp' }, output: { url: '/output-3.png' },
        },
        {
            id: 'failed', status: 'failed', styleId: 'nordic-fresh', environmentId: 'night-ambience',
            view: { roomName: '厨房', name: '操作台视角' }, input: { url: '/input-4.webp' }, error: { code: 'RATE_LIMIT', retryable: true },
        },
        {
            id: 'cancelled', status: 'cancelled', styleId: 'industrial', environmentId: 'sunny-day',
            view: { roomName: '阳台', name: '外窗视角' }, input: { url: '/input-5.webp' },
        },
    ],
};

test('progress renders exact task labels, metadata, total count, and white-model/result comparison', () => {
    const documentRef = new FakeDocument();
    const container = new FakeElement('section');
    const progress = new AiGenerationProgress(container, { documentRef });
    progress.render({ status: 'ready', job });

    const text = descendants(container).map(element => element.textContent).filter(Boolean).join('|');
    for (const label of ['等待生成', '生成中', '已完成', '生成失败', '已取消']) assert.match(text, new RegExp(label));
    assert.match(text, /已完成 1 \/ 5/);
    for (const metadata of ['客厅', '入口视角', '现代简约', '晴天日间']) assert.match(text, new RegExp(metadata));

    const completed = findByDataset(container, 'itemId', 'completed');
    const images = descendants(completed).filter(element => element.tagName === 'IMG');
    assert.deepEqual(images.map(image => image.getAttribute('src')), ['/input-3.webp', '/output-3.png']);
    assert.match(descendants(completed).map(element => element.textContent).join('|'), /方向示意图/);
});

test('progress exposes retry only for retryable failed items and cancel only for nonterminal jobs', () => {
    const calls = [];
    const documentRef = new FakeDocument();
    const container = new FakeElement('section');
    const progress = new AiGenerationProgress(container, {
        documentRef,
        onRetry: id => calls.push(['retry', id]),
        onCancel: () => calls.push(['cancel']),
    });
    progress.render({ status: 'ready', job });

    const retryButtons = descendants(container).filter(element => element.dataset.action === 'retry');
    const cancelButtons = descendants(container).filter(element => element.dataset.action === 'cancel');
    assert.equal(retryButtons.length, 1);
    assert.equal(cancelButtons.length, 1);
    retryButtons[0].click();
    cancelButtons[0].click();
    assert.deepEqual(calls, [['retry', 'failed'], ['cancel']]);

    progress.render({ status: 'ready', job: { ...job, status: 'completed' } });
    assert.equal(descendants(container).filter(element => element.dataset.action === 'cancel').length, 0);
});
