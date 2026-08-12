const DEFAULT_HEIGHT_PRESETS = Object.freeze({ child: 1200, standard: 1500, high: 1800 });

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export class AiViewEditController {
    constructor({
        store,
        validator = () => ({ valid: true, code: 'OK' }),
        onPreview = () => {},
        movementSpeed = 120,
        heightPresets = DEFAULT_HEIGHT_PRESETS,
        minHeight = 900,
        maxHeight = 2100,
    } = {}) {
        this.store = store;
        this.validator = validator;
        this.onPreview = onPreview;
        this.movementSpeed = Math.max(0, Number(movementSpeed) || 0);
        this.heightPresets = { ...DEFAULT_HEIGHT_PRESETS, ...heightPresets };
        this.minHeight = Number(minHeight);
        this.maxHeight = Number(maxHeight);
        this._finish();
    }

    getState() {
        return clone({
            mode: this.mode,
            viewId: this.viewId,
            workingView: this.workingView,
            lastValidation: this.lastValidation,
        });
    }

    enter(viewId, liveView = null) {
        if (this.mode === 'edit') return false;
        const view = this.store?.getState?.().views?.find(candidate => candidate.id === viewId);
        if (!view || view.valid === false || ['excluded', 'disabled'].includes(view.status)) return false;
        const pose = clone(view);
        for (const key of ['yaw', 'pitch', 'fov']) {
            const value = Number(liveView?.[key]);
            if (Number.isFinite(value)) pose[key] = value;
        }
        this.mode = 'edit';
        this.viewId = viewId;
        this.snapshot = { point: clone(view), view: { yaw: pose.yaw, pitch: pose.pitch, fov: pose.fov } };
        this.workingView = pose;
        this.lastValidation = { valid: true, code: 'OK' };
        return true;
    }

    applyMovement(intent = {}, deltaSeconds = 0, liveView = null) {
        if (this.mode !== 'edit') return { valid: false, code: 'NOT_EDITING' };
        this.updateView(liveView, false);
        const forward = Number(intent.forward) || 0;
        const right = Number(intent.right) || 0;
        const magnitude = Math.hypot(forward, right);
        if (!magnitude || !(deltaSeconds > 0)) return { valid: true, code: 'NO_MOVEMENT' };
        const distance = this.movementSpeed * Number(deltaSeconds);
        const yaw = Number(this.workingView.yaw) * Math.PI / 180;
        const candidate = {
            ...this.workingView,
            x: this.workingView.x + (
                Math.cos(yaw) * forward / Math.max(1, magnitude)
                + Math.sin(yaw) * right / Math.max(1, magnitude)
            ) * distance,
            y: this.workingView.y + (
                Math.sin(yaw) * forward / Math.max(1, magnitude)
                - Math.cos(yaw) * right / Math.max(1, magnitude)
            ) * distance,
        };
        const validation = this.validator(candidate);
        this.lastValidation = clone(validation);
        if (!validation?.valid) return clone(validation);
        this.workingView = {
            ...candidate,
            roomIndex: validation.roomIndex ?? candidate.roomIndex,
            roomName: validation.roomName ?? candidate.roomName,
            valid: true,
            invalidReason: null,
        };
        this._preview();
        return clone(validation);
    }

    updateView(view = null, preview = true) {
        if (this.mode !== 'edit' || !view) return false;
        let changed = false;
        const next = { ...this.workingView };
        for (const key of ['yaw', 'pitch', 'fov']) {
            const value = Number(view[key]);
            if (Number.isFinite(value) && value !== next[key]) {
                next[key] = value;
                changed = true;
            }
        }
        if (!changed) return false;
        this.workingView = next;
        if (preview) this._preview();
        return true;
    }

    setHeightPreset(name) {
        if (!(name in this.heightPresets)) return false;
        return this._setHeight(this.heightPresets[name]);
    }

    nudgeHeight(delta) {
        return this._setHeight(Number(this.workingView?.z) + (Number(delta) || 0));
    }

    _setHeight(value) {
        if (this.mode !== 'edit' || !Number.isFinite(Number(value))) return false;
        const height = clamp(Number(value), this.minHeight, this.maxHeight);
        if (height === this.workingView.z) return false;
        this.workingView = { ...this.workingView, z: height };
        this._preview();
        return true;
    }

    _preview() {
        this.onPreview({
            point: clone(this.workingView),
            view: {
                yaw: this.workingView.yaw,
                pitch: this.workingView.pitch,
                fov: this.workingView.fov,
            },
        });
    }

    async save() {
        if (this.mode !== 'edit') return false;
        const validation = this.validator(this.workingView);
        this.lastValidation = clone(validation);
        if (!validation?.valid) return clone(validation);
        const saved = await this.store.updateView(this.viewId, {
            x: this.workingView.x,
            y: this.workingView.y,
            z: this.workingView.z,
            yaw: this.workingView.yaw,
            pitch: this.workingView.pitch,
            fov: this.workingView.fov,
            roomIndex: validation.roomIndex ?? this.workingView.roomIndex,
            roomName: validation.roomName ?? this.workingView.roomName,
            valid: true,
            invalidReason: null,
            status: this.workingView.source === 'auto' ? 'adjusted' : this.workingView.status,
        });
        this._finish();
        return saved;
    }

    cancel() {
        if (this.mode !== 'edit') return false;
        this.onPreview(clone(this.snapshot));
        this._finish();
        return true;
    }

    _finish() {
        this.mode = 'browse';
        this.viewId = null;
        this.snapshot = null;
        this.workingView = null;
        this.lastValidation = null;
    }
}
