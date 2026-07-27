import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { parametricApiClient } from '../services/ParametricApiClient.js';

/**
 * 参数化模型加载器
 *
 * 管线：TypeId → Template(ResId) → getGoodsDetail → parameterizedJsonUrl
 *       → modelUrlToObj → OBJ 字符串 → Three.js Group → 放入场景
 *
 * 参数化服务由 ParametricApiClient 提供。
 */

const LOG_PREFIX = '[ParamLoader]';

//==============================================================================
// 模板缓存
//==============================================================================
let templateMap = null;       // Map<TypeId, {resId, defaultSize, typeName}>
let templatePromise = null;

//==============================================================================
// 模型缓存（按 TypeId，同一 TypeId 只下载一次 OBJ）
//==============================================================================
const modelCache = new Map();        // TypeId → THREE.Group（Y-up，位于原点）
const pendingRequests = new Map();   // TypeId → Promise（飞行去重）

//==============================================================================
// OBJLoader 单例
//==============================================================================
const objLoader = new OBJLoader();

/** 构造软装的俯视平面变换：局部 XY 翻转，再绕 Z 轴旋转，最后平移。 */
export function createPlanTransform(item) {
    const bp = item?.basepoint || {};
    const position = new THREE.Vector3(bp.x ?? 0, bp.y ?? 0, bp.z ?? 0);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(Number(item?.rotate) || 0),
    );
    const scale = new THREE.Vector3(
        item?.horizontalFlip === true ? -1 : 1,
        item?.verticalFlip === true ? -1 : 1,
        1,
    );

    return new THREE.Matrix4().compose(position, quaternion, scale);
}

/** 将参数化 OBJ 的 Y-up 坐标系转换为户型场景使用的 Z-up。 */
export function createYUpToZUpTransform() {
    return new THREE.Matrix4().makeRotationX(Math.PI / 2);
}

/**
 * 根据 JSON 的 BasePoint 与 footprint 关系，计算 OBJ 在块局部坐标中的偏移。
 * BasePoint 可能是中心、角点或边中点，不能一律把模型包围盒中心移到原点。
 */
export function computeModelPlacementOffset(item, modelBox, baseScale = 1) {
    const bp = item?.basepoint || {};
    const footprintCenter = item?.footprint?.length
        ? computeFootprintCenter(item.footprint)
        : { x: bp.x ?? 0, y: bp.y ?? 0 };
    const targetWorld = new THREE.Vector3(
        footprintCenter.x,
        footprintCenter.y,
        bp.z ?? 0,
    );
    const targetLocal = targetWorld.applyMatrix4(createPlanTransform(item).invert());
    const modelCenter = modelBox.getCenter(new THREE.Vector3());
    const safeScale = Number.isFinite(baseScale) && baseScale !== 0 ? baseScale : 1;

    return new THREE.Vector3(
        targetLocal.x / safeScale - modelCenter.x,
        targetLocal.y / safeScale - modelCenter.y,
        -modelBox.min.z,
    );
}

function vectorToPlain(vector) {
    return {
        x: Number(vector?.x ?? 0),
        y: Number(vector?.y ?? 0),
        z: Number(vector?.z ?? 0),
    };
}

function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** 创建不持有 Three.js 对象引用的软装调试快照。 */
export function createParametricDebugInfo(item, templateInfo, placement) {
    const worldSize = placement.worldBox.getSize(new THREE.Vector3());
    return {
        typeId: String(item.typeId),
        softlistId: item.id ?? null,
        typeName: templateInfo.typeName ?? null,
        resId: templateInfo.resId ?? null,
        defaultSize: clonePlain(templateInfo.defaultSize ?? null),
        source: {
            basepoint: clonePlain(item.basepoint ?? null),
            footprint: clonePlain(item.footprint ?? []),
            modelParams: clonePlain(item.modelParams ?? []),
        },
        transform: {
            rotate: Number(item.rotate) || 0,
            horizontalFlip: item.horizontalFlip === true,
            verticalFlip: item.verticalFlip === true,
        },
        placement: {
            rawSize: vectorToPlain(placement.rawSize),
            baseScale: placement.baseScale,
            modelOffset: vectorToPlain(placement.modelOffset),
            worldPosition: vectorToPlain(placement.worldPosition),
            worldBounds: {
                min: vectorToPlain(placement.worldBox.min),
                max: vectorToPlain(placement.worldBox.max),
                size: vectorToPlain(worldSize),
            },
        },
    };
}



