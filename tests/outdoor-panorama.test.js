import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as outdoorPanorama from '../src/components/OutdoorPanorama.js';
import { createOutdoorPanoramaTexture } from '../src/components/OutdoorPanorama.js';
import { SceneManager } from '../src/core/SceneManager.js';

function recordingCanvas() {
    const calls = [];
    const gradient = () => ({
        addColorStop(offset, color) { calls.push(['colorStop', offset, color]); },
    });
    const context = {
        createLinearGradient(...args) { calls.push(['linearGradient', ...args]); return gradient(); },
        createRadialGradient(...args) { calls.push(['radialGradient', ...args]); return gradient(); },
        fillRect(...args) { calls.push(['fillRect', ...args]); },
        beginPath() { calls.push(['beginPath']); },
        moveTo(...args) { calls.push(['moveTo', ...args]); },
        lineTo(...args) { calls.push(['lineTo', ...args]); },
        closePath() { calls.push(['closePath']); },
        arc(...args) { calls.push(['arc', ...args]); },
        fill() { calls.push(['fill']); },
        set fillStyle(value) { calls.push(['fillStyle', value]); },
    };
    return {
        calls,
        canvas: { width: 0, height: 0, getContext: () => context },
    };
}

test('real outdoor panorama loader exposes a fixed project-local texture contract', () => {
    assert.equal(typeof outdoorPanorama.loadOutdoorPanoramaTexture, 'function');
});

test('real outdoor panorama loader configures the bundled image for equirectangular sRGB', async () => {
    const texture = new THREE.Texture();
    let requestedUrl = null;
    const result = await outdoorPanorama.loadOutdoorPanoramaTexture({
        textureLoader: {
            async loadAsync(url) {
                requestedUrl = url;
                return texture;
            },
        },
    });

    assert.equal(requestedUrl, './assets/outdoor/residential-community-panorama.png');
    assert.equal(result, texture);
    assert.equal(result.mapping, THREE.EquirectangularReflectionMapping);
    assert.equal(result.colorSpace, THREE.SRGBColorSpace);
    assert.equal(result.name, 'ResidentialCommunityOutdoorPanorama');
});

test('real outdoor panorama loader sanitizes image-loading failures', async () => {
    await assert.rejects(
        outdoorPanorama.loadOutdoorPanoramaTexture({
            textureLoader: {
                async loadAsync() { throw new Error('file:///private/path?token=secret'); },
            },
        }),
        error => error?.message === 'OUTDOOR_PANORAMA_LOAD_FAILED',
    );
});

