import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index-panorama.html', import.meta.url);
const cssUrl = new URL('../src/panorama/panorama.css', import.meta.url);

test('standalone panorama page exposes the complete browse, edit, and recovery surface', async () => {
    const html = await readFile(htmlUrl, 'utf8');
    const requiredIds = [
        'panorama-app', 'panorama-canvas', 'panorama-topbar',
        'panorama-minimap', 'panorama-point-list', 'panorama-hotspots',
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
