const MOVEMENT_KEYS = new Map([
    ['KeyW', 'forward'],
    ['ArrowUp', 'forward'],
    ['KeyS', 'backward'],
    ['ArrowDown', 'backward'],
    ['KeyA', 'left'],
    ['ArrowLeft', 'left'],
    ['KeyD', 'right'],
    ['ArrowRight', 'right'],
]);

export class PanoramaInputPolicy {
    constructor() {
        this.mode = 'browse';
        this.pressed = new Set();
    }

    setMode(mode) {
        const nextMode = mode === 'edit' ? 'edit' : 'browse';
        if (this.mode === nextMode) return false;
        this.mode = nextMode;
        this.reset();
        return true;
    }

    handleKeyDown(event) {
        if (this.mode !== 'edit') return null;
        const command = MOVEMENT_KEYS.get(event?.code);
        if (!command) return null;
        event.preventDefault?.();
        this.pressed.add(command);
        return command;
    }

    handleKeyUp(event) {
        const command = MOVEMENT_KEYS.get(event?.code);
        if (!command) return null;
        if (this.mode === 'edit') event.preventDefault?.();
        this.pressed.delete(command);
        return command;
    }

    getMovementIntent() {
        return {
            forward: Number(this.pressed.has('forward')) - Number(this.pressed.has('backward')),
            right: Number(this.pressed.has('right')) - Number(this.pressed.has('left')),
        };
    }

    reset() {
        this.pressed.clear();
    }
}