test('outdoor panorama is a local deterministic equirectangular sRGB texture', () => {
    const recording = recordingCanvas();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network access is forbidden'); };
    try {
        const texture = createOutdoorPanoramaTexture({
            canvasFactory: () => recording.canvas,
        });

        assert.ok(texture?.isCanvasTexture);
        assert.equal(texture.image, recording.canvas);
        assert.equal(recording.canvas.width, 2048);
        assert.equal(recording.canvas.height, 1024);
        assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
        assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
        assert.ok(recording.calls.filter(call => call[0] === 'fillRect').length >= 50);
        assert.ok(recording.calls.some(call => call[0] === 'arc'));
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('outdoor scenery rises above the panorama horizon so it remains visible through windows', () => {
    const recording = recordingCanvas();
    createOutdoorPanoramaTexture({ canvasFactory: () => recording.canvas });

    const tallScenery = recording.calls.find((call) => (
        call[0] === 'fillRect'
        && call[3] < recording.canvas.width * 0.1
        && call[2] <= recording.canvas.height * 0.44
        && call[4] >= recording.canvas.height * 0.13
    ));

    assert.ok(tallScenery, 'expected a distant skyline visible above eye-level horizon');
});

test('outdoor panorama returns null when Canvas 2D is unavailable', () => {
    const texture = createOutdoorPanoramaTexture({
        canvasFactory: () => ({ getContext: () => null }),
    });
    assert.equal(texture, null);
});

test('outdoor panorama texture emits disposal and can release its canvas', () => {
    const recording = recordingCanvas();
    const texture = createOutdoorPanoramaTexture({ canvasFactory: () => recording.canvas });
    let disposed = false;
    texture.addEventListener('dispose', () => { disposed = true; });
    texture.dispose();
    assert.equal(disposed, true);
});

test('SceneManager releases the owned outdoor panorama during destruction', () => {
    const manager = Object.create(SceneManager.prototype);
    let disposed = false;
    manager.scene = { background: { id: 'outdoor' } };
    manager.outdoorPanoramaTexture = manager.scene.background;
    manager.outdoorPanoramaTexture.dispose = () => { disposed = true; };
    manager.outdoorPanoramaGeneration = 5;

    manager.disposeOutdoorPanorama();

    assert.equal(disposed, true);
    assert.equal(manager.scene.background, null);
    assert.equal(manager.outdoorPanoramaTexture, null);
    assert.equal(manager.outdoorPanoramaGeneration, 6);
});

test('SceneManager exposes one lifecycle boundary for asynchronously loaded scenery', () => {
    assert.equal(typeof SceneManager.prototype.installOutdoorPanoramaTexture, 'function');
});

test('SceneManager replaces an inactive fallback without changing the ordinary background', () => {
    const manager = Object.create(SceneManager.prototype);
    const ordinary = new THREE.Color(0x123456);
    const fallback = new THREE.Texture();
    const realistic = new THREE.Texture();
    let fallbackDisposed = false;
    fallback.dispose = () => { fallbackDisposed = true; };
    manager.scene = new THREE.Scene();
    manager.scene.background = ordinary;
    manager.outdoorPanoramaTexture = fallback;
    manager.outdoorPanoramaState = null;
    manager.outdoorPanoramaGeneration = 3;

    assert.equal(manager.installOutdoorPanoramaTexture(realistic, 3), true);
    assert.equal(manager.outdoorPanoramaTexture, realistic);
    assert.equal(manager.scene.background, ordinary);
    assert.equal(fallbackDisposed, true);
});

test('SceneManager keeps fixed-point scenery active when the realistic image arrives', () => {
    const manager = Object.create(SceneManager.prototype);
    const fallback = new THREE.Texture();
    const realistic = new THREE.Texture();
    manager.scene = new THREE.Scene();
    manager.scene.background = fallback;
    manager.outdoorPanoramaTexture = fallback;
    manager.outdoorPanoramaState = { background: new THREE.Color(0x123456) };
    manager.outdoorPanoramaGeneration = 4;

    assert.equal(manager.installOutdoorPanoramaTexture(realistic, 4), true);
    assert.equal(manager.scene.background, realistic);
});

test('SceneManager disposes a realistic texture that resolves after panorama shutdown', () => {
    const manager = Object.create(SceneManager.prototype);
    const lateTexture = new THREE.Texture();
    let disposed = false;
    lateTexture.dispose = () => { disposed = true; };
    manager.scene = null;
    manager.outdoorPanoramaTexture = null;
    manager.outdoorPanoramaGeneration = 8;

    assert.equal(manager.installOutdoorPanoramaTexture(lateTexture, 7), false);
    assert.equal(disposed, true);
    assert.equal(manager.outdoorPanoramaTexture, null);
});

test('SceneManager exposes asynchronous realistic-scenery loading', () => {
    assert.equal(typeof SceneManager.prototype.loadRealisticOutdoorPanorama, 'function');
});

test('SceneManager installs a loaded realistic panorama and retains fallback on failure', async () => {
    const manager = Object.create(SceneManager.prototype);
    const fallback = new THREE.Texture();
    const realistic = new THREE.Texture();
    manager.scene = new THREE.Scene();
    manager.scene.background = new THREE.Color(0x123456);
    manager.outdoorPanoramaTexture = fallback;
    manager.outdoorPanoramaGeneration = 6;

    assert.equal(await manager.loadRealisticOutdoorPanorama(async () => realistic), true);
    assert.equal(manager.outdoorPanoramaTexture, realistic);

    const retained = manager.outdoorPanoramaTexture;
    assert.equal(await manager.loadRealisticOutdoorPanorama(async () => {
        throw new Error('OUTDOOR_PANORAMA_LOAD_FAILED');
    }), false);
    assert.equal(manager.outdoorPanoramaTexture, retained);
});

test('SceneManager environment starts realistic loading after installing the fallback', () => {
    const manager = Object.create(SceneManager.prototype);
    const previousDocument = globalThis.document;
    let loads = 0;
    manager.scene = new THREE.Scene();
    manager.outdoorPanoramaGeneration = 0;
    manager.loadRealisticOutdoorPanorama = () => { loads += 1; return Promise.resolve(true); };
    globalThis.document = {
        createElement() { return recordingCanvas().canvas; },
    };
    try {
        manager.setupEnvironment();
    } finally {
        globalThis.document = previousDocument;
    }

    assert.equal(loads, 1);
    assert.ok(manager.outdoorPanoramaTexture?.isCanvasTexture);
    assert.equal(manager.outdoorPanoramaGeneration, 1);
});

test('camera preset activation installs a Z-up outdoor panorama', () => {
    const manager = Object.create(SceneManager.prototype);
    const ordinary = new THREE.Color(0x123456);
    const outdoor = new THREE.Texture();
    manager.scene = new THREE.Scene();
    manager.scene.background = ordinary;
    manager.scene.backgroundRotation.set(0.1, 0.2, 0.3);
    manager.outdoorPanoramaTexture = outdoor;
    manager.outdoorPanoramaState = null;

    assert.equal(manager.activateOutdoorPanorama(), true);
    assert.equal(manager.scene.background, outdoor);
    assert.ok(Math.abs(manager.scene.backgroundRotation.x - Math.PI / 2) < 1e-12);
    assert.equal(manager.scene.backgroundRotation.y, 0);
    assert.equal(manager.scene.backgroundRotation.z, 0);
});

test('camera preset exit restores the exact ordinary background state', () => {
    const manager = Object.create(SceneManager.prototype);
    const ordinary = new THREE.Color(0x123456);
    manager.scene = new THREE.Scene();
    manager.scene.background = ordinary;
    manager.scene.backgroundRotation.set(0.1, 0.2, 0.3);
    manager.outdoorPanoramaTexture = new THREE.Texture();
    manager.outdoorPanoramaState = null;

    manager.activateOutdoorPanorama();
    assert.equal(manager.restoreOutdoorPanorama(), true);
    assert.equal(manager.scene.background, ordinary);
    assert.deepEqual(manager.scene.backgroundRotation.toArray(), [0.1, 0.2, 0.3, 'XYZ']);
    assert.equal(manager.outdoorPanoramaState, null);
});
