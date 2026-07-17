import * as THREE from 'three';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WallFactory } from './WallFactory.js';
import { DoorWindowFactory } from './DoorWindowFactory.js';
import { FloorFactory } from './FloorFactory.js';
import { Softlist3DFactory } from './Softlist3DFactory.js';

// 全局共享：Evaluator 无状态，没必要每次布尔都新建
const evaluator = new Evaluator();
evaluator.useGroups = false;

const CSG_ATTRIBUTES = ['position', 'normal', 'uv'];

// 面积低于此值的三角形视为退化并剔除。场景单位是毫米，1e-4 mm² 已远小于任何
// 有意义的面。
const MIN_TRIANGLE_AREA = 1e-4;

/**
 * 剔除退化（零面积/极小面积）与含 NaN 的三角形。
 *
 * three-bvh-csg 的输出里会夹带零面积三角形——把这样的结果再喂回去做下一次布尔，
 * 它在计算面法线时会拿到 null 并抛出
 * "Cannot read properties of null (reading 'dot')"。而这个异常会被 CSG 的 catch
 * 吞掉，表现为「洞静默地没挖出来」。所以每次布尔前都必须先清理。
 *
 * @param {THREE.BufferGeometry} geometry - 非索引几何体
 * @returns {THREE.BufferGeometry} 清理后的几何体（原对象在有剔除时被释放）
 */
function removeDegenerateTriangles(geometry) {
    const pos = geometry.attributes.position;
    const triCount = pos.count / 3;

    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

    const keep = [];
    for (let t = 0; t < triCount; t++) {
        const i = t * 3;
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);

        if (!isFinite(a.x + a.y + a.z + b.x + b.y + b.z + c.x + c.y + c.z)) continue;

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        if (cross.crossVectors(ab, ac).length() / 2 < MIN_TRIANGLE_AREA) continue;

        keep.push(t);
    }

    if (keep.length === triCount) return geometry;

    const cleaned = new THREE.BufferGeometry();
    for (const name of CSG_ATTRIBUTES) {
        const attr = geometry.attributes[name];
        if (!attr) continue;

        const size = attr.itemSize;
        const array = new Float32Array(keep.length * 3 * size);
        keep.forEach((t, k) => {
            for (let v = 0; v < 3; v++) {
                const src = (t * 3 + v) * size;
                const dst = (k * 3 + v) * size;
                for (let s = 0; s < size; s++) array[dst + s] = attr.array[src + s];
            }
        });
        cleaned.setAttribute(name, new THREE.BufferAttribute(array, size));
    }

    geometry.dispose();
    return cleaned;
}

/**
 * 把 mesh 的变换烘焙进几何体，并统一属性集。
 * WallFactory 直接用世界坐标建几何，DoorWindowFactory 则把 z 偏移挂在 mesh.position 上，
 * 统一烘焙后才能安全地合并与做布尔。
 * @param {THREE.Mesh} mesh
 * @returns {THREE.BufferGeometry|null}
 */
function bakeGeometry(mesh) {
    if (!mesh?.geometry?.attributes?.position) return null;

    let geometry = mesh.geometry.clone();

    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);

    // mergeGeometries 要求所有几何体的属性集与索引状态一致
    if (geometry.index) {
        const nonIndexed = geometry.toNonIndexed();
        geometry.dispose();
        geometry = nonIndexed;
    }

    for (const name of Object.keys(geometry.attributes)) {
        if (!CSG_ATTRIBUTES.includes(name)) geometry.deleteAttribute(name);
    }

    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv) {
        const count = geometry.attributes.position.count;
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }

    // CSG 的输出里会夹带退化三角形，喂回去做下一次布尔会让引擎抛异常
    return removeDegenerateTriangles(geometry);
}

/** 计算 mesh 在世界坐标下的包围盒 */
function worldBox(mesh) {
    mesh.updateMatrix();
    return new THREE.Box3()
        .setFromBufferAttribute(mesh.geometry.attributes.position)
        .applyMatrix4(mesh.matrix);
}

/**
 * 把减数按“互不重叠”分组。
 *
 * 合并只对互不相交的实体成立：把重叠的实体拼进同一个缓冲区会得到非流形几何，
 * three-bvh-csg 的内外判定随即失效，洞会挖不出来。
 * 门窗为了挖穿墙体各自向外扩了 15mm，相邻的因此可能互相重叠，不能无脑合并。
 *
 * 用包围盒做保守分组（贪心染色）：同组内两两不重叠，可以安全合并。
 * 实际数据下通常只会分出 2~3 组，仍远优于逐个布尔。
 *
 * @param {Array<THREE.Mesh>} meshes
 * @returns {Array<Array<THREE.Mesh>>}
 */
