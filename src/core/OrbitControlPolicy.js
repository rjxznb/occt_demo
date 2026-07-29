export function configureOrbitControls(controls) {
    if (!controls) return controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.6;
    controls.panSpeed = 0.6;
    return controls;
}
