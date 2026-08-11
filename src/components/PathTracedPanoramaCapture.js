import * as THREE from 'three';
import { WebGLPathTracer, EquirectCamera, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { canvasToBlob, pixelsToCanvas } from './PanoramaCapture.js';

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException('Panorama capture cancelled', 'AbortError');
    }
}

function disposePathTracer(pathTracer) {
    if (!pathTracer) return;
    try {
        pathTracer.dispose();
    } catch {
        // three-gpu-pathtracer 0.0.23 references a removed _renderQuad field in
        // its public dispose(). Release the actual owned objects for this pinned
        // compatibility version until the project can move to Three r180+.
        pathTracer._quad?.dispose?.();
        pathTracer._quad?.material?.dispose?.();
        pathTracer._pathTracer?.dispose?.();
        pathTracer._lowResPathTracer?.dispose?.();
        pathTracer._internalBackground?.dispose?.();
        pathTracer._colorBackground?.dispose?.();
    }
}

export async function capturePathTracedPanorama(
    sceneManager,
    { faceSize = 1024, samples = 8, onProgress, signal } = {},
) {
    const renderer = sceneManager?.getRenderer?.();
    const scene = sceneManager?.getScene?.();
    const sourceCamera = sceneManager?.getCamera?.();
    if (!renderer || !scene || !sourceCamera) throw new Error('PANORAMA_SCENE_NOT_READY');
    if (!renderer.capabilities?.isWebGL2) throw new Error('PATH_TRACING_REQUIRES_WEBGL2');

    const size = Math.max(256, Math.min(2048, Math.round(faceSize)));
    const width = size * 2;
    const height = size;
    const sampleGoal = Math.max(1, Math.min(128, Math.round(samples)));
    const previousSize = renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = renderer.getPixelRatio();
    const previousTarget = renderer.getRenderTarget();
    const previousBackground = scene.background;
    const previousEnvironment = scene.environment;
    const previousEnvironmentIntensity = scene.environmentIntensity;
    const wasPaused = Boolean(sceneManager.paused);
    const hiddenObjects = new Map();
    scene.traverse(object => {
        if (!object.visible || (!object.isSprite && object.userData?.isHelper !== true)) return;
        hiddenObjects.set(object, object.visible);
        object.visible = false;
    });

    const sky = new GradientEquirectTexture(64);
    sky.topColor.set(0xdce8f3);
    sky.bottomColor.set(0xd8d1c7);
    sky.exponent = 1.6;
    sky.update();

    const camera = new EquirectCamera();
    camera.position.copy(sourceCamera.position);
    camera.up.set(0, 0, 1);
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 1, 0)));
    camera.updateMatrixWorld(true);

    let pathTracer = null;
    let outputTarget = null;
    let outputGeometry = null;
    let outputMaterial = null;
    sceneManager.setPaused(true);
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = Math.max(0.35, previousEnvironmentIntensity || 0.55);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    try {
        throwIfAborted(signal);
        onProgress?.({ stage: 'pathtrace-prepare', completed: 0, total: 1 });
        await nextFrame();

        pathTracer = new WebGLPathTracer(renderer);
        pathTracer.renderDelay = 0;
        pathTracer.renderToCanvas = false;
        pathTracer.rasterizeScene = false;
        pathTracer.dynamicLowRes = false;
        pathTracer.synchronizeRenderSize = true;
        pathTracer.tiles.set(2, 2);
        pathTracer.bounces = 4;
        pathTracer.transmissiveBounces = 4;
        pathTracer.filterGlossyFactor = 0.35;
        pathTracer.stableNoise = true;
        pathTracer.setScene(scene, camera);

        const startedAt = performance.now();
        while (pathTracer.samples < sampleGoal) {
            throwIfAborted(signal);
            pathTracer.renderSample();
            const completed = Math.min(sampleGoal, Math.floor(pathTracer.samples));
            onProgress?.({
                stage: 'pathtrace-samples',
                completed,
                total: sampleGoal,
            });
            if (performance.now() - startedAt > 5 * 60 * 1000) {
                throw new Error('PATH_TRACING_TIMEOUT');
            }
            await nextFrame();
        }

        throwIfAborted(signal);
        onProgress?.({ stage: 'readback', completed: 1, total: 1 });
        outputTarget = new THREE.WebGLRenderTarget(width, height, {
            type: THREE.UnsignedByteType,
            colorSpace: THREE.SRGBColorSpace,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
        });
        outputGeometry = new THREE.PlaneGeometry(2, 2);
        outputMaterial = new THREE.MeshBasicMaterial({
            map: pathTracer.target.texture,
            toneMapped: true,
            depthTest: false,
            depthWrite: false,
        });
        const outputScene = new THREE.Scene();
        outputScene.add(new THREE.Mesh(outputGeometry, outputMaterial));
        const outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        renderer.setRenderTarget(outputTarget);
        renderer.clear();
        renderer.render(outputScene, outputCamera);

        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(outputTarget, 0, 0, width, height, pixels);
        const canvas = pixelsToCanvas(pixels, width, height);
        const blob = await canvasToBlob(canvas);
        onProgress?.({ stage: 'complete', completed: 1, total: 1 });
        return {
            blob,
            width,
            height,
            faceSize: size,
            samples: sampleGoal,
            position: sourceCamera.position.clone(),
            renderer: 'pathtrace',
        };
    } finally {
        disposePathTracer(pathTracer);
        outputGeometry?.dispose();
        outputMaterial?.dispose();
        outputTarget?.dispose();
        sky.dispose();
        scene.background = previousBackground;
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousEnvironmentIntensity;
        for (const [object, visible] of hiddenObjects) object.visible = visible;
        renderer.setRenderTarget(previousTarget);
        renderer.setPixelRatio(previousPixelRatio);
        renderer.setSize(previousSize.x, previousSize.y, false);
        sceneManager.setPaused(wasPaused);
    }
}