function groupDisjoint(meshes) {
    const items = meshes.map(mesh => ({ mesh, box: worldBox(mesh) }));
    const batches = [];

    for (const item of items) {
        const batch = batches.find(b => !b.some(o => o.box.intersectsBox(item.box)));
        if (batch) {
            batch.push(item);
        } else {
            batches.push([item]);
        }
    }

    return batches.map(b => b.map(o => o.mesh));
}

/**
 * 把一组互不相交的实体合并成单个几何体。
 *
 * 这是性能的关键：合并只是缓冲区拼接（零布尔成本），之后一次减法即可挖掉整组。
 * 若逐个做布尔，被减数会不断膨胀，每一轮都要重建一次 BVH。
 *
 * @param {Array<THREE.Mesh>} meshes
 * @returns {THREE.BufferGeometry|null}
 */
function mergeMeshGeometries(meshes) {
    const geometries = meshes
        .map(bakeGeometry)
        .filter(Boolean);

    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];

    const merged = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());

    return merged;
}
/**
 * CSG 布尔运算
 */
export class CSGOperations {
    /**
     * 验证 mesh 是否可用于布尔运算
     * @param {THREE.Mesh} mesh
     * @returns {boolean}
     */
    static isValidMesh(mesh) {
        return !!mesh?.geometry?.attributes?.position?.count;
    }

    /**
     * A 减去 B。B 传几何体而非 mesh —— 调用方通常已经把若干个减数合并成了一个几何体。
     * @param {THREE.Mesh} meshA - 被减数
     * @param {THREE.BufferGeometry} geometryB - 减数（世界坐标）
     * @returns {THREE.Mesh} 结果 mesh；失败时原样返回 meshA
     */
    static subtractGeometry(meshA, geometryB) {
        try {
            if (!CSGOperations.isValidMesh(meshA) || !geometryB?.attributes?.position?.count) {
                throw new Error('输入几何体无效');
            }

            const geometryA = bakeGeometry(meshA);
            const brushA = new Brush(geometryA);
            const brushB = new Brush(geometryB);
            brushA.updateMatrixWorld();
            brushB.updateMatrixWorld();

            const target = new Brush();
            evaluator.evaluate(brushA, brushB, SUBTRACTION, target);

            if (!target.geometry?.attributes?.position?.count) {
                throw new Error('布尔运算返回空几何体');
            }

            const result = new THREE.Mesh(target.geometry, meshA.material);
            result.userData = { ...meshA.userData };

            geometryA.dispose();
            return result;

        } catch (error) {
            console.error('CSG减法失败，返回原始mesh:', error.message);
            return meshA;
        }
    }

    /**
     * A 减去一组互不相交的 mesh：先合并再一次减掉
     * @param {THREE.Mesh} meshA - 被减数
     * @param {Array<THREE.Mesh>} meshesB - 减数集合
     * @returns {THREE.Mesh}
     */
    static subtractAll(meshA, meshesB) {
        const valid = meshesB.filter(CSGOperations.isValidMesh);
        if (valid.length === 0) return meshA;

        let current = meshA;

        for (const batch of groupDisjoint(valid)) {
            const cutter = mergeMeshGeometries(batch);
            if (!cutter) continue;

            const next = CSGOperations.subtractGeometry(current, cutter);
            cutter.dispose();

            // 释放上一轮由本函数产出的中间几何体。
            // 只动本函数造出来的中间体：传入的 meshA 由调用方持有（result.outlineMesh /
            // result.wallMeshes 仍引用它），不能在这里 dispose。
            // next === current 说明这一次减法失败、原样返回，也不能 dispose。
            if (current !== meshA && next !== current) {
                current.geometry.dispose();
            }

            current = next;
        }

        return current;
    }
}

/**
 * 房间渲染器 - 负责渲染房间几何体和墙面
 */
export class RoomRenderer {
    constructor(sceneManager, options = {}) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.getScene();

