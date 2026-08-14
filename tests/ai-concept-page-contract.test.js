import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index-ai-concept.html', import.meta.url);
const cssUrl = new URL('../src/ai-concept/ai-concept.css', import.meta.url);

test('AI concept page exposes the candidate workbench without a panorama-style title block', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    const requiredIds = [
        'ai-concept-app', 'ai-concept-canvas', 'ai-concept-status',
        'ai-concept-previous', 'ai-concept-next', 'ai-concept-filmstrip',
        'ai-concept-minimap',
        'ai-concept-continue',
        'ai-concept-edit-controls', 'ai-concept-edit-cancel', 'ai-concept-edit-save',
        'ai-concept-height-down', 'ai-concept-height-value', 'ai-concept-height-up',
        'ai-concept-loading', 'ai-concept-empty', 'ai-concept-error',
        'ai-concept-retry', 'ai-concept-toast', 'ai-concept-conditions',
    ];
    for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), id);
    assert.doesNotMatch(html, /id=["']ai-concept-selection-count["']/);
    assert.match(html, /type="module"\s+src="\.\/src\/AiConceptApp\.js"/);
    assert.doesNotMatch(html, /AI方向示意图|AI 方向示意图/);
    assert.doesNotMatch(html, />\s*位置微调\s*</);
    assert.match(html, />\s*下一步：生图条件\s*</);
    assert.match(html, /aria-live="polite"/);
});

test('AI concept styles provide blue liquid glass, editing glow, motion fallback, and narrow layout', async () => {
    const css = await readFile(cssUrl, 'utf8');
    assert.match(css, /backdrop-filter:\s*blur\(/);
    assert.match(css, /@supports\s+not\s+\(backdrop-filter:/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /\.ai-concept-editing\s+\.ai-concept-app::after[\s\S]*?opacity:\s*1/);
    assert.match(css, /rgba\(79,\s*139,\s*188,\s*0\.22\)/);
    assert.match(css, /@media\s+\(max-width:\s*760px\)/);
    assert.match(css, /@media\s+\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /\.ai-view-minimap\s*\{[\s\S]*?position:\s*absolute[\s\S]*?top:[\s\S]*?right:/);
    assert.match(css, /\.ai-view-room-group\s*\{/);
    assert.match(css, /\.ai-view-thumbnail\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(css, /\.ai-view-thumbnail\s+img\s*\{[\s\S]*?object-fit:\s*cover/);
    assert.match(css, /\.ai-view-card\[data-thumbnail-state="loading"\]/);
    assert.match(css, /\.ai-view-card\[data-thumbnail-state="error"\]/);
    assert.match(css, /\.ai-view-map-point\.is-active/);
    assert.match(css, /\.ai-view-minimap-room\s*\{[\s\S]*?stroke-width:\s*1\.4/);
    assert.doesNotMatch(css, /\.ai-view-map-direction/);
    assert.doesNotMatch(css, /\.ai-view-card\.is-selected|toggle-selected/);
});
