import test from 'node:test';
import assert from 'node:assert/strict';

import {
    hideSidebar,
    resizeSidebar,
    showSidebar,
} from '../src/components/SidebarPresentation.js';

function fakeSidebar(initialClasses = [], initialStyle = {}) {
    const classes = new Set(initialClasses);
    return {
        classList: {
            add(value) { classes.add(value); },
            remove(value) { classes.delete(value); },
            contains(value) { return classes.has(value); },
        },
        style: {
            ...initialStyle,
            removeProperty(name) { delete this[name]; },
        },
    };
}

test('hide removes visibility and stale horizontal positioning', () => {
    const sidebar = fakeSidebar(['visible'], { right: '0px', width: '360px' });

    hideSidebar(sidebar);

    assert.equal(sidebar.classList.contains('visible'), false);
    assert.equal(sidebar.style.right, undefined);
    assert.equal(sidebar.style.width, '360px');
});

test('show clears stale positioning and makes the sidebar visible', () => {
    const sidebar = fakeSidebar([], { right: '-360px' });

    showSidebar(sidebar);

    assert.equal(sidebar.classList.contains('visible'), true);
    assert.equal(sidebar.style.right, undefined);
});

test('resize changes width without writing right', () => {
    const sidebar = fakeSidebar(['visible']);

    resizeSidebar(sidebar, 420);

    assert.equal(sidebar.style.width, '420px');
    assert.equal(sidebar.style.right, undefined);
});
