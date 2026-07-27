import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/**
 * 参数化模型加载器
 *
 * 将 parametric-lab 的参数化模型管线集成到 occt_demo 的 3D 场景中。
 * 管线：TypeId → Template(ResId) → getGoodsDetail → parameterizedJsonUrl
 *       → modelUrlToObj → OBJ 字符串 → Three.js Group
 *
 * 依赖 parametric-lab 后端运行在 http://localhost:3100
 */

const BACKEND_URL = 'http://localhost:3100';

//------------------------------------------------------------------------------
// 模板缓存（单例）
//------------------------------------------------------------------------------
let templateMap = null;       // Map<TypeId, {resId, defaultSize}>
let templatePromise = null;

//------------------------------------------------------------------------------
// 模型缓存（按 TypeId 去重，同一 TypeId 的模型只下载一次）
//------------------------------------------------------------------------------
const modelCache = new Map();       // TypeId → THREE.Group (原始模板)
const pendingRequests = new Map();  // TypeId → Promise (飞行中请求去重)

//------------------------------------------------------------------------------
// OBJLoader 单例
//------------------------------------------------------------------------------
const objLoader = new OBJLoader();

//==============================================================================
// 公开 API
//==============================================================================

/**
 * 加载模板 JSON，构建 TypeId → ResId 映射。
 * 只加载一次，重复调用返回同一个 Promise。
 */
export async function loadTemplate(templatePath = '/data/template.json') {
    if (templatePromise) return templatePromise;

    templatePromise = (async () => {
        const res = await fetch(templatePath);
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

        console.log(`[ParametricModelLoader] 模板已加载: ${templateMap.size} 个 TypeId → ResId 映射`);
        return templateMap;
    })();

    return templatePromise;
}

/**
 * 根据 TypeId 获取 ResId。
 */
export function getResId(typeId) {
    if (!templateMap) return null;
    const entry = templateMap.get(String(typeId));
    return entry ? entry.resId : null;
}

/**
 * 根据 TypeId 获取默认尺寸（来自模板的 SizeSampleModelMap / ResList）。
 */
export function getDefaultSize(typeId) {
    if (!templateMap) return null;
    const entry = templateMap.get(String(typeId));
    return entry ? entry.defaultSize : null;
}

//==============================================================================
// 内部：API 调用
//==============================================================================

/**
 * GET /api/getGoodsDetail?id=<resId>
 * 获取商品的 parameterizedJsonUrl。
 */
async function fetchGoodsDetail(resId) {
    const res = await fetch(`${BACKEND_URL}/api/getGoodsDetail?id=${encodeURIComponent(resId)}`);
    if (!res.ok) throw new Error(`getGoodsDetail(${resId}) HTTP ${res.status}`);
    return res.json();
}

/**
 * 在对象树中递归搜索 parameterizedJsonUrl。
 */
