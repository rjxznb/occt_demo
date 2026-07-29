function clearRight(sidebar) {
    sidebar?.style?.removeProperty?.('right');
}

export function showSidebar(sidebar) {
    clearRight(sidebar);
    sidebar?.classList?.add('visible');
}

export function hideSidebar(sidebar) {
    sidebar?.classList?.remove('visible');
    clearRight(sidebar);
}

export function resizeSidebar(sidebar, width) {
    if (!sidebar?.style || !Number.isFinite(width)) return;
    sidebar.style.width = `${width}px`;
}
