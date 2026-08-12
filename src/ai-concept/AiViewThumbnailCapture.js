import * as THREE from 'three';
import { clampPanoramaHorizontalFov, horizontalToVerticalFov } from '../core/CameraFov.js';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalized(value) {
    return Number(finite(value).toFixed(4));
}

export function thumbnailCacheKey(view) {
    return [view?.id, view?.x, view?.y, view?.z, view?.yaw, view?.pitch, view?.fov]
        .map((value, index) => index === 0 ? String(value ?? '') : String(normalized(value)))
        .join('|');
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('AI_THUMBNAIL_ENCODE_FAILED'));
        }, 'image/webp', 0.82);
    });
}

function pixelsToCanvas(pixels, width, height, canvasFactory) {
    const canvas = canvasFactory();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext?.('2d', { alpha: false });
    if (!context) throw new Error('AI_THUMBNAIL_CANVAS_UNAVAILABLE');
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

export class AiViewThumbnailCapture {
    constructor({
        scene,
        renderer,
        width = 320,
        height = 180,
        canvasFactory = () => document.createElement('canvas'),
        urlApi = globalThis.URL,
    } = {}) {
        if (!scene || !renderer) throw new Error('AI_THUMBNAIL_SCENE_NOT_READY');
        this.scene = scene;
        this.renderer = renderer;
        this.width = Math.max(16, Math.round(finite(width, 320)));
        this.height = Math.max(9, Math.round(finite(height, 180)));
        this.canvasFactory = canvasFactory;
        this.urlApi = urlApi;
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
        this.cache = new Map();
        this.inFlight = new Map();
        this.tail = Promise.resolve();
        this.disposed = false;
    }

    capture(view) {
        if (this.disposed) return Promise.reject(new Error('AI_THUMBNAIL_CAPTURE_DISPOSED'));
        const key = thumbnailCacheKey(view);
        const cached = this.cache.get(view?.id);
        if (cached?.key === key) return Promise.resolve(cached.result);
        const pending = this.inFlight.get(key);
        if (pending) return pending;
        const job = this.tail.then(() => this._captureNow(view, key));
        this.tail = job.catch(() => {});
        this.inFlight.set(key, job);
        void job.finally(() => this.inFlight.delete(key)).catch(() => {});
        return job;
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

    async _captureNow(view, key) {
        if (this.disposed) throw new Error('AI_THUMBNAIL_CAPTURE_DISPOSED');
        this._configureCamera(view);
        const renderer = this.renderer;
        const previousTarget = renderer.getRenderTarget();
        const previousViewport = renderer.getViewport(new THREE.Vector4());
        const previousScissor = renderer.getScissor(new THREE.Vector4());
        const previousScissorTest = renderer.getScissorTest();
        const previousClearColor = renderer.getClearColor(new THREE.Color());
        const previousClearAlpha = renderer.getClearAlpha();
        const pixels = new Uint8Array(this.width * this.height * 4);
        let url;
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
        try {
            const blob = await canvasToBlob(pixelsToCanvas(
                pixels, this.width, this.height, this.canvasFactory,
            ));
            if (this.disposed) throw new Error('AI_THUMBNAIL_CAPTURE_DISPOSED');
            url = this.urlApi.createObjectURL(blob);
            const result = { status: 'ready', url, cacheKey: key };
            const previous = this.cache.get(view.id);
            if (previous?.result?.url && previous.result.url !== url) {
                this.urlApi.revokeObjectURL(previous.result.url);
            }
            this.cache.set(view.id, { key, result });
            return result;
        } catch (error) {
            if (url) this.urlApi.revokeObjectURL(url);
            throw error;
        }
    }

    invalidate(viewId) {
        const cached = this.cache.get(viewId);
        if (cached?.result?.url) this.urlApi.revokeObjectURL(cached.result.url);
        this.cache.delete(viewId);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const entry of this.cache.values()) {
            if (entry.result?.url) this.urlApi.revokeObjectURL(entry.result.url);
        }
        this.cache.clear();
        this.inFlight.clear();
        this.target.dispose();
    }
}
