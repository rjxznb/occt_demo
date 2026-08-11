import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { SceneManager } from '../src/core/SceneManager.js';

test('white model mode overrides rendering without replacing authored materials', () => {
    const previousOverride = new THREE.MeshBasicMaterial({ color: 0x123456 });
    const manager = Object.create(SceneManager.prototype);
    manager.scene = new THREE.Scene();
    manager.scene.overrideMaterial = previousOverride;
    manager.materialRestorationEnabled = true;
    manager.whiteModelOriginalMaterials = new Map();
    manager.whiteModelMaterialCache = new Map();
    manager.whiteModelOwnedMaterials = new Set();
    manager.groundGrid = { visible: true };
    manager.groundGridVisibleBeforeWhiteModel = null;
    manager.whiteModelHiddenObjects = new Map();
    manager.whiteModelLightingState = null;
    manager.gtaoPass = { enabled: false };
    manager.renderer = { toneMappingExposure: 1.08, shadowMap: {} };
    manager.scene.background = new THREE.Color(0x123456);
    manager.scene.environmentIntensity = 0.55;
    manager.scene.fog = new THREE.Fog(0xabcdef, 10, 20);
    manager.keyLight = new THREE.DirectionalLight(0xff0000, 2.1);
    manager.fillLight = new THREE.DirectionalLight(0x00ff00, 0.8);
    manager.hemiLight = new THREE.HemisphereLight(0x0000ff, 0xff0000, 0.9);
    manager.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);

    const wallSurface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    wallSurface.userData.whiteModelSurfaceOverlay = true;
    const colorMap = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const authoredMaterial = new THREE.MeshStandardMaterial({
        color: 0x123456,
        map: colorMap,
        normalMap,
        metalness: 0.6,
        roughness: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -3,
    });
    const furniture = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), authoredMaterial);
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x88ccff });
    glassMaterial.userData.contentMaterialIsGlass = true;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glassMaterial);
    manager.scene.add(wallSurface, furniture, glass);

    assert.equal(manager.setMaterialRestorationEnabled(false), false);
    assert.equal(manager.isMaterialRestorationEnabled(), false);
    assert.equal(manager.scene.overrideMaterial, previousOverride);
    assert.notEqual(furniture.material, authoredMaterial);
    assert.equal(furniture.material.color.getHex(), 0xd2cfca);
    assert.equal(furniture.material.map, null);
    assert.equal(furniture.material.normalMap, normalMap);
    assert.equal(furniture.material.metalness, 0);
    assert.equal(furniture.material.roughness, 0.82);
    assert.equal(furniture.material.polygonOffset, true);
    assert.equal(furniture.material.polygonOffsetFactor, -2);
    assert.equal(furniture.material.polygonOffsetUnits, -3);
    assert.equal(glass.material, glassMaterial);
    assert.equal(manager.gtaoPass.enabled, true);
    assert.equal(manager.groundGrid.visible, false);
    assert.equal(wallSurface.visible, false);
    assert.equal(furniture.visible, true);
    assert.equal(manager.scene.background.getHex(), 0xe7e4df);
    assert.equal(manager.scene.fog.color.getHex(), 0xe7e4df);
    assert.equal(manager.renderer.toneMappingExposure, 1.04);
    assert.equal(manager.keyLight.intensity, 2.15);
    assert.equal(manager.fillLight.intensity, 0.4);
    assert.equal(manager.hemiLight.intensity, 0.52);
    assert.equal(manager.ambientLight.intensity, 0.06);

    const lateMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff });
    const lateFurniture = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lateMaterial);
    manager.scene.add(lateFurniture);
    manager.applyWhiteModelMaterials(lateFurniture);
    assert.notEqual(lateFurniture.material, lateMaterial);
    assert.equal(lateFurniture.material.color.getHex(), 0xd2cfca);

    assert.equal(manager.setMaterialRestorationEnabled(true), true);
    assert.equal(manager.scene.overrideMaterial, previousOverride);
    assert.equal(manager.isMaterialRestorationEnabled(), true);
    assert.equal(furniture.material, authoredMaterial);
    assert.equal(glass.material, glassMaterial);
    assert.equal(manager.gtaoPass.enabled, false);
    assert.equal(manager.groundGrid.visible, true);
    assert.equal(wallSurface.visible, true);
    assert.equal(manager.whiteModelHiddenObjects.size, 0);
    assert.equal(manager.scene.background.getHex(), 0x123456);
    assert.equal(manager.scene.fog.color.getHex(), 0xabcdef);
    assert.equal(manager.scene.environmentIntensity, 0.55);
    assert.equal(manager.renderer.toneMappingExposure, 1.08);
    assert.equal(manager.keyLight.color.getHex(), 0xff0000);
    assert.equal(manager.keyLight.intensity, 2.1);
    assert.equal(manager.fillLight.color.getHex(), 0x00ff00);
    assert.equal(manager.fillLight.intensity, 0.8);
    assert.equal(manager.hemiLight.color.getHex(), 0x0000ff);
    assert.equal(manager.hemiLight.groundColor.getHex(), 0xff0000);
    assert.equal(manager.hemiLight.intensity, 0.9);
    assert.equal(manager.ambientLight.intensity, 0.15);
    assert.equal(manager.whiteModelLightingState, null);
    assert.equal(lateFurniture.material, lateMaterial);

    wallSurface.geometry.dispose();
    furniture.geometry.dispose();
    glass.geometry.dispose();
    lateFurniture.geometry.dispose();
    colorMap.dispose();
    normalMap.dispose();
    authoredMaterial.dispose();
    glassMaterial.dispose();
    lateMaterial.dispose();
    previousOverride.dispose();
});