//==============================================================================
// 公开 API
//==============================================================================

export async function loadTemplate(templatePath = 'data/template.json') {
    if (templatePromise) return templatePromise;

    templatePromise = (async () => {
        console.log(`${LOG_PREFIX} 加载模板: ${templatePath}`);
        const res = await globalThis.fetch(templatePath);
        if (!res.ok) throw new Error(`模板加载失败: HTTP ${res.status}`);
        const data = await res.json();

        templateMap = new Map();
        for (const item of data.AllItemInfo || []) {
            const typeId = String(item.TypeId);
            const resList = item.ResList || [];
            if (resList.length > 0) {
                templateMap.set(typeId, {
                    resId: String(resList[0].ResId),
                    defaultSize: {
                        x: resList[0].X || 0,
                        y: resList[0].Y || 0,
                        z: resList[0].Z || 0,
                    },
                    typeName: item.TypeName || '',
                });
            }
        }
        console.log(`${LOG_PREFIX} 模板加载完成: ${templateMap.size} 个 TypeId → ResId 映射`);
        return templateMap;
    })();

    return templatePromise;
}

export function getResId(typeId) {
    if (!templateMap) return null;
    const entry = templateMap.get(String(typeId));
    return entry ? entry.resId : null;
}

export function getDefaultSize(typeId) {
    if (!templateMap) return null;
    const entry = templateMap.get(String(typeId));
    return entry ? entry.defaultSize : null;
}

//==============================================================================
// 内部：API 调用
//==============================================================================

function findParameterizedJsonUrl(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (typeof obj.parameterizedJsonUrl === 'string' && obj.parameterizedJsonUrl) {
        return obj.parameterizedJsonUrl;
    }
    for (const val of Object.values(obj)) {
        const found = findParameterizedJsonUrl(val, depth + 1);
        if (found) return found;
    }
    return null;
}

function extractObjContent(data) {
    if (!data) return null;

    // 1. 顶层 obj 字段（beinuan API 最常用格式）
    if (typeof data.obj === 'string' && data.obj.length > 100) return data.obj;

    // 2. files 嵌套对象
    if (data.files && typeof data.files === 'object') {
        for (const [name, content] of Object.entries(data.files)) {
            if (name.endsWith('.obj') && typeof content === 'string' && content.length > 100) {
                return content;
            }
        }
    }

    // 3. 递归进入 data.data
    let inner = data;
    for (let i = 0; i < 3; i++) {
        if (!inner.data || typeof inner.data !== 'object') break;
        inner = inner.data;
        if (typeof inner.obj === 'string' && inner.obj.length > 100) return inner.obj;
        if (inner.files && typeof inner.files === 'object') {
            for (const [name, content] of Object.entries(inner.files)) {
                if (name.endsWith('.obj') && typeof content === 'string' && content.length > 100) {
                    return content;
                }
            }
        }
    }

    // 4. 扫描顶层所有 .obj key
    for (const [key, val] of Object.entries(data)) {
        if (key.endsWith('.obj') && typeof val === 'string' && val.length > 100) return val;
    }

    // 5. 打印响应结构帮助调试
    console.warn(`${LOG_PREFIX}   无法提取 OBJ 内容，响应 keys:`, Object.keys(data).join(', '));
    return null;
}

//==============================================================================
// OBJ 解析
//==============================================================================