function findParameterizedJsonUrl(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return null;
    if (typeof obj.parameterizedJsonUrl === 'string' && obj.parameterizedJsonUrl) {
        return obj.parameterizedJsonUrl;
    }
    for (const val of Object.values(obj)) {
        const found = findParameterizedJsonUrl(val, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * POST /api/modelUrlToObj
 * 将参数化 URL 转为 OBJ 文件。
 * 使用默认参数（不传 parameters），让后端使用模型原始尺寸。
 */
async function fetchModelObj(parameterizedJsonUrl) {
    const res = await fetch(`${BACKEND_URL}/api/modelUrlToObj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parameterizedJsonUrl }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`modelUrlToObj HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return res.json();
}

/**
 * 从 modelUrlToObj 的响应中提取第一个 .obj 文件内容。
 * 支持多种响应形状（嵌套 files / 顶层 key / data.data 包装等）。
 */
function extractObjContent(data) {
    if (!data) return null;

    // 1. 嵌套 files 对象
    if (data.files && typeof data.files === 'object') {
        for (const [name, content] of Object.entries(data.files)) {
            if (name.endsWith('.obj') && typeof content === 'string') return content;
        }
    }

    // 2. 顶层 .obj key（beinuan API 直接返回的格式）
    if (typeof data.obj === 'string' && data.obj.length > 0) return data.obj;

    // 3. data.data 包装
    let inner = data;
    while (inner.data && typeof inner.data === 'object') {
        inner = inner.data;
        if (typeof inner.obj === 'string' && inner.obj.length > 0) return inner.obj;
        if (inner.files && typeof inner.files === 'object') {
            for (const [name, content] of Object.entries(inner.files)) {
                if (name.endsWith('.obj') && typeof content === 'string') return content;
            }
        }
    }

    // 4. 扫描顶层所有 .obj 结尾的 key
    for (const [key, val] of Object.entries(data)) {
        if (key.endsWith('.obj') && typeof val === 'string' && val.length > 0) return val;
    }

    return null;
}

//==============================================================================
// OBJ 解析
//==============================================================================

/**
 * 将 OBJ 字符串解析为 Three.js Group。
 * 自动处理材质：如果没有材质或材质为空，应用默认 PBR 材质。
 * 将 Y-up 模型旋转为 Z-up（occt_demo 坐标系）。
 */
function parseObjString(objContent, typeId) {
    return new Promise((resolve, reject) => {
        try {
            const group = objLoader.parse(objContent);
            group.name = `parametric-${typeId}`;

            group.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    // 如果 OBJ 没有材质或材质为空数组，给一个默认材质
                    const hasMaterial = child.material &&
                        !(Array.isArray(child.material) && child.material.length === 0);
                    if (!hasMaterial) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xB8B0A0,
                            roughness: 0.85,
                            metalness: 0.0,
                        });
                    }
                    // 确保材质属性完整性
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(m => ensurePBRMaterial(m));
                    } else {
                        child.material = ensurePBRMaterial(child.material);
                    }
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // 坐标转换: Y-up → Z-up
            // OCCT 场景 Z 轴向上，OBJ 默认 Y 轴向上
            group.rotation.set(-Math.PI / 2, 0, 0);

            resolve(group);
        } catch (error) {
            reject(error);
        }
    });
}

/** 确保材质是 PBR 类型（用于阴影、光照），保留原有颜色/贴图 */
function ensurePBRMaterial(mat) {
    if (mat.isMeshStandardMaterial || mat.isMeshPhongMaterial) return mat;
    const pbr = new THREE.MeshStandardMaterial({
        color: mat.color?.getHex() ?? 0xB8B0A0,
        roughness: mat.roughness ?? 0.85,
        metalness: mat.metalness ?? 0.0,
        map: mat.map || null,
        transparent: mat.transparent || false,
        opacity: mat.opacity ?? 1.0,
        side: mat.side ?? THREE.FrontSide,
    });
    mat.dispose?.();
    return pbr;
}

//==============================================================================
// 核心：TypeId → 3D 模型
//==============================================================================

/**
 * 完整的参数化模型获取管线。
 * 结果缓存在 modelCache 中（按 TypeId），相同 TypeId 只请求一次。
 *
 * @param {string} typeId - 软装的 TypeId
 * @returns {Promise<THREE.Group|null>} 返回位于原点、Y-up 的模型 Group，
 *                                      调用方需要自行 clone 后放到场景中
 */
