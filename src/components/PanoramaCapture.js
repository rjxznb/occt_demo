import * as THREE from 'three';

export const CUBE_FACE_NAMES = Object.freeze([
    '+X', '-X', '+Y', '-Y', '+Z', '-Z',
]);

const EQUIRECT_VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const EQUIRECT_FRAGMENT_SHADER = `
    uniform samplerCube panoramaCube;
    varying vec2 vUv;
    const float PI = 3.141592653589793;

    void main() {
        float longitude = (vUv.x * 2.0 - 1.0) * PI;
        float latitude = (vUv.y - 0.5) * PI;
        float cosLatitude = cos(latitude);
        vec3 direction = normalize(vec3(
            sin(longitude) * cosLatitude,
            cos(longitude) * cosLatitude,
            sin(latitude)
        ));
        gl_FragColor = textureCube(panoramaCube, direction);
    }
`;

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    throw new DOMException('Panorama capture cancelled', 'AbortError');
}

export function equirectDirection(u, v) {
    const longitude = (u * 2 - 1) * Math.PI;
    const latitude = (0.5 - v) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    return new THREE.Vector3(
        Math.sin(longitude) * cosLatitude,
        Math.cos(longitude) * cosLatitude,
        Math.sin(latitude),
    ).normalize();
}

export function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('PANORAMA_ENCODE_FAILED'));
        }, 'image/png');
    });
}

export function pixelsToCanvas(pixels, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    const imageData = context.createImageData(width, height);
    const rowBytes = width * 4;
    for (let sourceY = 0; sourceY < height; sourceY += 1) {
        const targetY = height - sourceY - 1;
        const sourceStart = sourceY * rowBytes;
        imageData.data.set(
            pixels.subarray(sourceStart, sourceStart + rowBytes),
            targetY * rowBytes,
        );
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
}

export class PanoramaCapture {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
    }

    async capture(options = {}) {
        if (options.rendererMode === 'pathtrace') {
            try {
                const { capturePathTracedPanorama } = await import('./PathTracedPanoramaCapture.js');
                return await capturePathTracedPanorama(this.sceneManager, options);
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                const safeCode = String(error?.message || 'PATH_TRACING_FAILED')
                    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
                    .replace(/[\r\n]+/g, ' ')
                    .slice(0, 160);
                console.warn(`[Panorama] path tracing unavailable; using raster fallback code=${safeCode}`);
                options.onProgress?.({ stage: 'fallback', completed: 0, total: 1 });
            }
        }
        return this.captureRaster(options);
    }

    async captureRaster({ faceSize = 1024, onProgress, signal } = {}) {
        const size = Math.max(256, Math.min(2048, Math.round(faceSize)));
        const manager = this.sceneManager;
        const renderer = manager?.getRenderer?.();
        const scene = manager?.getScene?.();
        const sourceCamera = manager?.getCamera?.();
        if (!renderer || !scene || !sourceCamera) {
            throw new Error('PANORAMA_SCENE_NOT_READY');
        }

        const hiddenObjects = new Map();
        scene.traverse(object => {
            if (!object.visible || (!object.isSprite && object.userData?.isHelper !== true)) return;
            hiddenObjects.set(object, object.visible);
            object.visible = false;
        });

        const previousBackground = scene.background;
        if (previousBackground?.isColor !== true) {
            scene.background = scene.fog?.color?.clone() || new THREE.Color(0xd7dee5);
        }

        const wasPaused = Boolean(manager.paused);
        const previousTarget = renderer.getRenderTarget();
        const previousCubeFace = renderer.getActiveCubeFace();
        const previousMipmapLevel = renderer.getActiveMipmapLevel();
        const previousXrEnabled = renderer.xr.enabled;
        const cubeTarget = new THREE.WebGLCubeRenderTarget(size, {
            type: THREE.UnsignedByteType,
            colorSpace: THREE.SRGBColorSpace,
            generateMipmaps: false,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
        });
        const cubeCamera = new THREE.CubeCamera(
            Math.max(1, sourceCamera.near || 10),
            sourceCamera.far || 100000,
            cubeTarget,
        );
        cubeCamera.position.copy(sourceCamera.position);
        cubeCamera.coordinateSystem = renderer.coordinateSystem;
        cubeCamera.updateCoordinateSystem();
        cubeCamera.updateMatrixWorld(true);

        manager.setPaused(true);
        renderer.xr.enabled = false;

        let outputTarget = null;
        let conversionMaterial = null;
        let conversionGeometry = null;
        try {
            for (let face = 0; face < CUBE_FACE_NAMES.length; face += 1) {
                throwIfAborted(signal);
                renderer.setRenderTarget(cubeTarget, face, 0);
                renderer.clear();
                renderer.render(scene, cubeCamera.children[face]);
                onProgress?.({
                    stage: 'faces',
                    completed: face + 1,
                    total: CUBE_FACE_NAMES.length,
                    face: CUBE_FACE_NAMES[face],
                });
                await nextFrame();
            }

            throwIfAborted(signal);
            const width = size * 2;
            const height = size;
            outputTarget = new THREE.WebGLRenderTarget(width, height, {
                type: THREE.UnsignedByteType,
                colorSpace: THREE.SRGBColorSpace,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: false,
                stencilBuffer: false,
            });
            conversionGeometry = new THREE.PlaneGeometry(2, 2);
            conversionMaterial = new THREE.ShaderMaterial({
                uniforms: { panoramaCube: { value: cubeTarget.texture } },
                vertexShader: EQUIRECT_VERTEX_SHADER,
                fragmentShader: EQUIRECT_FRAGMENT_SHADER,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
            });
            const conversionScene = new THREE.Scene();
            conversionScene.add(new THREE.Mesh(conversionGeometry, conversionMaterial));
            const conversionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            renderer.setRenderTarget(outputTarget);
            renderer.clear();
            renderer.render(conversionScene, conversionCamera);

            onProgress?.({ stage: 'readback', completed: 1, total: 1 });
            await nextFrame();
            throwIfAborted(signal);
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
                position: sourceCamera.position.clone(),
                renderer: 'raster',
            };
        } finally {
            renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
            renderer.xr.enabled = previousXrEnabled;
            manager.setPaused(wasPaused);
            scene.background = previousBackground;
            for (const [object, visible] of hiddenObjects) object.visible = visible;
            conversionGeometry?.dispose();
            conversionMaterial?.dispose();
            outputTarget?.dispose();
            cubeTarget.dispose();
        }
    }
}
