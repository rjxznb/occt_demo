const DEFAULT_HEIGHT_PRESETS = Object.freeze({
    child: 1200,
    standard: 1500,
    high: 1800,
});

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sameValue(a, b) {
    return Object.is(a, b);
}

function pointPatch(original, working) {
    const patch = {};
    for (const key of [
        'name', 'x', 'y', 'z', 'yaw', 'pitch', 'fov',
        'roomIndex', 'roomName', 'valid', 'invalidReason',
    ]) {
        if (!sameValue(original[key], working[key])) patch[key] = clone(working[key]);
    }
    return patch;
}

function viewChanged(original, working) {
    return ['yaw', 'pitch', 'fov'].some(key => !sameValue(original[key], working[key]));
}

export class PanoramaEditController {
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
        this.mode = 'browse';
        this.pointId = null;
        this.snapshot = null;
        this.workingPoint = null;
        this.workingView = null;
        this.lastValidation = null;
    }

    getState() {
        return clone({
            mode: this.mode,
            pointId: this.pointId,
            workingPoint: this.workingPoint,
            workingView: this.workingView,
            lastValidation: this.lastValidation,
        });
    }

    enter(pointId, liveView = null) {
        if (this.mode === 'edit') return false;
        const state = this.store?.getState?.();
        const point = state?.points?.find(candidate => candidate.id === pointId);
        if (!point || point.valid === false) return false;
        const storedView = state.views?.[pointId] ?? {
            yaw: point.yaw ?? 0,
            pitch: point.pitch ?? 0,
            fov: point.fov ?? 90,
        };
        const view = { ...storedView };
        for (const key of ['yaw', 'pitch', 'fov']) {
            const value = Number(liveView?.[key]);
            if (Number.isFinite(value)) view[key] = value;
        }
        this.mode = 'edit';
        this.pointId = pointId;
        this.snapshot = { point: clone(point), view: clone(view) };
        this.workingPoint = clone(point);
        this.workingView = clone(view);
        this.lastValidation = { valid: true, code: 'OK' };
        return true;
    }

    _preview() {
        this.onPreview({
            point: clone(this.workingPoint),
            view: clone(this.workingView),
        });
    }

    applyMovement(intent = {}, deltaSeconds = 0, liveView = null) {
        if (this.mode !== 'edit') return { valid: false, code: 'NOT_EDITING' };
        this._syncWorkingView(liveView);
        const forward = Number(intent.forward) || 0;
        const right = Number(intent.right) || 0;
        const magnitude = Math.hypot(forward, right);
        if (!magnitude || !(deltaSeconds > 0)) return { valid: true, code: 'NO_MOVEMENT' };

        const distance = this.movementSpeed * Number(deltaSeconds);
        const normalizedForward = forward / Math.max(1, magnitude);
        const normalizedRight = right / Math.max(1, magnitude);
        const yaw = (Number(this.workingView.yaw) || 0) * Math.PI / 180;
        const candidate = {
            ...this.workingPoint,
            x: this.workingPoint.x
                + (Math.cos(yaw) * normalizedForward + Math.sin(yaw) * normalizedRight) * distance,
            y: this.workingPoint.y
                + (Math.sin(yaw) * normalizedForward - Math.cos(yaw) * normalizedRight) * distance,
        };
        const validation = this.validator(candidate);
        this.lastValidation = clone(validation);
        if (!validation?.valid) return clone(validation);

        this.workingPoint = {
            ...candidate,
            roomIndex: validation.roomIndex ?? candidate.roomIndex,
            roomName: validation.roomName ?? candidate.roomName,
            valid: true,
            invalidReason: null,
        };
        this._preview();
        return clone(validation);
    }

    updateView(view = {}) {
        if (this.mode !== 'edit') return false;
        if (!this._syncWorkingView(view)) return false;
        this._preview();
        return true;
    }

    _syncWorkingView(view = null) {
        const source = view ?? {};
        const next = { ...this.workingView };
        for (const key of ['yaw', 'pitch', 'fov']) {
            const value = Number(source[key]);
            if (Number.isFinite(value)) next[key] = value;
        }
        if (!viewChanged(this.workingView, next)) return false;
        this.workingView = next;
        return true;
    }

    _setHeight(height) {
        if (this.mode !== 'edit') return false;
        const nextHeight = clamp(Number(height), this.minHeight, this.maxHeight);
        if (!Number.isFinite(nextHeight) || sameValue(nextHeight, this.workingPoint.z)) return false;
        this.workingPoint = { ...this.workingPoint, z: nextHeight };
        this._preview();
        return true;
    }

    setHeightPreset(name) {
        if (!Object.prototype.hasOwnProperty.call(this.heightPresets, name)) return false;
        return this._setHeight(this.heightPresets[name]);
    }

    nudgeHeight(delta) {
        return this._setHeight(this.workingPoint?.z + (Number(delta) || 0));
    }

    async save() {
        if (this.mode !== 'edit') return false;
        const patch = pointPatch(this.snapshot.point, this.workingPoint);
        const pointSaved = Object.keys(patch).length
            ? await this.store.updatePoint(this.pointId, patch)
            : false;
        const viewSaved = viewChanged(this.snapshot.view, this.workingView)
            ? await this.store.updateView(this.pointId, this.workingView)
            : false;
        this._finish();
        return pointSaved || viewSaved;
    }

    cancel() {
        if (this.mode !== 'edit') return false;
        this.onPreview(clone(this.snapshot));
        this._finish();
        return true;
    }

    _finish() {
        this.mode = 'browse';
        this.pointId = null;
        this.snapshot = null;
        this.workingPoint = null;
        this.workingView = null;
        this.lastValidation = null;
    }
}