async function fetchModelForTypeId(typeId) {
    if (!templateMap) {
        console.warn('[ParametricModelLoader] 模板未加载，请先调用 loadTemplate()');
        return null;
    }

    const tid = String(typeId);

    // 检查缓存
    if (modelCache.has(tid)) {
        return modelCache.get(tid);
    }

    // 飞行中请求去重
    if (pendingRequests.has(tid)) {
        return pendingRequests.get(tid);
    }

    const promise = (async () => {
        const entry = templateMap.get(tid);
        if (!entry) {
            console.warn(`[ParametricModelLoader] TypeId "${tid}" 不在模板中，跳过`);
            return null;
        }

        const resId = entry.resId;
        console.log(`[ParametricModelLoader] 获取模型: TypeId=${tid} ResId=${resId} (${entry.typeName})`);

        try {
            // Step 1: Get goods detail → find parameterizedJsonUrl
            const detail = await fetchGoodsDetail(resId);
            const url = findParameterizedJsonUrl(detail?.data?.modelDTO ?? {})
                ?? findParameterizedJsonUrl(detail);
            if (!url) {
                console.warn(`[ParametricModelLoader] TypeId ${tid}: 无 parameterizedJsonUrl`);
                return null;
            }

            // Step 2: modelUrlToObj → OBJ content
            const result = await fetchModelObj(url);
            const objContent = extractObjContent(result);
            if (!objContent) {
                console.warn(`[ParametricModelLoader] TypeId ${tid}: 响应中无 OBJ 内容`);
                // 打印响应 keys 帮助调试
                if (result) {
                    console.log('  响应 keys:', Object.keys(result).join(', '));
                }
                return null;
            }

            // Step 3: Parse OBJ → Three.js Group
            const group = await parseObjString(objContent, tid);
            group.userData = {
                type: 'parametric-softlist',
                typeId: tid,
                resId: resId,
                typeName: entry.typeName,
                defaultSize: entry.defaultSize,
                sourceUrl: url,
            };

            modelCache.set(tid, group);
            console.log(`[ParametricModelLoader] ✓ TypeId=${tid} (${entry.typeName}) 模型已缓存` +
                ` — ${(objContent.length / 1024).toFixed(1)} KB`);
            return group;

        } catch (err) {
            console.error(`[ParametricModelLoader] TypeId ${tid} 获取失败:`, err.message);
            return null;
        }
    })();

    pendingRequests.set(tid, promise);

    // 无论成功失败都清除飞行中标记
    promise.finally(() => {
        pendingRequests.delete(tid);
    });

    return promise;
}

//==============================================================================
// 场景集成
//==============================================================================

/**
 * 为所有软装项创建参数化 3D 模型并添加到场景中。
 *
 * 策略：
 * 1. 先收集所有软装的 TypeId，去重后批量预加载模型
 * 2. 对每个软装项 clone 一个模型实例，放到 footprint 位置
 * 3. 根据 footprint 尺寸与模板默认尺寸的比值做缩放
 * 4. 加载失败的项保留占位 box（由调用方负责保留）
 *
 * @param {Array} softlists - parse_data.SoftLists 中 kind==='softlist' 的项
 * @param {THREE.Group} sceneGroup - 场景根节点（用于添加模型）
 * @param {Object} options
 * @param {number} options.concurrency - 并发请求数，默认 3
 * @param {Function} options.onProgress - 进度回调 (loaded, total)
 * @returns {Promise<Array<THREE.Group>>} 成功添加的模型实例数组
 */