function parseObjString(objContent, typeId) {
    try {
        const group = objLoader.parse(objContent);
        group.name = `parametric-${typeId}`;

        let meshCount = 0;
        group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                meshCount++;
                const hasMaterial = child.material &&
                    !(Array.isArray(child.material) && child.material.length === 0);
                if (!hasMaterial) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xB8B0A0,
                        roughness: 0.85,
                        metalness: 0.0,
                    });
                } else if (!Array.isArray(child.material)) {
                    // 保留原有颜色，确保是 StandardMaterial（支持光照/阴影）
                    if (!child.material.isMeshStandardMaterial && !child.material.isMeshPhongMaterial) {
                        const oldColor = child.material.color ? child.material.color.getHex() : 0xB8B0A0;
                        child.material = new THREE.MeshStandardMaterial({
                            color: oldColor,
                            roughness: 0.85,
                            metalness: 0.0,
                        });
                    }
                }
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        if (meshCount === 0) {
            console.warn(`${LOG_PREFIX}   OBJ 解析结果无 mesh! TypeId=${typeId}, 内容长度=${objContent.length}`);
            return null;
        }

        // 计算包围盒确认尺寸合理
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        console.log(`${LOG_PREFIX}   OBJ 解析: ${meshCount} meshes, 包围盒 (${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);

        return group;

    } catch (err) {
        console.error(`${LOG_PREFIX}   OBJ 解析失败 TypeId=${typeId}:`, err.message);
        return null;
    }
}

//==============================================================================
// 核心管线
//==============================================================================

// 单独缓存 parameterizedJsonUrl（不依赖 modelParams）
const urlCache = new Map();  // TypeId → parameterizedJsonUrl

/** 获取某个 TypeId 的 parameterizedJsonUrl（缓存） */
async function resolveParametricUrl(typeId, apiClient) {
    const tid = String(typeId);
    if (urlCache.has(tid)) return urlCache.get(tid);

    const entry = templateMap.get(tid);
    if (!entry) return null;

    try {
        const detail = await apiClient.getGoodsDetail(entry.resId);
        const url = findParameterizedJsonUrl(detail?.data?.modelDTO ?? {})
            ?? findParameterizedJsonUrl(detail);
        if (url) {
            urlCache.set(tid, url);
            console.log(`${LOG_PREFIX} TypeId=${tid} parameterizedJsonUrl 已解析`);
        }
        return url;
    } catch (err) {
        console.warn(`${LOG_PREFIX} TypeId=${tid} ResId=${entry.resId} 参数化URL解析失败`, {
            code: err.code || 'UNKNOWN_ERROR',
            status: err.status,
            message: err.message,
        });
        return null;
    }
}

/** 缓存 key：TypeId + modelParams JSON */
function cacheKey(typeId, modelParams) {
    const paramsStr = (modelParams && modelParams.length > 0)
        ? JSON.stringify(modelParams)
        : '';
    return `${typeId}|${paramsStr}`;
}

async function fetchModelForTypeId(typeId, modelParams, apiClient) {
    if (!templateMap) {
        console.warn(`${LOG_PREFIX} 模板未加载`);
        return null;
    }

    const tid = String(typeId);
    const ck = cacheKey(tid, modelParams);

    if (modelCache.has(ck)) {
        console.log(`${LOG_PREFIX} ${tid} 命中缓存`);
        return modelCache.get(ck);
    }

    if (pendingRequests.has(ck)) {
        console.log(`${LOG_PREFIX} ${tid} 等待飞行中请求`);
        return pendingRequests.get(ck);
    }

    const promise = (async () => {
        const url = await resolveParametricUrl(tid, apiClient);
        if (!url) return null;

        const entry = templateMap.get(tid);
        const resId = entry.resId;
        console.log(`${LOG_PREFIX} TypeId=${tid} → ResId=${resId} (${entry.typeName})`);

        try {
            if (modelParams && modelParams.length > 0) {
                console.log(`${LOG_PREFIX}   params:`, modelParams.map(p => `${p.name}=${p.value}`).join(', '));
            }
            console.log(`${LOG_PREFIX}   参数化模型转换: ${url.substring(0, 80)}...`);
            const result = await apiClient.convertModel(url, modelParams);

            // 提取 OBJ
            const objContent = extractObjContent(result);
            if (!objContent) {
                console.warn(`${LOG_PREFIX}   响应中无 OBJ 内容`);
                return null;
            }
            console.log(`${LOG_PREFIX}   OBJ 内容: ${(objContent.length / 1024).toFixed(1)} KB`);

            // 解析 OBJ
            const group = parseObjString(objContent, tid);
            if (!group) {
                console.warn(`${LOG_PREFIX}   OBJ 解析后无有效 mesh`);
                return null;
            }

            group.userData = {
                type: 'parametric-softlist',
                typeId: tid,
                resId,
                typeName: entry.typeName,
                defaultSize: entry.defaultSize,
            };

            modelCache.set(ck, group);
            console.log(`${LOG_PREFIX} ✓ TypeId=${tid} (${entry.typeName}) 已缓存`);
            return group;

        } catch (err) {
            console.error(`${LOG_PREFIX} TypeId=${tid} ResId=${resId} 参数化失败`, {
                code: err.code || 'UNKNOWN_ERROR',
                status: err.status,
                message: err.message,
            });
            return null;
        }
    })();

    pendingRequests.set(ck, promise);
    promise.finally(() => pendingRequests.delete(ck));
    return promise;
}

//==============================================================================
// 场景集成
//==============================================================================

export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const {
        concurrency = 3,
        onProgress = null,
        apiClient = parametricApiClient,
    } = options;

    await loadTemplate();
    if (!templateMap || templateMap.size === 0) {
        console.warn(`${LOG_PREFIX} 模板为空，跳过参数化模型加载`);
        return [];
    }

    // 过滤软装项
    const softlistItems = (softlists || []).filter(
        item => item.kind === 'softlist' && item.typeId && item.footprint?.length >= 3
    );

    if (softlistItems.length === 0) {
        console.log(`${LOG_PREFIX} 无软装项（需要 kind=softlist + typeId + footprint）`);
        return [];
    }

    const uniqueTypeIds = [...new Set(softlistItems.map(item => String(item.typeId)))];
    console.log(`${LOG_PREFIX} 待加载: ${softlistItems.length} 软装实例, ${uniqueTypeIds.length} 唯一 TypeId`);
    console.log(`${LOG_PREFIX} TypeIds:`, uniqueTypeIds.join(', '));

    // Step 1: 预解析所有 parameterizedJsonUrl（不依赖尺寸参数）
    let resolvedCount = 0;
    for (let i = 0; i < uniqueTypeIds.length; i += concurrency) {
        const batch = uniqueTypeIds.slice(i, i + concurrency);
        await Promise.allSettled(batch.map(typeId => resolveParametricUrl(typeId, apiClient)));
        resolvedCount += batch.length;
    }
    console.log(`${LOG_PREFIX} URL 解析完成: ${urlCache.size}/${uniqueTypeIds.length} 个`);

    // Step 2: 为每个软装实例获取模型并放置（传入 modelParams 控制尺寸）
    const resultGroups = [];
    let placedCount = 0;

    for (const item of softlistItems) {
        const tid = String(item.typeId);
        const modelParams = item.modelParams || [];
        const templateModel = await fetchModelForTypeId(tid, modelParams, apiClient);
        if (!templateModel) continue;

        try {
            const rawModel = templateModel.clone(true);

            // 参数化 OBJ 使用 Y-up；户型场景使用 Z-up。必须先转换坐标轴，
            // 再计算包围盒与贴地位置，否则模型高度会落在水平面里，看起来像倒在地上。
            rawModel.applyMatrix4(createYUpToZUpTransform());


            // ── 读取转换坐标轴后的模型尺寸 ───────────────────────────────
            rawModel.updateMatrixWorld();
            const rawBox = new THREE.Box3().setFromObject(rawModel);
            const rawSize = rawBox.getSize(new THREE.Vector3());

            // ── 翻转（CAD BlockInnerInfo，2D 俯视空间 = 世界 XY 平面）───
            const vFlip = item.verticalFlip === true;
            const hFlip = item.horizontalFlip === true;

            const flipWrapper = new THREE.Group();
            const rotWrapper = new THREE.Group();

            const bp = item.basepoint;
            const cadRotateDeg = typeof item.rotate === 'number' ? item.rotate : 0;
            rotWrapper.add(rawModel);
            flipWrapper.add(rotWrapper);

            // ── 负 scale 反转面法线 → DoubleSide ───────────────────────
            if (hFlip || vFlip) {
                flipWrapper.traverse(child => {
                    if (child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => { m.side = THREE.DoubleSide; });
                    }
                });
            }

            // ── 最小保证缩放：模型若 <100 单位说明单位是米/厘米 ──────────
            const maxModelDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
            const baseScale = maxModelDim < 100 ? 1000 : 1;

            // 统一采用 2D 的 T * R * S 语义：翻转发生在模型局部 XY 平面，
            // 再随对象旋转到户型的世界方向。
            const planTransform = createPlanTransform(item);
            rawModel.position.copy(computeModelPlacementOffset(item, rawBox, baseScale));
            planTransform.decompose(
                flipWrapper.position,
                rotWrapper.quaternion,
                rotWrapper.scale,
            );
            rotWrapper.scale.multiplyScalar(baseScale);
            flipWrapper.updateMatrixWorld();
            console.log(`${LOG_PREFIX}   ${tid} basepoint=(${bp?.x?.toFixed(0) ?? '?'},${bp?.y?.toFixed(0) ?? '?'}) ` +
                `rotate=${cadRotateDeg.toFixed(1)}° ` +
                (hFlip ? '左右翻转 ' : '') + (vFlip ? '上下翻转 ' : '') +
                `model=(${rawSize.x.toFixed(1)},${rawSize.y.toFixed(1)},${rawSize.z.toFixed(1)}) ` +
                `baseScale=${baseScale}`);

            // 标记 userData
            flipWrapper.userData = {
                type: 'parametric-softlist',
                softlistId: item.id,
                typeId: tid,
            };
            flipWrapper.traverse(child => {
                if (child.isMesh) {
                    child.userData.type = child.userData.type || 'parametric-softlist';
                    child.userData.softlistId = child.userData.softlistId || item.id;
                    child.userData.typeId = child.userData.typeId || tid;
                }
            });

            sceneGroup.add(flipWrapper);
            flipWrapper.updateMatrixWorld(true);
            const worldBox = new THREE.Box3().setFromObject(flipWrapper);
            flipWrapper.userData.debugInfo = createParametricDebugInfo(
                item,
                templateModel.userData,
                {
                    rawSize,
                    baseScale,
                    modelOffset: rawModel.position,
                    worldPosition: flipWrapper.getWorldPosition(new THREE.Vector3()),
                    worldBox,
                },
            );
            resultGroups.push(flipWrapper);
            placedCount++;
        } catch (err) {
            console.warn(`${LOG_PREFIX} 放置失败 ${item.id}:`, err.message);
        }
    }

    console.log(`${LOG_PREFIX} 完成: ${placedCount}/${softlistItems.length} 参数化模型已放入场景`);
    if (placedCount === 0 && modelCache.size === 0) {
        console.warn(`${LOG_PREFIX} ⚠ 无任何参数化模型！请确认模板 TypeId 匹配且参数化服务可用`);
    } else if (placedCount === 0 && modelCache.size > 0) {
        console.warn(`${LOG_PREFIX} ⚠ 模型已加载但未放置！请检查 softlist 的 kind/typeId/footprint 字段`);
    }

    return resultGroups;
}

//==============================================================================
// 工具函数
//==============================================================================

/** 计算 footprint 矩形两条边的真实长度（mm），不受旋转影响 */
function computeFootprintRectSize(footprint) {
    if (footprint.length < 3) return { x: 100, y: 100 };

    // 取第一个角点 → 第二个角点的距离作为 side1
    const p0 = footprint[0];
    const p1 = footprint[1];
    const side1 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);

    // 取第二个角点 → 第三个角点的距离作为 side2
    const p2 = footprint[2];
    const side2 = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

    // 返回 {x: 长边, y: 短边}（对应模型的 X/Z 或 X/Y 基准方向）
    return {
        x: Math.max(side1, side2),
        y: Math.min(side1, side2),
    };
}

/** 计算 footprint 的中心点（fallback，优先用 basepoint） */
function computeFootprintCenter(footprint) {
    let cx = 0, cy = 0;
    for (const p of footprint) { cx += p.x; cy += p.y; }
    return { x: cx / footprint.length, y: cy / footprint.length };
}

export function getCacheStats() {
    return {
        templateEntries: templateMap?.size ?? 0,
        cachedModels: modelCache.size,
        pendingRequests: pendingRequests.size,
    };
}

// 暴露到 window 方便在控制台调试
if (typeof window !== 'undefined') {
    window.__parametricDebug = {
        templateMap,
        modelCache,
        pendingRequests,
        getCacheStats,
    };
}
