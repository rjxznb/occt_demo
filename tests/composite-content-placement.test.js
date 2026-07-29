import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createCompositeContentPlacement } from '../src/components/CompositeContentPlacement.js';

function child(index, count = 2) {
    return {
        instanceId: `window_list:1#segment:${index}`,
        sourceList: 'window_list',
        sourceIndex: 1,
        typeId: index === 1 ? '140c' : '1401',
        parentInstanceId: 'window_list:1',
        compositeSegmentIndex: index,
        compositeSegmentCount: count,
        generatedFromTypeId: '140d02',
    };
}

function railingChild(index, count = 2) {
    return {
        ...child(index, count),
        typeId: index === 1 ? '140e02' : '140e01',
        generatedFromTypeId: '140e',
    };
}

function fallbackMap() {
    const fallback = new THREE.Mesh();
    fallback.visible = true;
    return { fallback, map: new Map([['window_list:1', fallback]]) };
}

test('commits one composite stage and hides its fallback only after every child is placed', () => {
    const scene = new THREE.Group();
    const { fallback, map } = fallbackMap();
    const instances = [child(0), child(1)];
    const coordinator = createCompositeContentPlacement(instances, scene, map);
    const roots = instances.map(() => new THREE.Group());

    instances.forEach((instance, index) => {
        const target = coordinator.getPlacementTarget(instance);
        assert.notEqual(target, scene);
        target.add(roots[index]);
        coordinator.onInstancePlaced(instance, roots[index]);
        assert.equal(fallback.visible, true, 'fallback stays visible while staging');
    });
    const result = coordinator.finalize({
        groups: roots,
        summary: { placed: 2, fallbackVisible: 0 },
        failures: [],
    });

    assert.equal(scene.children.length, 1);
    assert.equal(scene.children[0].userData.parentInstanceId, 'window_list:1');
    assert.deepEqual(scene.children[0].children, roots);
    assert.equal(fallback.visible, false);
    assert.ok(roots.every(root => root.userData.contentModelRoot === true));
    assert.deepEqual(result.groups, roots);
    assert.equal(result.summary.placed, 2);
    assert.equal(result.summary.fallbackVisible, 0);
});

test('rolls back every staged root and counts one fallback when one child is missing', () => {
    const scene = new THREE.Group();
    const { fallback, map } = fallbackMap();
    const instances = [child(0), child(1)];
    const coordinator = createCompositeContentPlacement(instances, scene, map);
    const root = new THREE.Group();
    coordinator.getPlacementTarget(instances[0]).add(root);
    coordinator.onInstancePlaced(instances[0], root);

    const result = coordinator.finalize({
        groups: [root],
        summary: { placed: 1, fallbackVisible: 0 },
        failures: [{
            sourceList: 'window_list', sourceIndex: 1, typeId: '140c',
            resId: '2423932', resourceKind: 'parametric-obj',
            errorCode: 'PARAMETRIC_CONVERSION_FAILED',
        }],
    });

    assert.equal(scene.children.length, 0);
    assert.equal(root.parent, null);
    assert.equal(fallback.visible, true);
    assert.deepEqual(result.groups, []);
    assert.equal(result.summary.placed, 0);
    assert.equal(result.summary.fallbackVisible, 1);
    assert.equal(result.failures.length, 1);
});

test('retains the parent fallback when no composite child reaches placement', () => {
    const scene = new THREE.Group();
    const { fallback, map } = fallbackMap();
    const coordinator = createCompositeContentPlacement([child(0), child(1)], scene, map);

    const result = coordinator.finalize({
        groups: [],
        summary: { placed: 0, fallbackVisible: 0, localGeometry: 1 },
        failures: [],
    });

    assert.equal(scene.children.length, 0);
    assert.equal(fallback.visible, true);
    assert.equal(result.summary.placed, 0);
    assert.equal(result.summary.fallbackVisible, 1);
});

test('keeps every child failure but counts its shared visible fallback once', () => {
    const scene = new THREE.Group();
    const { map } = fallbackMap();
    const instances = [child(0), child(1)];
    const coordinator = createCompositeContentPlacement(instances, scene, map);
    const failures = instances.map(instance => ({
        sourceList: instance.sourceList,
        sourceIndex: instance.sourceIndex,
        typeId: instance.typeId,
        resId: instance.typeId === '140c' ? '2423932' : '2406313',
        resourceKind: 'parametric-obj',
        errorCode: 'PARAMETRIC_CONVERSION_FAILED',
    }));

    assert.equal(coordinator.hasFallback(instances[0]), false);
    assert.equal(coordinator.hasFallback(instances[1]), false);
    const result = coordinator.finalize({
        groups: [], summary: { placed: 0, fallbackVisible: 0 }, failures,
    });

    assert.equal(result.failures.length, 2);
    assert.equal(result.summary.fallbackVisible, 1);
});

test('ordinary content keeps immediate room insertion and fallback hiding behavior', () => {
    const scene = new THREE.Group();
    const fallback = new THREE.Mesh();
    fallback.visible = true;
    const fallbacks = new Map([['door_list:0', fallback]]);
    const ordinary = {
        instanceId: 'door_list:0', sourceList: 'door_list', sourceIndex: 0,
        typeId: '1302',
    };
    const coordinator = createCompositeContentPlacement([ordinary], scene, fallbacks);
    const root = new THREE.Group();

    assert.equal(coordinator.getPlacementTarget(ordinary), scene);
    assert.equal(coordinator.hasFallback(ordinary), true);
    scene.add(root);
    coordinator.onInstancePlaced(ordinary, root);
    const result = coordinator.finalize({
        groups: [root], summary: { placed: 1, fallbackVisible: 0 }, failures: [],
    });

    assert.equal(root.userData.contentModelRoot, true);
    assert.equal(fallback.visible, false);
    assert.deepEqual(result.groups, [root]);
    assert.equal(result.summary.placed, 1);
    assert.equal(result.summary.fallbackVisible, 0);
});

test('commits generated 140e railing children through the same atomic stage', () => {
    const scene = new THREE.Group();
    const { fallback, map } = fallbackMap();
    const instances = [railingChild(0), railingChild(1)];
    const coordinator = createCompositeContentPlacement(instances, scene, map);
    const roots = instances.map(() => new THREE.Group());

    instances.forEach((instance, index) => {
        const target = coordinator.getPlacementTarget(instance);
        assert.notEqual(target, scene);
        target.add(roots[index]);
        coordinator.onInstancePlaced(instance, roots[index]);
    });
    const result = coordinator.finalize({
        groups: roots,
        summary: { placed: 2, fallbackVisible: 0 },
        failures: [],
    });

    assert.equal(scene.children.length, 1);
    assert.deepEqual(scene.children[0].children, roots);
    assert.equal(fallback.visible, false);
    assert.deepEqual(result.groups, roots);
});
