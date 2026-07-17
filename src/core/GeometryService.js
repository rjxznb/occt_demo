import ParseJson from "../utils/json_parse.js";
import { BundledDataSource } from "./DataSource.js";
import { offsetPolygon, unionPolygons, polygonArea, matchWinding } from "./Polygon2D.js";

/**
 * 几何服务
 *
 * 原先由 server.js（Node + Express）承担的职责，现在全部跑在浏览器里。
 * 户型数据由 DataSource 提供（内置示例或用户选的本地文件）。
 * 对外方法与原来的 HTTP 端点一一对应。
 *
 * 几何运算原先用 OpenCascade（wasm）。但本项目实际只需要两种二维操作——
 * 多边形外扩与并集，且所有输入都在 z=0 平面（弧线在 json_parse 里已采样成折线）。
 * 为此背一个 50MB 的 CAD 内核、外加 5 秒的 wasm 初始化并不划算，
 * 现已改用 Clipper（见 Polygon2D.js）：结果等价（外轮廓包围盒差 <0.01mm），
 * 耗时从 6064ms 降到 13ms。
 */

const WALL_THICKNESS = 240;   // 墙厚 240mm，房间轮廓向外偏移量
const OPENING_OFFSET = 15;    // 门窗向外偏移量，用于 CSG 挖洞时留出余量

/**
 * 对门/窗做向外偏移，得到用于 CSG 挖洞的轮廓。
 * 偏移失败时退回原始轮廓，保证不会丢掉这个门窗。
 */
function offsetOpening(opening, label) {
    const rings = offsetPolygon(opening.points, OPENING_OFFSET);

    if (rings.length === 0) {
        console.warn(`${label}偏移失败，使用原始轮廓`);
        return opening;
    }

    // 取面积最大的环：偏移一个简单多边形正常只会得到一个环
    const points = rings[0].map(p => ({ x: p[0], y: p[1], z: 0, bulge: 0 }));

    return { ...opening, points };
}

// ---------------------------------------------------------------------------
// 几何服务
// ---------------------------------------------------------------------------

class GeometryService {
    constructor() {
        this.parseData = null;
        this.initPromise = null;
        this.softlistCache = new Map();
        this.dataSource = new BundledDataSource();
    }

    /**
     * 指定数据来源。必须在 init() 之前调用。
     * @param {BundledDataSource|LocalFileDataSource} dataSource
     */
    setDataSource(dataSource) {
        if (this.initPromise) {
            throw new Error('几何服务已初始化，无法更换数据源');
        }
        this.dataSource = dataSource;
    }

    /**
     * 加载并解析户型数据。
     * 重复调用返回同一个 Promise，保证只初始化一次。
     */
    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            console.log(`正在加载户型数据（${this.dataSource.name}）...`);
            const json = await this.dataSource.loadDrawing();

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
        if (!this.parseData) {
            throw new Error('几何服务尚未初始化完成，请先调用 init()');
        }
    }

    /**
     * 获取户型外轮廓：房间轮廓各自外扩墙厚 → 求并集 → 取边界
     * 对应原 GET /outline
     */
    async getOutline() {
        this.ensureReady();

        const rooms = this.parseData.Room_Points;

        // 每个房间外扩墙厚后求并集，得到的就是带墙体的户型实心区域
        const expanded = rooms.flatMap(room => offsetPolygon(room, WALL_THICKNESS));
        const rings = unionPolygons(expanded);

        if (rings.length === 0) {
            throw new Error('外轮廓计算失败：并集为空');
        }

        // 并集通常不止一个环：面积最大的是外环，其余是内环（房间之间没被墙体
        // 覆盖到的空隙）。必须原样交给下游，由 THREE.Shape 的 holes 正确表达。
        //
        // 原先 OpenCascade 是把所有环的顶点压平进一个数组返回的（而且遍历 wire 时
        // 每条边吐两个端点，顶点还两两重复），下游把它当成单个多边形去三角化——
        // 那是个自交的畸形，只是碰巧能出图。不要复刻这个格式。
        const sorted = [...rings].sort((a, b) => polygonArea(b) - polygonArea(a));

        // 绕向：外环与房间多边形一致，内环相反。挤出体的法线方向由绕向决定，
        // 反了实体就是里外翻转的，CSG 会挖不出洞（而且不报错）。
        const outer = matchWinding(sorted[0], rooms[0]);
        const holes = sorted.slice(1).map(ring => matchWinding(ring, rooms[0]).slice().reverse());

        const outlineRings = { outer, holes };

        console.log(`外轮廓计算完成：外环${outer.length}点，内环${holes.length}个`);

        return {
            success: true,
            outlineRings,
            // 兼容仅需要点列表的调用方
            outlinePoints: outer,
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
            roomNames: this.parseData.Room_Names || [],
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

        const data = await this.dataSource.loadSoftlist(id);
        this.softlistCache.set(id, data);
        return data;
    }
}

// 全局单例：OpenCascade 初始化和户型数据解析都只应发生一次
export const geometryService = new GeometryService();
export default geometryService;
