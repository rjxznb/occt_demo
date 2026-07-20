import * as THREE from 'three';

/**
 * 第一人称漫游控制器（适配本项目的 Z-up 坐标系）。
 *
 * three 官方 PointerLockControls 假定 Y 轴向上，直接用在 Z-up 场景里画面会翻。
 * 这里自己实现：偏航(yaw)绕 Z 轴、俯仰(pitch)抬头低头，鼠标锁定后移动视角，
 * WASD 在水平面行走（高度锁在视点高度），可选边界回调把人挡在户型轮廓内。
 */
export class FirstPersonControls {
    /**
     * @param {THREE.Camera} camera - 复用场景相机（up 已是 (0,0,1)）
     * @param {HTMLElement} domElement - 渲染画布，用于指针锁定与输入
     */
    constructor(camera, domElement) {
        this.camera = camera;
        this.dom = domElement;

        this.enabled = false;
        this.locked = false;

        this.yaw = 0;                 // 绕 +Z，0 = 朝 +X
        this.pitch = 0;               // 抬头为正，夹在 ±maxPitch
        this.maxPitch = 1.45;         // ≈83°，避免 lookAt 在正上/正下奇异

        this.eyeHeight = 1600;        // 视点离地高度 (mm)，进房间时的默认站立高度
        this.moveSpeed = 3400;        // 水平行走速度 (mm/s)
        this.verticalSpeed = 2600;    // 垂直升降速度 (mm/s)
        this.runFactor = 2.2;         // 按住 Shift 加速
        this.sensitivity = 0.0022;    // 鼠标灵敏度
        this.minZ = 150;              // 最低不穿地板
        this.maxZ = 12000;            // 最高（可升到户型上方俯瞰）

        this.keys = { f: false, b: false, l: false, r: false, run: false, up: false, down: false };
        this.boundaryCheck = null;    // (x, y) => bool，返回该点是否可站立；null 则不限制

        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._tmp = new THREE.Vector3();

        this._bind();
    }

    _bind() {
        this._onMouseMove = (e) => {
            if (!this.locked) return;
            this.yaw -= e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));
        };
        this._onLockChange = () => {
            this.locked = document.pointerLockElement === this.dom;
            this.onLockChange?.(this.locked);
        };
        this._onKey = (down) => (e) => {
            switch (e.code) {
                case 'KeyW': case 'ArrowUp': this.keys.f = down; break;
                case 'KeyS': case 'ArrowDown': this.keys.b = down; break;
                case 'KeyA': case 'ArrowLeft': this.keys.l = down; break;
                case 'KeyD': case 'ArrowRight': this.keys.r = down; break;
                case 'ShiftLeft': case 'ShiftRight': this.keys.run = down; break;
                case 'Space': this.keys.up = down; break;                    // 上升
                case 'KeyC': case 'ControlLeft': this.keys.down = down; break; // 下降
                default: return;
            }
            e.preventDefault();
        };
        this._onKeyDown = this._onKey(true);
        this._onKeyUp = this._onKey(false);

        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('pointerlockchange', this._onLockChange);
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
    }

    /** 请求指针锁定，进入漫游 */
    lock() {
        this.dom.requestPointerLock?.();
    }

    /** 退出漫游 */
    unlock() {
        if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
    }

    /** 把相机放到某点（视点高度），可选让它朝向某个水平方向 */
    teleport(x, y, lookYaw) {
        this.camera.position.set(x, y, this.eyeHeight);
        if (typeof lookYaw === 'number') this.yaw = lookYaw;
        this.pitch = 0;
        this._applyOrientation();
    }

    /** 让视角朝向某个世界点（用于切房间时正对房间中心） */
    lookAt(x, y) {
        const dx = x - this.camera.position.x;
        const dy = y - this.camera.position.y;
        if (dx || dy) this.yaw = Math.atan2(dy, dx);
        this.pitch = 0;
        this._applyOrientation();
    }

    _applyOrientation() {
        const cp = Math.cos(this.pitch);
        this._forward.set(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch));
        this._tmp.copy(this.camera.position).add(this._forward);
        this.camera.up.set(0, 0, 1);
        this.camera.lookAt(this._tmp);
    }

    /** 每帧调用：按键位移 + 应用朝向 */
    update(dt) {
        if (!this.enabled) return;

        // 水平前向与右向（无俯仰分量，走路不飞天）
        this._forward.set(Math.cos(this.yaw), Math.sin(this.yaw), 0);
        this._right.set(Math.sin(this.yaw), -Math.cos(this.yaw), 0);

        let mx = 0, my = 0;
        if (this.keys.f) { mx += this._forward.x; my += this._forward.y; }
        if (this.keys.b) { mx -= this._forward.x; my -= this._forward.y; }
        if (this.keys.r) { mx += this._right.x; my += this._right.y; }
        if (this.keys.l) { mx -= this._right.x; my -= this._right.y; }

        const run = this.keys.run ? this.runFactor : 1;

        if (mx || my) {
            const len = Math.hypot(mx, my) || 1;
            const step = this.moveSpeed * run * dt;
            let nx = this.camera.position.x + (mx / len) * step;
            let ny = this.camera.position.y + (my / len) * step;

            // 边界：先整体试探，再分轴试探，实现贴墙滑动而非卡死
            if (this.boundaryCheck) {
                if (this.boundaryCheck(nx, ny)) {
                    this.camera.position.x = nx; this.camera.position.y = ny;
                } else if (this.boundaryCheck(nx, this.camera.position.y)) {
                    this.camera.position.x = nx;
                } else if (this.boundaryCheck(this.camera.position.x, ny)) {
                    this.camera.position.y = ny;
                }
            } else {
                this.camera.position.x = nx; this.camera.position.y = ny;
            }
        }

        // 垂直升降（空格上升 / C 下降），夹在 [minZ, maxZ]
        const vz = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
        if (vz) {
            const nz = this.camera.position.z + vz * this.verticalSpeed * run * dt;
            this.camera.position.z = Math.max(this.minZ, Math.min(this.maxZ, nz));
        }

        this._applyOrientation();
    }

    dispose() {
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('pointerlockchange', this._onLockChange);
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        this.unlock();
    }
}
