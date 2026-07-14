import initOpenCascade from "opencascade.js";
import ParseJson from "../utils/json_parse.js";

/**
 * 几何服务
 *
 * 原先由 server.js（Node + Express）承担的职责，现在全部跑在浏览器里：
 * OpenCascade 通过 wasm 初始化，户型数据从 public/data/ 读取。
 * 对外暴露的方法与原来的 HTTP 端点一一对应。
 */

const DATA_URL = '/data/Drawing2.json';
const SOFTLIST_DIR = '/data/parsed_dxf';

const WALL_THICKNESS = 240;   // 墙厚 240mm，房间轮廓向外偏移量
const OPENING_OFFSET = 15;    // 门窗向外偏移量，用于 CSG 挖洞时留出余量

let oc = null;

// ---------------------------------------------------------------------------
// OpenCascade 几何工具函数
// ---------------------------------------------------------------------------

/** 构建多边形的 wire（不仅限于矩形） */
function createPolygonWire(points) {
    try {
        let wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

        for (let i = 0; i < points.length; i++) {
            const next = (i + 1) % points.length;
            let p1 = new oc.gp_Pnt_3(points[i][0], points[i][1], points[i][2] || 0);
            let p2 = new oc.gp_Pnt_3(points[next][0], points[next][1], points[next][2] || 0);

            // 跳过长度为 0 的边，否则 wire 构建会失败
            if (p1.Distance(p2) < 1e-6) {
                p1.delete();
                p2.delete();
                continue;
            }

            let edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
            if (edgeBuilder.IsDone()) {
                wireBuilder.Add_1(edgeBuilder.Edge());
            } else {
                console.warn(`创建第${i}条边失败`);
            }

            p1.delete();
            p2.delete();
            edgeBuilder.delete();
        }

        if (!wireBuilder.IsDone()) {
            wireBuilder.delete();
            return null;
        }

        let result = wireBuilder.Wire();
        wireBuilder.delete();
        return result;

    } catch (error) {
        console.error("createPolygonWire异常:", error.message);
        return null;
    }
}