export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const {
        concurrency = 3,
        onProgress = null,
    } = options;

    // 确保模板已加载
    await loadTemplate();

    // 过滤软装项并收集唯一 TypeId
    const softlistItems = (softlists || []).filter(
        item => item.kind === 'softlist' && item.typeId && item.footprint?.length >= 3
    );

    if (softlistItems.length === 0) {
        console.log('[ParametricModelLoader] 没有软装项需要加载');
        return [];
    }

    // 去重 TypeId
    const uniqueTypeIds = [...new Set(softlistItems.map(item => String(item.typeId)))];
    console.log(`[ParametricModelLoader] 待加载: ${softlistItems.length} 个软装实例, ${uniqueTypeIds.length} 个唯一 TypeId`);

    // Step 1: 批量预加载模型（带并发限制）
    let loadedCount = 0;
    for (let i = 0; i < uniqueTypeIds.length; i += concurrency) {
        const batch = uniqueTypeIds.slice(i, i + concurrency);
        await Promise.allSettled(batch.map(typeId => fetchModelForTypeId(typeId)));
        loadedCount += batch.length;
        if (onProgress) {
            onProgress(Math.min(loadedCount, uniqueTypeIds.length), uniqueTypeIds.length);
        }
    }

    // Step 2: 为每个软装实例创建模型 clone 并定位
    const resultGroups = [];
    let placedCount = 0;

    for (const item of softlistItems) {
        const tid = String(item.typeId);
        const templateModel = modelCache.get(tid);
        if (!templateModel) continue;  // 模型加载失败，保留占位 box

        try {
            const instance = templateModel.clone(true);

            // 计算在场景中的位置与缩放
            const footprintCenter = computeFootprintCenter(item.footprint);
            const footprintSize = computeFootprintSize(item.footprint);
            const defaultSize = getDefaultSize(tid);

            // 缩放：用 footprint 与模板默认尺寸的比值
            // defaultSize 单位是 cm，场景单位是 mm
            let scaleX = 1, scaleY = 1, scaleZ = 1;
            if (defaultSize && defaultSize.x > 0 && defaultSize.y > 0) {
                const defaultSizeMM = { x: defaultSize.x * 10, y: defaultSize.y * 10 };
                scaleX = footprintSize.x / defaultSizeMM.x;
                scaleY = footprintSize.y / defaultSizeMM.y;
                scaleZ = (scaleX + scaleY) / 2;
            }

            // 软装的旋转角度（来自 CAD 数据，绕 XY 平面法线 = 绕 Z 轴）
            const itemRotate = typeof item.rotate === 'number' ? item.rotate : 0;

            // 应用变换（Z-up 坐标系）
            // OBJ 模型已在 parseObjString 中绕 X 轴旋转 -90° 转为 Z-up
            // 场景 Z 轴向上，footprint 在 XY 平面
            instance.position.set(footprintCenter.x, footprintCenter.y, 1);  // z=1 略微离地
            // 顺序：先 scale，再 Z 旋转（软装朝向），模型自身的 Y→Z 旋转已在 template clone 中
            instance.rotation.z += itemRotate;
            instance.scale.set(
                Math.max(scaleX, 0.1),
                Math.max(scaleY, 0.1),
                Math.max(scaleZ, 0.1),
            );

            // 标记
            instance.userData = {
                ...instance.userData,
                type: 'parametric-softlist',
                softlistId: item.id,
                typeId: tid,
                footprintCenter,
                footprintSize,
            };
            // 递归确保所有子 mesh 也被标记
            instance.traverse(child => {
                if (child.isMesh) {
                    child.userData.type = child.userData.type || 'parametric-softlist';
                    child.userData.softlistId = child.userData.softlistId || item.id;
                    child.userData.typeId = child.userData.typeId || tid;
                }
            });

            sceneGroup.add(instance);
            resultGroups.push(instance);
            placedCount++;

        } catch (err) {
            console.warn(`[ParametricModelLoader] 软装 ${item.id} 放置失败:`, err.message);
        }
    }

    console.log(`[ParametricModelLoader] 完成: ${placedCount}/${softlistItems.length} 个参数化模型已放置` +
        `（${modelCache.size} 个唯一 TypeId 已缓存）`);
    return resultGroups;
}

//==============================================================================
// 工具函数
//==============================================================================

/** 计算 footprint 的中心点（XY 平面） */
function computeFootprintCenter(footprint) {
    let cx = 0, cy = 0;
    for (const p of footprint) {
        cx += p.x;
        cy += p.y;
    }
    return { x: cx / footprint.length, y: cy / footprint.length };
}

/** 计算 footprint 的包围盒尺寸（XY 平面） */
function computeFootprintSize(footprint) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of footprint) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: maxX - minX || 1, y: maxY - minY || 1 };
}

/**
 * 获取模型缓存统计信息。
 */
export function getCacheStats() {
    return {
        templateEntries: templateMap?.size ?? 0,
        cachedModels: modelCache.size,
        pendingRequests: pendingRequests.size,
    };
}
