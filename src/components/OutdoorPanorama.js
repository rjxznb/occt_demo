import * as THREE from 'three';

export const OUTDOOR_PANORAMA_WIDTH = 2048;
export const OUTDOOR_PANORAMA_HEIGHT = 1024;
export const OUTDOOR_PANORAMA_URL = './assets/outdoor/residential-community-panorama.png';

export async function loadOutdoorPanoramaTexture({
    textureLoader = new THREE.TextureLoader(),
} = {}) {
    let texture;
    try {
        texture = await textureLoader.loadAsync(OUTDOOR_PANORAMA_URL);
    } catch {
        throw new Error('OUTDOOR_PANORAMA_LOAD_FAILED');
    }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = 'ResidentialCommunityOutdoorPanorama';
    texture.needsUpdate = true;
    return texture;
}

export function drawOutdoorPanorama(context, width, height) {
    const horizon = Math.round(height * 0.58);
    const sky = context.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#7eb6e8');
    sky.addColorStop(0.62, '#c9dff1');
    sky.addColorStop(1, '#edf0ec');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, horizon);

    const sun = context.createRadialGradient(
        width * 0.72,
        height * 0.2,
        0,
        width * 0.72,
        height * 0.2,
        height * 0.12,
    );
    sun.addColorStop(0, 'rgba(255,248,220,0.72)');
    sun.addColorStop(1, 'rgba(255,248,220,0)');
    context.fillStyle = sun;
    context.fillRect(0, 0, width, horizon);

    context.fillStyle = '#9eabb2';
    context.beginPath();
    context.moveTo(0, horizon);
    for (let index = 0; index <= 24; index += 1) {
        const x = index * width / 24;
        const peak = height * (0.075 + ((index * 5) % 7) * 0.012);
        context.lineTo(x, horizon - peak);
    }
    context.lineTo(width, horizon);
    context.closePath();
    context.fill();

    const buildingColors = ['#758792', '#81919a', '#8b989f', '#6f828e'];
    for (let index = 0; index < 48; index += 1) {
        const segment = width / 48;
        const buildingWidth = segment * (0.62 + (index % 4) * 0.08);
        const buildingHeight = height * (0.14 + ((index * 7) % 11) * 0.009);
        context.fillStyle = buildingColors[index % buildingColors.length];
        context.fillRect(
            index * segment,
            horizon - buildingHeight,
            buildingWidth,
            buildingHeight,
        );
    }

    const ground = context.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, '#a9b39d');
    ground.addColorStop(0.45, '#8f9b84');
    ground.addColorStop(1, '#727b69');
    context.fillStyle = ground;
    context.fillRect(0, horizon, width, height - horizon);

    context.fillStyle = '#6f8971';
    for (let index = 0; index < 64; index += 1) {
        const x = (index + 0.35) * width / 64;
        const radius = height * (0.018 + (index % 5) * 0.0025);
        context.beginPath();
        context.arc(x, horizon - height * 0.012, radius, 0, Math.PI * 2);
        context.fill();
    }

    const haze = context.createLinearGradient(
        0,
        horizon - height * 0.08,
        0,
        horizon + height * 0.09,
    );
    haze.addColorStop(0, 'rgba(238,241,237,0)');
    haze.addColorStop(0.5, 'rgba(238,241,237,0.24)');
    haze.addColorStop(1, 'rgba(238,241,237,0)');
    context.fillStyle = haze;
    context.fillRect(0, horizon - height * 0.08, width, height * 0.17);
}

export function createOutdoorPanoramaTexture({
    canvasFactory = () => (typeof document === 'undefined'
        ? null : document.createElement('canvas')),
} = {}) {
    const canvas = canvasFactory?.();
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return null;

    canvas.width = OUTDOOR_PANORAMA_WIDTH;
    canvas.height = OUTDOOR_PANORAMA_HEIGHT;
    drawOutdoorPanorama(context, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = 'ProceduralOutdoorPanorama';
    texture.needsUpdate = true;
    return texture;
}
