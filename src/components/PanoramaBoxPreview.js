import * as THREE from 'three';

const VERTEX_SHADER = `
    varying vec3 vBoxDirection;
    void main() {
        vBoxDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = `
    uniform sampler2D panoramaMap;
    varying vec3 vBoxDirection;
    const float PI = 3.141592653589793;

    void main() {
        vec3 direction = normalize(vBoxDirection);
        float longitude = atan(direction.x, direction.y);
        float latitude = asin(clamp(direction.z, -1.0, 1.0));
        vec2 panoramaUv = vec2(
            longitude / (2.0 * PI) + 0.5,
            latitude / PI + 0.5
        );
        gl_FragColor = texture2D(panoramaMap, panoramaUv);
    }
`;

export function panoramaUvForDirection(x, y, z) {
    const length = Math.hypot(x, y, z) || 1;
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    return {
        u: Math.atan2(nx, ny) / (Math.PI * 2) + 0.5,
        v: Math.asin(Math.max(-1, Math.min(1, nz))) / Math.PI + 0.5,
    };
}

export class PanoramaBoxPreview {
    constructor(container) {
        this.container = container;
        this.texture = null;
        this.loadToken = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.pointer = null;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(72, 2, 0.01, 20);
        this.camera.up.set(0, 0, 1);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.domElement.className = 'panorama-box-canvas';
        this.renderer.domElement.setAttribute('aria-label', '可交互全景包围盒');
        this.container.appendChild(this.renderer.domElement);

        this.geometry = new THREE.BoxGeometry(10, 10, 10);
        this.material = new THREE.ShaderMaterial({
            uniforms: { panoramaMap: { value: null } },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
        });
        this.box = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(this.box);

        this._pointerDown = event => this.onPointerDown(event);
        this._pointerMove = event => this.onPointerMove(event);
        this._pointerUp = event => this.onPointerUp(event);
        this._wheel = event => this.onWheel(event);
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this._pointerDown);
        canvas.addEventListener('pointermove', this._pointerMove);
        canvas.addEventListener('pointerup', this._pointerUp);
        canvas.addEventListener('pointercancel', this._pointerUp);
        canvas.addEventListener('wheel', this._wheel, { passive: false });

        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(this.container);
        this.updateCamera();
    }

    async setSource(url) {
        const token = ++this.loadToken;
        const texture = await new THREE.TextureLoader().loadAsync(url);
        if (token !== this.loadToken) {
            texture.dispose();
            return;
        }
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.texture?.dispose();
        this.texture = texture;
        this.material.uniforms.panoramaMap.value = texture;
        this.material.needsUpdate = true;
        this.container.classList.add('ready');
        this.resetView();
    }

    clear() {
        this.loadToken += 1;
        this.texture?.dispose();
        this.texture = null;
        this.material.uniforms.panoramaMap.value = null;
        this.container.classList.remove('ready');
    }

    resetView() {
        this.yaw = 0;
        this.pitch = 0;
        this.camera.fov = 72;
        this.camera.updateProjectionMatrix();
        this.updateCamera();
    }

    updateCamera() {
        const cosPitch = Math.cos(this.pitch);
        this.camera.lookAt(new THREE.Vector3(
            Math.sin(this.yaw) * cosPitch,
            Math.cos(this.yaw) * cosPitch,
            Math.sin(this.pitch),
        ));
        this.render();
    }

    onPointerDown(event) {
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.container.classList.add('dragging');
    }

    onPointerMove(event) {
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.yaw -= dx * 0.0045;
        this.pitch = THREE.MathUtils.clamp(
            this.pitch + dy * 0.0045,
            -Math.PI * 0.49,
            Math.PI * 0.49,
        );
        this.updateCamera();
    }

    onPointerUp(event) {
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        this.pointer = null;
        this.container.classList.remove('dragging');
    }

    onWheel(event) {
        event.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + event.deltaY * 0.035, 35, 95);
        this.camera.updateProjectionMatrix();
        this.render();
    }

    render() {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        if (this.renderer.domElement.width !== Math.round(width * this.renderer.getPixelRatio())
            || this.renderer.domElement.height !== Math.round(height * this.renderer.getPixelRatio())) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.clear();
        this.resizeObserver?.disconnect();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this._pointerDown);
        canvas.removeEventListener('pointermove', this._pointerMove);
        canvas.removeEventListener('pointerup', this._pointerUp);
        canvas.removeEventListener('pointercancel', this._pointerUp);
        canvas.removeEventListener('wheel', this._wheel);
        this.geometry.dispose();
        this.material.dispose();
        this.renderer.dispose();
        canvas.remove();
    }
}
