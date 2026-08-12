const DEFAULT_ASPECT = 16 / 9;
const MIN_HORIZONTAL_FOV = 30;
const MAX_HORIZONTAL_FOV = 120;

const degreesToRadians = degrees => degrees * Math.PI / 180;
const radiansToDegrees = radians => radians * 180 / Math.PI;

export function normalizeAspect(aspect) {
    const numeric = Number(aspect);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ASPECT;
}

export function clampPanoramaHorizontalFov(degrees) {
    const numeric = Number(degrees);
    if (!Number.isFinite(numeric)) return 90;
    return Math.min(MAX_HORIZONTAL_FOV, Math.max(MIN_HORIZONTAL_FOV, numeric));
}

export function horizontalToVerticalFov(horizontalDegrees, aspect) {
    const horizontalRadians = degreesToRadians(Number(horizontalDegrees));
    const verticalRadians = 2 * Math.atan(
        Math.tan(horizontalRadians / 2) / normalizeAspect(aspect),
    );
    return radiansToDegrees(verticalRadians);
}

export function verticalToHorizontalFov(verticalDegrees, aspect) {
    const verticalRadians = degreesToRadians(Number(verticalDegrees));
    const horizontalRadians = 2 * Math.atan(
        Math.tan(verticalRadians / 2) * normalizeAspect(aspect),
    );
    return radiansToDegrees(horizontalRadians);
}
