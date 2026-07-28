import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeBulgeArc,
    offsetBulgeArc,
} from '../src/components/ArcWindowGeometry.js';

function assertNear(actual, expected, label, tolerance = 1e-6) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected}, got ${actual}`);
}

test('describes a positive minor bulge arc with literal circle facts', () => {
    const arc = describeBulgeArc(
        { x: 0, y: 0, z: 0, bulge: 0.41421356237309503 },
        { x: 1000, y: 0, z: 0, bulge: 0 },
    );

    assertNear(arc.chordLength, 1000, 'chord');
    assertNear(arc.signedSweepRadians, Math.PI / 2, 'sweep');
    assertNear(arc.radius, 707.106781186548, 'radius');
    assertNear(arc.sagitta, 207.106781186548, 'sagitta');
    assertNear(arc.arcLength, 1110.720734539592, 'arc length');
    assertNear(arc.center.x, 500, 'center x');
    assertNear(arc.center.y, 500, 'center y');
    assertNear(arc.apex.x, 500, 'apex x');
    assertNear(arc.apex.y, -207.106781186548, 'apex y');
    assertNear(arc.headingDegrees, 90, 'heading');
});

test('describes the Drawing2 major negative arc without collapsing it to a minor arc', () => {
    const arc = describeBulgeArc(
        { x: -6638.686234, y: 4641.953907, z: 0, bulge: -1.455308 },
        { x: -3828.686478, y: 6031.954413, z: 0, bulge: 0 },
    );

    assertNear(arc.chordLength, 3134.9960184026254, 'chord');
    assertNear(arc.signedSweepRadians, -3.875014067205958, 'major sweep');
    assertNear(arc.radius, 1679.14130477725, 'radius');
    assertNear(arc.sagitta, 2281.192392774744, 'sagitta');
    assertNear(arc.arcLength, 6506.696979228376, 'arc length');
    assertNear(arc.center.x, -5500.624914148718, 'center x');
    assertNear(arc.center.y, 5876.592296840282, 'center y');
    assertNear(arc.apex.x, -6245.125784192925, 'apex x');
    assertNear(arc.apex.y, 7381.661722452424, 'apex y');
    assertNear(arc.headingDegrees, -63.68014011039734, 'heading');
});

test('offsets an arc concentrically while preserving its signed sweep', () => {
    const arc = describeBulgeArc(
        { x: 0, y: 0, z: 25, bulge: 0.41421356237309503 },
        { x: 1000, y: 0, z: 25, bulge: 0 },
    );
    const offset = offsetBulgeArc(arc, 900);
    const describedOffset = describeBulgeArc(offset.start, offset.end);

    assertNear(describedOffset.center.x, 500, 'offset center x');
    assertNear(describedOffset.center.y, 500, 'offset center y');
    assertNear(describedOffset.radius, 900, 'offset radius');
    assertNear(describedOffset.signedSweepRadians, Math.PI / 2, 'offset sweep');
    assert.equal(offset.start.bulge, 0.41421356237309503);
    assert.equal(offset.end.bulge, 0);
    assert.equal(offset.start.z, 25);
    assert.equal(offset.end.z, 25);
});

test('rejects zero-bulge, degenerate, and non-finite arcs and offsets', () => {
    assert.equal(describeBulgeArc(
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
    ), null);
    assert.equal(describeBulgeArc(
        { x: 0, y: 0, bulge: 1 },
        { x: 0, y: 0, bulge: 0 },
    ), null);
    assert.equal(describeBulgeArc(
        { x: Number.NaN, y: 0, bulge: 1 },
        { x: 10, y: 0, bulge: 0 },
    ), null);
    assert.equal(offsetBulgeArc(null, 10), null);
    assert.equal(offsetBulgeArc({ center: { x: 0, y: 0 } }, 0), null);
});
