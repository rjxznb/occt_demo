import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index-panorama.html', import.meta.url);
const cssUrl = new URL('../src/panorama/panorama.css', import.meta.url);

test('standalone panorama page exposes the complete browse, edit, and recovery surface', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    const requiredIds = [
        'panorama-app', 'panorama-canvas',
        'panorama-minimap', 'panorama-hotspots',
        'panorama-primary-actions', 'panorama-edit-toggle', 'panorama-submit-render',
        'panorama-browse-controls', 'panorama-edit-controls',
        'panorama-loading', 'panorama-empty', 'panorama-error',
        'panorama-retry', 'panorama-toast',
    ];

    for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), id);
    assert.match(html, /type="module"\s+src="\.\/src\/PanoramaApp\.js"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="全景点位小地图"/);
    assert.match(html, /data-height-preset="child"/);
    assert.match(html, /data-height-preset="standard"/);
    assert.match(html, /data-height-preset="high"/);
    assert.doesNotMatch(html, /id=["']panorama-topbar["']/);
    assert.match(html, />\s*位置微调\s*</);
    assert.match(html, />\s*提交渲染\s*</);
    assert.doesNotMatch(html, /生成全景图/);
    for (const removedId of [
        'panorama-point-panel', 'panorama-point-count', 'panorama-point-panel-toggle',
        'panorama-point-list', 'panorama-add-point', 'panorama-restore-all',
    ]) {
        assert.doesNotMatch(html, new RegExp(`id=["']${removedId}["']`), removedId);
    }
});

test('panorama page does not expose the legacy model and material editor controls', async () => {
    const html = await readFile(htmlUrl, 'utf8');

    for (const forbiddenId of [
        'resource-toggle', 'material-toggle', 'template-toggle',
        'model-create', 'view-angle-group', 'material-upload-modal',
    ]) {
        assert.doesNotMatch(html, new RegExp(`id=["']${forbiddenId}["']`), forbiddenId);
    }
    assert.doesNotMatch(html, /编辑快捷键/);
});

test('panorama styles provide glass fallback, keyboard focus, motion preference, and narrow-screen layout', async () => {
    const css = await readFile(cssUrl, 'utf8');

    assert.match(css, /backdrop-filter:\s*blur\(/);
    assert.match(css, /@supports\s+not\s+\(backdrop-filter:/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media\s+\(max-width:\s*760px\)/);
    assert.match(css, /@media\s+\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /\.panorama-editing/);
    assert.match(css, /\.is-offscreen/);
    assert.match(css, /\.panorama-minimap\s*\{[\s\S]*?right:\s*16px/);
    assert.match(css, /\.panorama-primary-actions\s*\{[\s\S]*?right:\s*16px[\s\S]*?bottom:/);
    assert.match(css, /\.panorama-app::after/);
    assert.match(css, /\.panorama-editing\s+\.panorama-app::after[\s\S]*?opacity:\s*1/);
    assert.match(css, /inset\s+0\s+0\s+32px[\s\S]*?rgba\(79,\s*139,\s*188,\s*0\.22\)/);
    assert.match(
        css,
        /\.panorama-editing\s+\.panorama-edit-dock\s*\{[\s\S]*?right:\s*232px[\s\S]*?width:\s*min\(760px,\s*calc\(100%\s*-\s*248px\)\)/,
    );
    assert.match(
        css,
        /@media\s+\(max-width:\s*760px\)[\s\S]*?\.panorama-editing\s+\.panorama-primary-actions\s*\{[\s\S]*?bottom:\s*max\(76px/,
    );
});

test('loading and empty states conceal the orbit camera before a panorama point is active', async () => {
    const css = await readFile(cssUrl, 'utf8');

    assert.match(
        css,
        /\.panorama-app\[data-state="loading"\][\s\S]*?\.panorama-canvas[\s\S]*?opacity:\s*0/,
    );
    assert.match(
        css,
        /\.panorama-app\[data-state="empty"\][\s\S]*?\.panorama-canvas[\s\S]*?opacity:\s*0/,
    );
});