        // 全局变换参数
        this.globalScale = 1;
        this.globalCenterX = 0;
        this.globalCenterY = 0;
        this.isScaleSet = false;
        this.sceneGroup = null; // 用于整体缩放的场景组
    }

    /**
     * 渲染房间数据
     * @param {Object} data - 包含outline，rooms，doorwindows的数据
     * @param {Object} wallSelector - 墙面选择器实例
     * @returns {Promise<Object>} 渲染结果
     */
    async render(data, wallSelector) {
        try {
            const result = {
                outlineMesh: null,
                roomMeshes: [],
                wallMeshes: [],
                doorMeshes: [],
                windowMeshes: [],
                floorMeshes: []
            };

            // 如果场景组不存在，创建新的场景组用于整体缩放
            if (!this.sceneGroup) {
                this.sceneGroup = new THREE.Group();
                this.scene.add(this.sceneGroup);
            } else if (this.sceneGroup.children.length > 0) {
                // 如果场景组已存在且有内容，说明已经渲染过，直接返回
                console.log('3D场景已存在缓存，使用现有渲染结果');
                return result;
            }

            // 1. 创建外轮廓 mesh（但先不添加到场景）
            const outlineRings = data.outline?.outlineRings;
            if (outlineRings?.outer?.length > 0) {
                result.outlineMesh = this.createOutlineMesh(outlineRings.outer, outlineRings.holes);
            }


            // 2. 创建真正的门窗mesh
            let doorWindowMeshes = { doors: [], windows: [] };
            if (data.doorWindows) {
                doorWindowMeshes = this.createDoorWindowMeshes(data.doorWindows.doors, data.doorWindows.windows);
                result.doorMeshes = doorWindowMeshes.doors;
                result.windowMeshes = doorWindowMeshes.windows;
            }

            // 3. 创建用于挖门窗的 mesh，这里得到的mesh只用于挖洞，而不用于渲染，
            // 因为这里扩大了一定的宽度，避免有些墙体挖不透，因为float类型存在误差；
            let doorWindowSubMeshes = { doors: [], windows: [] };
            if (data.doorWindows) {
                doorWindowSubMeshes = this.createDoorWindowMeshes(data.doorWindows.processed_doors, data.doorWindows.processed_windows);
            }

            // 3. 创建房间 mesh 用于布尔运算（只做减数，不渲染）。
            //    必须在竖向上完全包住外壳（-25 ~ 2775），否则外壳底部那段挖不穿，
            //    会在每个房间底下留一层白色残料盖住地板。故从 -100 挤到 2900。
            let roomMeshes = [];
            if (data.rooms && data.rooms.roomPoints) {
                roomMeshes = this.createRoomMeshes(data.rooms.roomPoints, 3000);
                roomMeshes.forEach(m => { m.position.z = -100; });
                result.roomMeshes = roomMeshes;
            }

            // 创建地板mesh
            let floorMeshes = [];
            if (data.rooms && data.rooms.roomPoints) {
                floorMeshes = FloorFactory.createFloorMeshes(data.rooms.roomPoints, 0);
                result.floorMeshes = floorMeshes;
            }
            // 地板保持在 z=0，与墙脚贴合、无悬空缝隙。
            // 门槛/墙脚处地板与门窗、墙共面：靠地板材质的 polygonOffset 把地板往深处推，
            // 让墙/门稳定压过它（地板本就该在墙下），从而不 z-fighting。
            // 外壳底部残料已由房间减数（-100~2900）挖穿，不会盖住地板。
            const roomNames = data.rooms?.roomNames || [];
            for (let i = 0; i < floorMeshes.length; i++) {
                floorMeshes[i].position.z = 0;
                // 标记类型与房间名，供应用模板时识别地板、按房间上色
                floorMeshes[i].userData.type = 'floor';
                floorMeshes[i].userData.roomName = roomNames[floorMeshes[i].userData.roomIndex] || '';
                this.sceneGroup.add(floorMeshes[i]);
            }
            wallSelector.addWalls(floorMeshes);

            // 4. 外轮廓挖洞：房间与门窗各自互不相交，
            //    因此各自合并成一个几何体后，一次减法即可，无需逐个累积
            if (result.outlineMesh) {
                let baseMesh = result.outlineMesh;

                if (roomMeshes.length > 0) {
                    baseMesh = CSGOperations.subtractAll(baseMesh, roomMeshes);
                }

                // 必须用向外扩过的 processed 版本挖洞：原始尺寸的门窗会让洞壁与
                // 门窗自身的面完全共面，从而 z-fighting。
                // （旧代码这里误用了显示用的门窗，靠 BSP 引擎 epsilon=30.1 的粗糙度掩盖了问题）
                const allCutters = [...doorWindowSubMeshes.doors, ...doorWindowSubMeshes.windows];
                if (allCutters.length > 0) {
                    baseMesh = CSGOperations.subtractAll(baseMesh, allCutters);
                }

                this.sceneGroup.add(baseMesh);
                result.finalMesh = baseMesh;
            }

            // 5. 渲染墙面
            if (data.rooms && data.rooms.roomPoints) {
                result.wallMeshes = this.createWallMeshes(data.rooms.roomPoints);

                // 门窗的世界包围盒只算一次，供所有墙面复用
                const cutterBounds = this.computeDoorWindowBounds(doorWindowSubMeshes);
                result.wallMeshes.forEach((wallMesh) => {
                    if (!wallMesh) return;

                    const cutters = this.findIntersectingDoorWindows(wallMesh, cutterBounds);
                    const finalMesh = cutters.length > 0
                        ? CSGOperations.subtractAll(wallMesh, cutters)
                        : wallMesh;

                    this.sceneGroup.add(finalMesh);
                    wallSelector.addWall(finalMesh);
                });

                // 单独添加门窗（不挖洞）
                if (doorWindowMeshes.doors) {
                    doorWindowMeshes.doors.forEach(mesh => {
                        if (mesh && CSGOperations.isValidMesh(mesh)) {
                            this.sceneGroup.add(mesh);
                            wallSelector.addWall(mesh);
                        }
                    });

                }
                if (doorWindowMeshes.windows) {
                    doorWindowMeshes.windows.forEach(mesh => {
                        if (mesh && CSGOperations.isValidMesh(mesh)) {
                            this.sceneGroup.add(mesh);
                            wallSelector.addWall(mesh);
                        }
                    });
                }
            }
            // 因为对外墙挖洞，返回的实例对象其实已经不是原来的mesh啦，
            // 所以之前的一些userData全都不存在啦，我们需要自己再设置；
            // （outline 数据缺失时 outlineMesh 为 null，与上面的创建守卫保持一致）
            if (result.outlineMesh) {
                result.outlineMesh.userData.type = "outWall";
            }

            // 5.5 软装占位 box：软装没有真实 3D 模型，用挤出的矮柱体占位
            if (data.softlists?.softlists) {
                result.softlistMeshes = Softlist3DFactory.createBoxes(data.softlists.softlists);
                result.softlistMeshes.forEach(mesh => this.sceneGroup.add(mesh));
            }

            // 6. 开启阴影。CSG 会产出全新的 mesh，所以统一在最后遍历设置，
            //    避免在各处创建点上遗漏。
            this.sceneGroup.traverse(object => {
                if (object.isMesh) {
                    object.castShadow = true;
                    object.receiveShadow = true;
                }
            });

            // 7. 调整相机视角，并按场景实际尺度拟合阴影相机
            this.adjustCamera();

            const bounds = new THREE.Box3().setFromObject(this.sceneGroup);
            this.sceneManager.fitShadowToScene(bounds);

            return result;

        } catch (error) {
            console.error('房间渲染失败:', error);
            throw error;
        }
    }

    /**
     * 由点数组构建闭合轮廓
     * @param {Array} points - 点数组
     * @param {Function} Ctor - THREE.Shape 或 THREE.Path
     * @returns {THREE.Shape|THREE.Path|null}
     */
    buildContour(points, Ctor) {
        const converted = this.convertPointFormat(points);
        if (converted.length < 3) return null;

        const contour = new Ctor();
        contour.moveTo(converted[0].x, converted[0].y);
        for (let i = 1; i < converted.length; i++) {
            contour.lineTo(converted[i].x, converted[i].y);
        }
        contour.closePath();

        return contour;
    }

    /**
     * 创建外轮廓mesh
     *
     * 外轮廓是「房间外扩墙厚后的并集」，其边界通常不止一个环：面积最大的是外环，
     * 其余是内环（房间之间没被墙体覆盖到的空隙）。内环必须作为 Shape 的 holes
     * 表达，不能和外环拼进同一条路径——那会得到自交的畸形，挤出后带着退化三角形，
     * 后续 three-bvh-csg 会直接抛异常（而异常被 catch 吞掉，洞就静默地挖不出来）。
     *
     * @param {Array} outerRing - 外环点数组
     * @param {Array<Array>} holeRings - 内环点数组
     * @returns {THREE.Mesh|null} 外轮廓mesh
     */
    createOutlineMesh(outerRing, holeRings = []) {
        try {
            const shape = this.buildContour(outerRing, THREE.Shape);
            if (!shape) {
                console.error('外轮廓外环无效');
                return null;
            }

            for (const ring of holeRings) {
                const hole = this.buildContour(ring, THREE.Path);
                if (hole) shape.holes.push(hole);
            }

            const extrudeSettings = {
                steps: 1,
                depth: 2800,  // 设置为200mm厚度，与墙体高度成比例
                bevelEnabled: false
            };

            const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            geometry.computeVertexNormals();

            // 外壳（外墙）：暖白 PBR，和内墙同色，响应环境光
            const material = new THREE.MeshStandardMaterial({
                color: 0xEFEBE4,
                roughness: 0.9,
                metalness: 0.0,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);

            // 外壳仅下移 2mm，让顶面与墙段(z≈0，顶 2800)基本齐平——不能多移，
            // 否则外壳顶面（墙体）低于墙段顶面（墙面），会露出一道白唇。
            // 外壳底部那段（z=-2~0）由房间减数（-100~2900）贯穿挖穿，不留残料。
            mesh.position.z = -2;
            
            return mesh;

        } catch (error) {
            console.error('外轮廓创建失败:', error);
            return null;
        }
    }

    /**
     * 创建房间meshes（用于CSG布尔运算）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @returns {Array} 房间mesh数组
     */
    createRoomMeshes(roomPointsArray, height) {
        const roomMeshes = [];

        roomPointsArray.forEach((roomPoints, index) => {
            try {
                const convertedPoints = roomPoints.map(point => {
                    if (Array.isArray(point) && point.length >= 2) {
                        return { x: point[0], y: point[1], z: point[2] || 0 };
                    }
                    return { x: 0, y: 0, z: 0 };
                });

                const shape = new THREE.Shape();
                const firstPoint = convertedPoints[0];
                shape.moveTo(firstPoint.x, firstPoint.y);

                for (let i = 1; i < convertedPoints.length; i++) {
                    const point = convertedPoints[i];
                    shape.lineTo(point.x, point.y);
                }

                shape.lineTo(firstPoint.x, firstPoint.y);

                const extrudeSettings = {
                    steps: 1,
                    depth: height,  // 设置为200mm厚度
                    bevelEnabled: false
                };

                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geometry.computeVertexNormals();

                // 使用红色材质用于CSG运算（与旧版本保持一致）
                const material = new THREE.MeshLambertMaterial({
                    color: 0xffffff,
                    side: THREE.DoubleSide,
                    polygonOffset: true,
                    polygonOffsetFactor:-2,
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.roomIndex = index;
                roomMeshes.push(mesh);

            } catch (error) {
                console.error(`房间 ${index} 创建失败:`, error);
            }
        });

        return roomMeshes;
    }

    /**
     * 预计算所有门窗的世界包围盒。
     * 原先每面墙都对每个门窗重算一次 computeBoundingBox，111 面墙 × 24 个门窗 = 2664 次重复计算。
     * @param {Object} doorWindowSubMeshes - {doors: [], windows: []}
     * @returns {Array<{mesh: THREE.Mesh, box: THREE.Box3}>}
     */
    computeDoorWindowBounds(doorWindowSubMeshes) {
        const all = [
            ...(doorWindowSubMeshes.doors || []),
            ...(doorWindowSubMeshes.windows || [])
        ];

        return all
            .filter(CSGOperations.isValidMesh)
            .map(mesh => ({ mesh, box: worldBox(mesh) }));
    }

    /**
     * 找出与指定墙面包围盒相交的门窗
     * @param {THREE.Mesh} wallMesh - 墙面mesh
     * @param {Array<{mesh: THREE.Mesh, box: THREE.Box3}>} cutterBounds - 预计算的门窗包围盒
     * @returns {Array<THREE.Mesh>} 相交的门窗mesh
     */
    findIntersectingDoorWindows(wallMesh, cutterBounds) {
        const wallBox = worldBox(wallMesh);

        return cutterBounds
            .filter(({ box }) => wallBox.intersectsBox(box))
            .map(({ mesh }) => mesh);
    }


    /**
     * 设置进度更新回调
     * @param {Function} callback - 进度回调函数 (current, total) => {}
     */
    setProgressCallback(callback) {
        this.onProgressUpdate = callback;
    }

    /**
     * 设置渲染完成回调
     * @param {Function} callback - 完成回调函数
     */
    setRenderCompleteCallback(callback) {
        this.onRenderComplete = callback;
    }

    /**
     * 创建墙面meshes（原方法，保留作为备用）
     * @param {Array} roomPointsArray - 房间点数据数组
     * @returns {Array} 墙面mesh数组
     */
    createWallMeshes(roomPointsArray) {
        const wallMeshes = [];

        roomPointsArray.forEach((roomPoints, roomIndex) => {
            try {
                const segments = WallFactory.analyzeWallSegments(roomPoints);
                
                segments.forEach(segment => {
                    let wallMesh = null;

                    if (segment.type === 'arc') {
                        // 弧形墙面
                        const points = segment.points.map(point => [
                            point[0],
                            point[1],
                            0
                        ]);

                        wallMesh = WallFactory.createArcWall(points, {
                            color: 0xEFEBE4,  // 暖白墙面
                            height: 2800
                        });
                        
                        // 设置弧形墙面位置稍微向上偏移，避免Z-fighting
                        if (wallMesh) {
                            wallMesh.position.z += 0.01;
                        }

                    } else {
                        // 直线墙面
                        const startPoint = [
                            segment.startPoint[0],
                            segment.startPoint[1],
                            0
                        ];
                        const endPoint = [
                            segment.endPoint[0],
                            segment.endPoint[1],
                            0
                        ];

                        wallMesh = WallFactory.createStraightWall(startPoint, endPoint, {
                            color: 0xEFEBE4,  // 暖白墙面
                            height: 2800
                        });
                        
                        // 设置墙面位置稍微向上偏移，避免Z-fighting
                        if (wallMesh) {
                            wallMesh.position.z += 0.01;
                        }
                    }

                    if (wallMesh) {
                        wallMesh.userData.roomIndex = roomIndex;
                        wallMesh.userData.segmentType = segment.type;
                        wallMeshes.push(wallMesh);
                    }
                });

            } catch (error) {
                console.error(`房间 ${roomIndex} 墙面创建失败:`, error);
            }
        });

        return wallMeshes;
    }

    /**
     * 创建门窗meshes
     * @param {Object} doorWindowData - 门窗数据
     * @returns {Object} {doors: Array, windows: Array}  
     */
    createDoorWindowMeshes(doors, windows) {
        try {
            console.log('开始创建门窗，门数量:', doors?.length || 0, '窗数量:', windows?.length || 0);

            // 获取门窗数据
            const doorData = doors || [];
            const windowData = windows || [];

            // 使用工厂类批量创建门窗
            const result = DoorWindowFactory.createDoorWindowBatch(
                doorData,
                windowData
            );

            console.log(`门窗创建完成，门: ${result.doors.length}个，窗: ${result.windows.length}个`);
            
            return result;

        } catch (error) {
            console.error('门窗创建失败:', error);
            return { doors: [], windows: [] };
        }
    }

    /**
     * 转换点格式
     * @param {Array} points - 原始点数组
     * @returns {Array} 转换后的点数组
     */
    convertPointFormat(points) {
        return points.map(point => {
            if (Array.isArray(point) && point.length >= 2) {
                return { x: point[0], y: point[1], z: point[2] || 0 };
            } else if (typeof point === 'object' && point.x !== undefined && point.y !== undefined) {
                return { x: point.x, y: point.y, z: point.z || 0 };
            }
            return { x: 0, y: 0, z: 0 };
        });
    }


    /**
     * 计算点集边界
     * @param {Array} points - 点数组
     * @returns {Object} 边界信息
     */
    calculateBounds(points) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);

        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }

    /**
     * 调整相机位置
     */
    adjustCamera() {
        const camera = this.sceneManager.getCamera();
        camera.position.set(0, -5000, 15000);
        
        const controls = this.sceneManager.controls;
        if (controls) {
            controls.target.set(0, 0, 0);
            controls.update();
        }
    }

    /**
     * 清理所有3D渲染对象
     * @param {THREE.Scene} scene - Three.js场景对象
     */
    dispose(scene) {
        if (this.sceneGroup) {
            // 递归清理所有子对象的几何体和材质
            this.sceneGroup.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            // 从场景中移除场景组
            scene.remove(this.sceneGroup);
            
            // 清空场景组
            this.sceneGroup.clear();
            this.sceneGroup = null;
            
            console.log('3D渲染对象已清理');
        }
    }
}