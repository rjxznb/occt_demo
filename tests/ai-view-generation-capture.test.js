import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { AiViewGenerationCapture } from '../src/ai-concept/AiViewGenerationCapture.js';
import { horizontalToVerticalFov } from '../src/core/CameraFov.js';

function recordingDependencies() {
    const events = [];
    const originalTarget = { name: 'visible-target' };
    const viewport = new THREE.Vector4(3, 4, 500, 280);
    const scissor = new THREE.Vector4(5, 6, 450, 240);
    const clearColor = new THREE.Color(0x123456);
    const renderer = {
        target: originalTarget,
        viewport: viewport.clone(),
        scissor: scissor.clone(),
        scissorTest: true,
        clearColor: clearColor.clone(),
        clearAlpha: 0.4,
        getRenderTarget() { return this.target; },
        setRenderTarget(value) { this.target = value; },
        getViewport(target) { return target.copy(this.viewport); },
        setViewport(value) { this.viewport.copy(value); },
        getScissor(target) { return target.copy(this.scissor); },
        setScissor(value) { this.scissor.copy(value); },
        getScissorTest() { return this.scissorTest; },
        setScissorTest(value) { this.scissorTest = value; },
        getClearColor(target) { return target.copy(this.clearColor); },
        setClearColor(value, alpha) { this.clearColor.copy(value); this.clearAlpha = alpha; },
        getClearAlpha() { return this.clearAlpha; },
        clear() { events.push(['clear']); },
        render(_scene, camera) {
            this.lastCamera = camera;
            events.push(['render', Math.round(camera.position.x)]);
        },
        readRenderTargetPixels(_target, _x, _y, width, height, pixels) {
            pixels.fill(127);
            events.push(['read', width, height]);
        },
    };
    let encoded = 0;
    const canvasFactory = () => ({
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData() {},
        }),
        toDataURL(type, quality) {
            events.push(['encode', type, quality, ++encoded, this.width, this.height]);
            return `data:${type};base64,capture-${encoded}`;
        },
    });
    return { renderer, events, originalTarget, viewport, scissor, clearColor, canvasFactory };
}

const viewA = { id: 'a', name: '客厅入口', x: 100, y: 200, z: 1500, yaw: 90, pitch: 10, fov: 90 };
const viewB = { id: 'b', name: '主卧床尾', x: 900, y: 300, z: 1450, yaw: 0, pitch: 0, fov: 80 };

test('captures stable high-resolution white-model inputs with a private Z-up camera', async () => {
    const deps = recordingDependencies();
    const capture = new AiViewGenerationCapture({
        scene: new THREE.Scene(), renderer: deps.renderer, canvasFactory: deps.canvasFactory,
    });

    const progress = [];
    const results = await capture.captureAll([viewA, viewB], {
        onProgress: value => progress.push(value),
    });

    assert.deepEqual(results.map(result => result.viewId), ['a', 'b']);
    assert.deepEqual(results.map(result => result.mimeType), ['image/webp', 'image/webp']);
    assert.deepEqual(results.map(result => result.dataUrl), [
        'data:image/webp;base64,capture-1',
        'data:image/webp;base64,capture-2',
    ]);
    assert.deepEqual(results.map(result => result.digestSource), ['capture-1', 'capture-2']);
    assert.deepEqual(deps.events.filter(event => event[0] === 'read'), [
        ['read', 1536, 1024], ['read', 1536, 1024],
    ]);
    assert.deepEqual(progress.map(value => [value.completed, value.total, value.viewId]), [
        [1, 2, 'a'], [2, 2, 'b'],
    ]);
    assert.equal(deps.renderer.lastCamera.up.z, 1);
    assert.equal(deps.renderer.lastCamera.aspect, 1.5);
    assert.ok(Math.abs(deps.renderer.lastCamera.fov - horizontalToVerticalFov(80, 1.5)) < 1e-8);
    assert.deepEqual(deps.events.filter(event => event[0] === 'encode').map(event => event.slice(1, 3)), [
        ['image/webp', 0.9], ['image/webp', 0.9],
    ]);
    capture.dispose();
});

test('restores renderer state after success and render failure', async () => {
    const deps = recordingDependencies();
    const capture = new AiViewGenerationCapture({
        scene: new THREE.Scene(), renderer: deps.renderer, canvasFactory: deps.canvasFactory,
    });

    await capture.capture(viewA);
    deps.renderer.readRenderTargetPixels = () => { throw new Error('READ_FAILED'); };
    await assert.rejects(capture.capture(viewB), /READ_FAILED/);

    assert.equal(deps.renderer.getRenderTarget(), deps.originalTarget);
    assert.deepEqual(deps.renderer.getViewport(new THREE.Vector4()).toArray(), deps.viewport.toArray());
    assert.deepEqual(deps.renderer.getScissor(new THREE.Vector4()).toArray(), deps.scissor.toArray());
    assert.equal(deps.renderer.getScissorTest(), true);
    assert.equal(deps.renderer.getClearColor(new THREE.Color()).getHex(), deps.clearColor.getHex());
    assert.equal(deps.renderer.getClearAlpha(), 0.4);
    capture.dispose();
});

test('aborts before capture and between ordered captureAll items', async () => {
    const deps = recordingDependencies();
    const capture = new AiViewGenerationCapture({
        scene: new THREE.Scene(), renderer: deps.renderer, canvasFactory: deps.canvasFactory,
    });
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await assert.rejects(capture.capture(viewA, { signal: alreadyAborted.signal }), error => error?.name === 'AbortError');

    const controller = new AbortController();
    await assert.rejects(capture.captureAll([viewA, viewB], {
        signal: controller.signal,
        onProgress: ({ completed }) => { if (completed === 1) controller.abort(); },
    }), error => error?.name === 'AbortError');
    assert.deepEqual(deps.events.filter(event => event[0] === 'render').map(event => event[1]), [100]);
    capture.dispose();
});
