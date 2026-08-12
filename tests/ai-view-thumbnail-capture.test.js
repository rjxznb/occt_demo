import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { AiViewThumbnailCapture } from '../src/ai-concept/AiViewThumbnailCapture.js';
import { horizontalToVerticalFov } from '../src/core/CameraFov.js';

function recordingDependencies() {
    const events = [];
    const originalTarget = { name: 'screen-target' };
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
        setRenderTarget(value) { this.target = value; events.push(['target', value]); },
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
    let blobCounter = 0;
    const canvasFactory = () => ({
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData() {},
        }),
        toBlob(callback) {
            events.push(['encode-start', renderer.target]);
            setTimeout(() => {
                events.push(['encoded', ++blobCounter]);
                callback(new Blob([String(blobCounter)], { type: 'image/webp' }));
            }, 0);
        },
    });
    const revoked = [];
    const urlApi = {
        createObjectURL: blob => `blob:${blob.size}:${blobCounter}`,
        revokeObjectURL: url => revoked.push(url),
    };
    return { renderer, events, originalTarget, viewport, scissor, clearColor, canvasFactory, urlApi, revoked };
}

const viewA = { id: 'a', x: 100, y: 200, z: 1500, yaw: 90, pitch: 10, fov: 90 };
const viewB = { id: 'b', x: 900, y: 300, z: 1450, yaw: 0, pitch: 0, fov: 80 };

test('captures serial white-model thumbnails with a private Z-up camera and pose cache', async () => {
    const deps = recordingDependencies();
    const capture = new AiViewThumbnailCapture({
        scene: new THREE.Scene(), renderer: deps.renderer, width: 320, height: 180,
        canvasFactory: deps.canvasFactory, urlApi: deps.urlApi,
    });

    const [first, second] = await Promise.all([capture.capture(viewA), capture.capture(viewB)]);
    const cached = await capture.capture(viewA);

    assert.equal(first.status, 'ready');
    assert.equal(second.status, 'ready');
    assert.equal(cached.url, first.url);
    assert.equal(deps.events.filter(event => event[0] === 'render').length, 2);
    assert.deepEqual(deps.events.filter(event => ['render', 'encoded'].includes(event[0])), [
        ['render', 100], ['encoded', 1], ['render', 900], ['encoded', 2],
    ]);
    assert.equal(
        deps.events.find(event => event[0] === 'encode-start')[1],
        deps.originalTarget,
        'the visible render target is restored before asynchronous image encoding',
    );
    assert.equal(deps.renderer.lastCamera.up.z, 1);
    assert.equal(deps.renderer.lastCamera.aspect, 16 / 9);
    assert.ok(Math.abs(deps.renderer.lastCamera.fov - horizontalToVerticalFov(80, 16 / 9)) < 1e-8);

    capture.invalidate(viewA.id);
    const moved = await capture.capture({ ...viewA, x: 150 });
    assert.notEqual(moved.url, first.url);
    assert.ok(deps.revoked.includes(first.url));
    capture.dispose();
    assert.ok(deps.revoked.includes(second.url));
    assert.ok(deps.revoked.includes(moved.url));
});

test('restores every renderer state after a capture failure', async () => {
    const deps = recordingDependencies();
    deps.renderer.readRenderTargetPixels = () => { throw new Error('READ_FAILED'); };
    const capture = new AiViewThumbnailCapture({
        scene: new THREE.Scene(), renderer: deps.renderer,
        canvasFactory: deps.canvasFactory, urlApi: deps.urlApi,
    });

    await assert.rejects(capture.capture(viewA), /READ_FAILED/);

    assert.equal(deps.renderer.getRenderTarget(), deps.originalTarget);
    assert.deepEqual(deps.renderer.getViewport(new THREE.Vector4()).toArray(), deps.viewport.toArray());
    assert.deepEqual(deps.renderer.getScissor(new THREE.Vector4()).toArray(), deps.scissor.toArray());
    assert.equal(deps.renderer.getScissorTest(), true);
    assert.equal(deps.renderer.getClearColor(new THREE.Color()).getHex(), deps.clearColor.getHex());
    assert.equal(deps.renderer.getClearAlpha(), 0.4);
    capture.dispose();
});