/** 向外平移 wire，返回平移后的 Wire */
function offsetWire(wire, offset) {
    let offsetAlgo = new oc.BRepOffsetAPI_MakeOffset_1();
    // 连接类型设为尖角，保持原始形状的棱角
    offsetAlgo.Init_2(oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    offsetAlgo.AddWire(wire);
    offsetAlgo.Perform(offset, 0);

    let resultShape = offsetAlgo.Shape();

    let exp = new oc.TopExp_Explorer_2(resultShape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let resultWire = null;
    if (exp.More()) {
        resultWire = oc.TopoDS.Wire_1(exp.Current());
    }

    exp.delete();
    offsetAlgo.delete();
    return resultWire;
}

/** 由 wire 构建面 */
function createFaceFromWire(wire) {
    if (!wire) {
        console.error("无法创建面：wire为空");
        return null;
    }

    try {
        let faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);

        if (!faceBuilder.IsDone()) {
            faceBuilder.delete();

            // 退回到不指定平面的构建方式
            let faceBuilder2 = new oc.BRepBuilderAPI_MakeFace_5(wire);
            if (!faceBuilder2.IsDone()) {
                console.error("两种Face构建方法均失败");
                faceBuilder2.delete();
                return null;
            }
            let result = faceBuilder2.Face();
            faceBuilder2.delete();
            return result;
        }

        let result = faceBuilder.Face();
        faceBuilder.delete();
        return result;

    } catch (error) {
        console.error("createFaceFromWire异常:", error.message);
        return null;
    }
}

/** 融合两个面 */
function fuseShapes(shape1, shape2) {
    let fuse = new oc.BRepAlgoAPI_Fuse_3(shape1, shape2, new oc.Message_ProgressRange_1());
    fuse.Build(new oc.Message_ProgressRange_1());

    if (!fuse.IsDone()) {
        console.error("融合操作失败");
        fuse.delete();
        return null;
    }

    let result = fuse.Shape();
    fuse.delete();
    return result;
}

/** 获取面的轮廓线（备选方案） */
function getOutlineWires(face) {
    let wires = [];
    let exp = new oc.TopExp_Explorer_2(face, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    while (exp.More()) {
        wires.push(exp.Current());
        exp.Next();
    }

    exp.delete();
    return wires;
}

/** 获取 Shape 的边界线 Wire */
function getShapeBoundWires(shape, tolerance = 1e-6) {
    if (!shape) {
        console.warn("getShapeBoundWires: shape为null");
        return [];
    }

    try {
        let boundsWire;

        if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
            boundsWire = shape;
        } else {
            try {
                let boundsAnalyzer = new oc.ShapeAnalysis_FreeBounds_2(shape, tolerance, true, true);
                boundsWire = boundsAnalyzer.GetClosedWires();
                boundsAnalyzer.delete();
            } catch (err) {
                console.warn("ShapeAnalysis_FreeBounds失败，直接使用原始shape:", err.message);
                boundsWire = shape;
            }
        }

        let wireMap = new oc.TopTools_IndexedMapOfShape_1();
        oc.TopExp.MapShapes_1(boundsWire, oc.TopAbs_ShapeEnum.TopAbs_WIRE, wireMap);

        let retWires = [];
        for (let i = 1; i <= wireMap.Extent(); i++) {
            let wire = oc.TopoDS.Wire_1(wireMap.FindKey(i));
            if (wire) retWires.push(wire);
        }

        wireMap.delete();

        if (retWires.length === 0) {
            return getOutlineWires(shape);
        }

        return retWires;

    } catch (error) {
        console.warn("getShapeBoundWires异常，使用备选方法:", error.message);
        return getOutlineWires(shape);
    }
}

/** 将轮廓线拆分成点 */
function wireToPoints(wire) {
    if (!wire) {
        console.warn("wireToPoints: wire为null");
        return [];
    }

    let points = [];
    try {
        let wireObj = oc.TopoDS.Wire_1(wire);
        let exp = new oc.TopExp_Explorer_2(wireObj, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

        while (exp.More()) {
            let vertex = oc.TopoDS.Vertex_1(exp.Current());
            let pnt = oc.BRep_Tool.Pnt(vertex);
            points.push([pnt.X(), pnt.Y(), pnt.Z()]);
            exp.Next();
        }

        exp.delete();
    } catch (error) {
        console.error("wireToPoints错误:", error.message);
    }

    return points;
}

/**
 * 对门/窗做向外偏移，得到用于 CSG 挖洞的轮廓。
 * 任何一步失败都退回上一层可用的数据，保证不会丢掉这个门窗。
 */
function offsetOpening(opening, label) {
    const points3D = opening.points.map(point => [point.x, point.y, 0, 0]);

    const wire = createPolygonWire(points3D);
    if (!wire) {
        console.warn(`${label}的wire创建失败，使用原始点`);
        return opening;
    }

    const offsetted = offsetWire(wire, OPENING_OFFSET);
    const sourceWire = offsetted || wire;
    if (!offsetted) {
        console.warn(`${label}的offset失败，使用原始wire`);
    }

    const converted = wireToPoints(sourceWire).map(p => ({
        x: p[0], y: p[1], z: p[2] || 0, bulge: 0
    }));

    wire.delete();
    if (offsetted) offsetted.delete();

    return { ...opening, points: converted };
}

// ---------------------------------------------------------------------------
// 几何服务
// ---------------------------------------------------------------------------

class GeometryService {
    constructor() {
        this.parseData = null;
        this.initPromise = null;
        this.softlistCache = new Map();
    }

    /**
     * 初始化 OpenCascade wasm 并加载/解析户型数据。
     * 重复调用返回同一个 Promise，保证只初始化一次。
     */
    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            console.log('正在初始化OpenCascade (wasm)...');
            oc = await initOpenCascade();
            console.log('OpenCascade初始化完成');

            console.log('正在加载户型数据...');
            const response = await fetch(DATA_URL);
            if (!response.ok) {
                throw new Error(`加载户型数据失败: HTTP ${response.status}`);
            }
            const json = await response.json();

            const parseData = ParseJson(json);

            // ParseJson 的弧形采样需要对象格式 {x,y,z,bulge}，采样完成后
            // 才能转成前端渲染用的数组格式 [x, y, z, bulge]
            parseData.Room_Points.forEach(room => {
                for (let i = 0; i < room.length; i++) {
                    if (typeof room[i] === 'object' && !Array.isArray(room[i])) {
                        room[i] = [room[i].x, room[i].y, room[i].z || 0, room[i].bulge || 0];
                    }
                }
            });

            this.parseData = parseData;
            console.log('户型数据解析完成');
        })();

        return this.initPromise;
    }

    /** 确保已初始化，未初始化则抛错 */
    ensureReady() {
        if (!this.parseData || !oc) {
            throw new Error('几何服务尚未初始化完成，请先调用 init()');
        }
    }

    /**
     * 获取户型外轮廓：房间轮廓各自外扩墙厚 → 构面 → 逐个融合 → 提取边界点
     * 对应原 GET /outline
     */
    async getOutline() {
        this.ensureReady();

        const rooms = this.parseData.Room_Points;
        console.log(`开始计算外轮廓，房间数量: ${rooms.length}`);

        const faces = [];
        for (let i = 0; i < rooms.length; i++) {
            const wire = createPolygonWire(rooms[i]);
            if (!wire) {
                throw new Error(`无法创建第${i}个房间的wire`);
            }

            const offsetted = offsetWire(wire, WALL_THICKNESS);
            const face = createFaceFromWire(offsetted);
            if (!face) {
                throw new Error(`无法创建第${i}个房间的面`);
            }
            faces.push(face);
        }

        // 逐个融合所有房间的面
        let merged = faces[0];
        for (let i = 1; i < faces.length; i++) {
            merged = fuseShapes(merged, faces[i]);
            if (!merged) {
                throw new Error(`无法完成第${i}个面的融合操作`);
            }
        }

        const outlineWires = getShapeBoundWires(merged);
        const outlinePoints = outlineWires.flatMap(wire => wireToPoints(wire));

        console.log(`外轮廓计算完成，边界线${outlineWires.length}条，共${outlinePoints.length}个点`);

        return {
            success: true,
            outlinePoints,
            message: "处理完成"
        };
    }

    /**
     * 获取房间数据
     * 对应原 GET /rooms
     */
    async getRooms() {
        this.ensureReady();
        return {
            success: true,
            roomPoints: this.parseData.Room_Points,
            message: `处理完成，共${this.parseData.Room_Points.length}个房间`
        };
    }

    /**
     * 获取门窗数据。processed_* 是外扩后用于挖洞的轮廓，
     * doors/windows 是原始轮廓，用于绘制门窗本身。
     * 对应原 GET /doors_and_windows
     */
    async getDoorsAndWindows() {
        this.ensureReady();

        const build = (list, kind) => {
            const original = [];
            const processed = [];

            (list || []).forEach((item, i) => {
                original.push({ ...item, points: structuredClone(item.points) });

                try {
                    processed.push(offsetOpening(item, `${kind}${i}`));
                } catch (error) {
                    console.error(`处理${kind}${i}时出错:`, error);
                    processed.push(item);
                }
            });

            return { original, processed };
        };

        const doors = build(this.parseData.door_list, '门');
        const windows = build(this.parseData.window_list, '窗');

        console.log(`门窗处理完成，门${doors.processed.length}个，窗${windows.processed.length}个`);

        return {
            success: true,
            processed_doors: doors.processed,
            doors: doors.original,
            processed_windows: windows.processed,
            windows: windows.original,
            message: `处理完成，共${doors.processed.length}个门，${windows.processed.length}个窗`
        };
    }

    /**
     * 获取软装列表
     * 对应原 GET /softlists
     */
    async getSoftlists() {
        this.ensureReady();
        return {
            success: true,
            softlists: this.parseData.SoftLists || []
        };
    }

    /**
     * 按 id 获取软装的几何点数据
     * 对应原 GET /softlists_points?id=xxx
     */
    async getSoftlistPoints(id) {
        if (!id) {
            throw new Error('软装ID不能为空');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(id)) {
            throw new Error('软装ID格式不正确');
        }

        if (this.softlistCache.has(id)) {
            return this.softlistCache.get(id);
        }

        const response = await fetch(`${SOFTLIST_DIR}/${id}.json`);
        if (response.status === 404) {
            throw new Error(`软装数据文件不存在: ${id}`);
        }
        if (!response.ok) {
            throw new Error(`获取软装${id}失败: HTTP ${response.status}`);
        }

        const data = await response.json();
        this.softlistCache.set(id, data);
        return data;
    }
}

// 全局单例：OpenCascade 初始化和户型数据解析都只应发生一次
export const geometryService = new GeometryService();
export default geometryService;
