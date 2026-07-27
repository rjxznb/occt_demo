import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

/**
 * 参数化模型加载器
 *
 * 管线：TypeId → Template(ResId) → getGoodsDetail → parameterizedJsonUrl
 *       → modelUrlToObj → OBJ 字符串 → Three.js Group → 放入场景
 *
 * 依赖 parametric-lab 后端运行在 http://localhost:3100
 */

const BACKEND_URL = 'http://localhost:3100';
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

//==============================================================================
// 公开 API
//==============================================================================

export async function loadTemplate(templatePath = '/data/template.json') {
    if (templatePromise) return templatePromise;

    templatePromise = (async () => {
        console.log(`${LOG_PREFIX} 加载模板: ${templatePath}`);
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

async function fetchGoodsDetail(resId) {
    const url = `${BACKEND_URL}/api/getGoodsDetail?id=${encodeURIComponent(resId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getGoodsDetail HTTP ${res.status}`);
    return res.json();
}

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

async function fetchModelObj(parameterizedJsonUrl) {
    console.log(`${LOG_PREFIX}   POST modelUrlToObj: ${parameterizedJsonUrl.substring(0, 80)}...`);
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

async function fetchModelForTypeId(typeId) {
    if (!templateMap) {
        console.warn(`${LOG_PREFIX} 模板未加载`);
        return null;
    }

    const tid = String(typeId);

    if (modelCache.has(tid)) {
        console.log(`${LOG_PREFIX} TypeId=${tid} 命中缓存`);
        return modelCache.get(tid);
    }

    if (pendingRequests.has(tid)) {
        console.log(`${LOG_PREFIX} TypeId=${tid} 等待飞行中请求`);
        return pendingRequests.get(tid);
    }

    const promise = (async () => {
        const entry = templateMap.get(tid);
        if (!entry) {
            console.warn(`${LOG_PREFIX} TypeId="${tid}" 不在模板中`);
            return null;
        }

        const resId = entry.resId;
        console.log(`${LOG_PREFIX} TypeId=${tid} → ResId=${resId} (${entry.typeName})`);

        try {
            // Step 1: getGoodsDetail
            const detail = await fetchGoodsDetail(resId);
            const url = findParameterizedJsonUrl(detail?.data?.modelDTO ?? {})
                ?? findParameterizedJsonUrl(detail);

            if (!url) {
                console.warn(`${LOG_PREFIX}   无 parameterizedJsonUrl, 响应 data keys:`,
                    Object.keys(detail?.data || {}).join(', '));
                return null;
            }
            console.log(`${LOG_PREFIX}   parameterizedJsonUrl: ${url.substring(0, 80)}...`);

            // Step 2: modelUrlToObj
            const result = await fetchModelObj(url);

            // Step 3: 提取 OBJ
            const objContent = extractObjContent(result);
            if (!objContent) {
                console.warn(`${LOG_PREFIX}   响应中无 OBJ 内容`);
                return null;
            }
            console.log(`${LOG_PREFIX}   OBJ 内容: ${(objContent.length / 1024).toFixed(1)} KB`);

            // Step 4: 解析 OBJ
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

            modelCache.set(tid, group);
            console.log(`${LOG_PREFIX} ✓ TypeId=${tid} (${entry.typeName}) 已缓存`);
            return group;

        } catch (err) {
            console.error(`${LOG_PREFIX} TypeId=${tid} 失败:`, err.message);
            return null;
        }
    })();

    pendingRequests.set(tid, promise);
    promise.finally(() => pendingRequests.delete(tid));
    return promise;
}

//==============================================================================
// 场景集成
//==============================================================================

export async function loadParametricModels(softlists, sceneGroup, options = {}) {
    const { concurrency = 3, onProgress = null } = options;

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

    // Step 1: 批量预加载模型
    let loadedCount = 0;
    for (let i = 0; i < uniqueTypeIds.length; i += concurrency) {
        const batch = uniqueTypeIds.slice(i, i + concurrency);
        await Promise.allSettled(batch.map(typeId => fetchModelForTypeId(typeId)));
        loadedCount += batch.length;
        if (onProgress) onProgress(Math.min(loadedCount, uniqueTypeIds.length), uniqueTypeIds.length);
    }

    console.log(`${LOG_PREFIX} 模型缓存: ${modelCache.size}/${uniqueTypeIds.length} 个唯一 TypeId`);
    for (const [tid, group] of modelCache) {
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        console.log(`${LOG_PREFIX}   缓存 ${tid}: meshes=${group.children.length}, size=(${size.x.toFixed(0)},${size.y.toFixed(0)},${size.z.toFixed(0)})`);
    }

    // Step 2: 为每个软装实例放置模型
    const resultGroups = [];
    let placedCount = 0;

    for (const item of softlistItems) {
        const tid = String(item.typeId);
        const templateModel = modelCache.get(tid);
        if (!templateModel) continue;

        try {
            const instance = templateModel.clone(true);

            // ── 位置：用 CAD 的 basepoint（世界坐标中心点）─────────────────
            const bp = item.basepoint;
            const posX = bp ? bp.x : computeFootprintCenter(item.footprint).x;
            const posY = bp ? bp.y : computeFootprintCenter(item.footprint).y;

            // ── 真实尺寸：从 footprint 矩形边长推算（不受旋转影响）───────
            const rectSize = computeFootprintRectSize(item.footprint);

            // ── 旋转：CAD 数据中的值是度（字段名 Radian 是误导）──────────
            const cadRotateDeg = typeof item.rotate === 'number' ? item.rotate : 0;
            const cadRotateRad = THREE.MathUtils.degToRad(cadRotateDeg);

            // ── CAD 缩放因子 ─────────────────────────────────────────────
            const cadScale = item.scale || { x: 1, y: 1, z: 1 };

            // ── 坐标系：OBJ 模型已是 Z-up（被努恩坐标系），无需转换 ──────
            // 只需绕 Z 轴转 CAD 朝向（顺时针为正 vs THREE 逆时针为正 → 取反）
            const qHead = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 0, 1), -cadRotateRad
            );
            instance.quaternion.copy(qHead);

            instance.updateMatrixWorld();

            // ── 计算模型缩放 ─────────────────────────────────────────────
            const modelBox = new THREE.Box3().setFromObject(instance);
            const modelSize = modelBox.getSize(new THREE.Vector3());
            const defaultSize = getDefaultSize(tid);

            let scaleX = 1, scaleY = 1, scaleZ = 1;

            if (defaultSize && defaultSize.x > 0 && defaultSize.y > 0) {
                // 模板默认尺寸 (cm) → mm，与 CAD Size 比对
                const defMM = { x: defaultSize.x * 10, y: defaultSize.y * 10 };
                if (rectSize.x > 0) scaleX = (rectSize.x / defMM.x) * cadScale.x;
                if (rectSize.y > 0) scaleY = (rectSize.y / defMM.y) * cadScale.y;
                scaleZ = (scaleX + scaleY) / 2 * cadScale.z;
            } else {
                // 用模型自身包围盒匹配 CAD 矩形尺寸
                if (modelSize.x > 0.001 && modelSize.y > 0.001) {
                    scaleX = (rectSize.x / modelSize.x) * cadScale.x;
                    scaleY = (rectSize.y / modelSize.y) * cadScale.y;
                    scaleZ = (scaleX + scaleY) / 2 * cadScale.z;
                }
            }

            console.log(`${LOG_PREFIX}   ${tid} pos=(${posX.toFixed(0)},${posY.toFixed(0)}) ` +
                `rectSize=(${rectSize.x.toFixed(0)},${rectSize.y.toFixed(0)})mm ` +
                `rotate=${cadRotateDeg.toFixed(1)}° ` +
                `model=(${modelSize.x.toFixed(1)},${modelSize.y.toFixed(1)},${modelSize.z.toFixed(1)}) ` +
                `→ scale=(${scaleX.toFixed(3)},${scaleY.toFixed(3)},${scaleZ.toFixed(3)})`);

            instance.position.set(posX, posY, bp?.z ?? 0);
            instance.scale.set(
                Math.max(scaleX, 0.01),
                Math.max(scaleY, 0.01),
                Math.max(scaleZ, 0.01),
            );

            // ── 更新包围盒，把模型底部抬到 z≥0 ───────────────────────────
            instance.updateMatrixWorld();
            const placedBox = new THREE.Box3().setFromObject(instance);
            if (placedBox.min.z < 0) {
                instance.position.z += -placedBox.min.z + 1;  // 底部贴地 +1mm 余量
            }

            // 标记 userData
            instance.userData = {
                type: 'parametric-softlist',
                softlistId: item.id,
                typeId: tid,
            };

            sceneGroup.add(instance);
            resultGroups.push(instance);
            placedCount++;
        } catch (err) {
            console.warn(`${LOG_PREFIX} 放置失败 ${item.id}:`, err.message);
        }
    }

    console.log(`${LOG_PREFIX} 完成: ${placedCount}/${softlistItems.length} 参数化模型已放入场景`);
    if (placedCount === 0 && modelCache.size === 0) {
        console.warn(`${LOG_PREFIX} ⚠ 无任何参数化模型！请确认: 1) 后端已启动(localhost:3100) 2) 模板TypeId匹配 3) 网络可访问 beinuan.ke.com`);
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
