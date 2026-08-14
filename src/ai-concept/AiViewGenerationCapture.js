import * as THREE from 'three';
import { clampPanoramaHorizontalFov, horizontalToVerticalFov } from '../core/CameraFov.js';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function abortError() {
    const error = new Error('AI_GENERATION_CAPTURE_ABORTED');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function pixelsToCanvas(pixels, width, height, canvasFactory) {
    const canvas = canvasFactory();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext?.('2d', { alpha: false });
    if (!context) throw new Error('AI_GENERATION_CAPTURE_CANVAS_UNAVAILABLE');
    const imageData = context.createImageData(width, height);
    const rowBytes = width * 4;
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
        const targetY = height - sourceY - 1;
        const sourceStart = sourceY * rowBytes;
        imageData.data.set(pixels.subarray(sourceStart, sourceStart + rowBytes), targetY * rowBytes);
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
}

function encodeWebp(canvas) {
    const dataUrl = canvas.toDataURL?.('image/webp', 0.9);
    const prefix = 'data:image/webp;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length <= prefix.length) {
        throw new Error('AI_GENERATION_CAPTURE_ENCODE_FAILED');
    }
    return { dataUrl, digestSource: dataUrl.slice(prefix.length) };
}

export class AiViewGenerationCapture {
    constructor({
        scene,
        renderer,
        width = 1536,
        height = 1024,
        canvasFactory = () => document.createElement('canvas'),
    } = {}) {
        if (!scene || !renderer) throw new Error('AI_GENERATION_CAPTURE_SCENE_NOT_READY');
        this.scene = scene;
        this.renderer = renderer;
        this.width = Math.max(16, Math.round(finite(width, 1536)));
        this.height = Math.max(9, Math.round(finite(height, 1024)));
        this.canvasFactory = canvasFactory;
        this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 10, 100000);
        this.camera.up.set(0, 0, 1);
        this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
            type: THREE.UnsignedByteType,
            colorSpace: THREE.SRGBColorSpace,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
        });
        this.tail = Promise.resolve();
        this.disposed = false;
    }

    capture(view, { signal } = {}) {
        if (this.disposed) return Promise.reject(new Error('AI_GENERATION_CAPTURE_DISPOSED'));
        const job = this.tail.then(() => this._captureNow(view, signal));
        this.tail = job.catch(() => {});
        return job;
    }

    async captureAll(views, { onProgress, signal } = {}) {
        const source = Array.isArray(views) ? views : [];
        const results = [];
        for (const view of source) {
            throwIfAborted(signal);
            const result = await this.capture(view, { signal });
            results.push(result);
            try {
                onProgress?.({ completed: results.length, total: source.length, viewId: result.viewId });
            } catch {}
        }
        return results;
    }

    _configureCamera(view) {
        const yaw = THREE.MathUtils.degToRad(finite(view?.yaw));
        const pitch = THREE.MathUtils.degToRad(finite(view?.pitch));
        const horizontal = Math.cos(pitch);
        const direction = new THREE.Vector3(
            Math.cos(yaw) * horizontal,
            Math.sin(yaw) * horizontal,
            Math.sin(pitch),
        );
        this.camera.position.set(finite(view?.x), finite(view?.y), finite(view?.z, 1500));
        this.camera.aspect = this.width / this.height;
        this.camera.fov = horizontalToVerticalFov(
            clampPanoramaHorizontalFov(view?.fov),
            this.camera.aspect,
        );
        this.camera.lookAt(this.camera.position.clone().add(direction));
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);
    }

    async _captureNow(view, signal) {
        if (this.disposed) throw new Error('AI_GENERATION_CAPTURE_DISPOSED');
        throwIfAborted(signal);
        this._configureCamera(view);
        const renderer = this.renderer;
        const previousTarget = renderer.getRenderTarget();
        const previousViewport = renderer.getViewport(new THREE.Vector4());
        const previousScissor = renderer.getScissor(new THREE.Vector4());
        const previousScissorTest = renderer.getScissorTest();
        const previousClearColor = renderer.getClearColor(new THREE.Color());
        const previousClearAlpha = renderer.getClearAlpha();
        const pixels = new Uint8Array(this.width * this.height * 4);
        try {
            renderer.setRenderTarget(this.target);
            renderer.setViewport(new THREE.Vector4(0, 0, this.width, this.height));
            renderer.setScissor(new THREE.Vector4(0, 0, this.width, this.height));
            renderer.setScissorTest(false);
            renderer.clear();
            renderer.render(this.scene, this.camera);
            renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, pixels);
        } finally {
            renderer.setRenderTarget(previousTarget);
            renderer.setViewport(previousViewport);
            renderer.setScissor(previousScissor);
            renderer.setScissorTest(previousScissorTest);
            renderer.setClearColor(previousClearColor, previousClearAlpha);
        }
        throwIfAborted(signal);
        const encoded = encodeWebp(pixelsToCanvas(
            pixels, this.width, this.height, this.canvasFactory,
        ));
        throwIfAborted(signal);
        return {
            viewId: String(view?.id ?? ''),
            mimeType: 'image/webp',
            ...encoded,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.target.dispose();
    }
}
