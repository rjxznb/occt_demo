import { Shape } from "three";
import * as Render from "./colorplane.js";
import { freestyle } from "../config/freestyle.js";

// 解析json字符串为对象，并且返回所有解析后的数据；
export default function ParseJson(json){
    const Room_Points = []; // 每一个元素都是一个房间（每一个元素还是一个数组），之后每个房间数组里面有无数个坐标对象；
    const Room_Names = [];  // 与 Room_Points 一一对应的房间名（主卧/客厅…），供模板按房间上色用；
    const Room_Info = [];   // 与 Room_Points 一一对应的房间信息：{name, area, perimeter, center:{x,y}}，供标注与尺寸查看；
    const Dim_Points = []; // 标注线；
    const SoftList = []; // 软装在dwg里面的变换数据，包括：旋转和缩放 [ {id: , basepoint: {x, y, z}, scale: {x: , y: , z: }, OutRotateRadian: 0}, { ... }]；
    const parse_data = {}; // 最终返回的解析数据对象；
    const Doors_Points = [];
    const Windows_Points = [];


    let final_room_list = json.final_room_list;
    let soft_list = json.soft_list;
    let final_space_dim_list = json.final_space_dim_list; // bottom/left/right/top_first/second/third_level_dim；
    let door_list = json.door_list;
    let window_list = json.window_list;
    
    let dxf_num = 0; // 记录当前到第几个需要dxf解析的数据了，因为在cpp里面就是按照这个顺序进行文件名存储的；

    if(final_room_list && Array.isArray(final_room_list))
        final_room_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points)) {
                const Room_pointsArray = [];
                
                item.Points.forEach(pointStr => {
                    // 提取X，Y，Z 坐标和 bulge凸度值
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        Room_pointsArray.push({x, y, z, bulge});
                    }
                });
                Room_Points.push(Room_pointsArray);
                Room_Names.push(item.RoomName || item.DisplayName || '');

                // 房间中心（BasePoint，世界坐标，用作标注锚点）+ 面积/周长
                let center = { x: 0, y: 0 };
                const bp = (item.BasePoint || '').match(/X=([\d.-]+)\s+Y=([\d.-]+)/);
                if (bp) {
                    center = { x: parseFloat(bp[1]), y: parseFloat(bp[2]) };
                } else if (Room_pointsArray.length) {
                    // 兜底：用顶点平均值
                    center = Room_pointsArray.reduce((a, p) => ({ x: a.x + p.x / Room_pointsArray.length, y: a.y + p.y / Room_pointsArray.length }), { x: 0, y: 0 });
                }
                // 内墙分段——供「查看内墙尺寸」的俯视图标注。
                // 分段用原始点（带 bulge）算：一条弧 = 一面墙（按真实弧长），
                // 直墙的近似共线碎段合并、门窗侧壁等短段滤掉。
                // 画轮廓则用采样后的平滑折线，弧墙才画得圆润。
                const outlinePts = sampleAllArcs(Room_pointsArray).map(p => ({ x: p.x, y: p.y }));
                const walls = computeRoomWalls(Room_pointsArray);

                Room_Info.push({
                    name: item.RoomName || item.DisplayName || '',
                    area: item.RoomArea || 0,          // m²
                    perimeter: item.RoomPerimeter || 0, // m
                    center,
                    outline: outlinePts,                // 房间闭合轮廓（2D，mm），用于画俯视图
                    walls,                              // [{a:{x,y}, b:{x,y}, len}]，每面墙及其长度(mm)
                    wallLengths: walls.map(w => w.len).sort((a, b) => b - a), // 兼容：长度列表，降序
                });
            }
        });

    
    // 提取出每一个软装图例的二维坐标数组 以及 中心点坐标 和 变换系数
    if(soft_list && Array.isArray(soft_list))
        soft_list.forEach((item, index) => {
            // 对应一个图例对象；
            const ShapeDXF = {};

            // 解析出id：
            ShapeDXF.id = item.TypeId;
            ShapeDXF.id += `_${dxf_num++}`;
            
            ShapeDXF.points = [];

            // 如果是自由绘制则需要他们的点数据；
            if(item.TypeId in freestyle){
                if(item.Points && Array.isArray(item.Points)){
                    item.Points.forEach(pointStr => {
                        // 提取X，Y，Z 坐标和 bulge凸度值
                        const xMatch = pointStr.match(/X=([\d.-]+)/);
                        const yMatch = pointStr.match(/Y=([\d.-]+)/);
                        const zMatch = pointStr.match(/Z=([\d.-]+)/);
                        const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                        
                        if (xMatch && yMatch && zMatch) {
                            const x = parseFloat(xMatch[1]);
                            const y = parseFloat(yMatch[1]);
                            const z = parseFloat(zMatch[1]);
                            const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                            ShapeDXF.points.push({x, y, z, bulge});
                        }
                    });
                }
                // 这里ShapeDXF.points是一个点数组，不是房间数组，直接处理弧形采样
                // let newPointsArray = [];
                // let startPoint = ShapeDXF.points[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < ShapeDXF.points.length + 1; i++){
                //     let endPoint = ShapeDXF.points[i % ShapeDXF.points.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                ShapeDXF.points = sampleAllArcs(ShapeDXF.points);
            }
            
            // 解析出中心点：
            const basepoint = {};
            const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
            const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
            const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
            basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
            ShapeDXF.basepoint = basepoint;
            
            // 解析出放缩矩阵：
            ShapeDXF.scale = {};
            ShapeDXF.scale.x = item.OutXScale;
            ShapeDXF.scale.y = item.OutYScale;
            ShapeDXF.scale.z = item.OutZScale;

            // 解析出旋转系数；
            ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

            // 翻转标志（CAD BlockInnerInfo 中的字段，部分图例有）
            if (item.BlockInnerInfo) {
                if (item.BlockInnerInfo.上下翻转 !== undefined)
                    ShapeDXF.verticalFlip = !!item.BlockInnerInfo.上下翻转;
                if (item.BlockInnerInfo.左右翻转 !== undefined)
                    ShapeDXF.horizontalFlip = !!item.BlockInnerInfo.左右翻转;
            }

            // TypeId 与方块外接轮廓（世界坐标），供 3D 用 box 占位、模板按类别上色。
            // item.Points 是该图例方块的角点（已是绝对世界坐标，中心即 BasePoint），
            // 直接当 footprint 挤出即可，无需再变换。
            ShapeDXF.kind = 'softlist';   // 区别于同存于 SoftLists 里的门/窗
            ShapeDXF.typeId = item.TypeId;
            ShapeDXF.footprint = [];
            if (item.Points && Array.isArray(item.Points)) {
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    if (xMatch && yMatch) {
                        ShapeDXF.footprint.push({ x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]) });
                    }
                });
            }

            // 添加此图例对象到户型图例数组；
            SoftList.push(ShapeDXF);

        });


    // 解析出长度标注线段：每一个行可能包含多个线段；
    if(final_space_dim_list)
        for (let key in final_space_dim_list){
            let dim = final_space_dim_list[key];
            const Dim_pointsArray = [];
            dim.forEach(pointStr => {
                    // 提取X和Y坐标
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    if (xMatch && yMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        Dim_pointsArray.push({x, y, z});
                    }
                }
            );
            Dim_Points.push(Dim_pointsArray);
        }



    // 解析门数据
    if(door_list && Array.isArray(door_list))
        door_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points) && item.Size && item.TypeId) {
                let doorPointsArray = [];
                
                // 解析Points字段
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        doorPointsArray.push({x, y, z, bulge});
                    }
                });
                
                // 处理门的弧形采样
                // let newDoorPointsArray = [];
                // let startPoint = doorPointsArray[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < doorPointsArray.length + 1; i++){
                //     let endPoint = doorPointsArray[i % doorPointsArray.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newDoorPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newDoorPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                doorPointsArray = sampleAllArcs(doorPointsArray);


                // 解析Size字段 (格式: "X=800.000000 Y=140.000000")
                const sizeXMatch = item.Size.match(/X=([\d.-]+)/);
                const sizeYMatch = item.Size.match(/Y=([\d.-]+)/);
                const sizeX = sizeXMatch ? parseFloat(sizeXMatch[1]) : 0;
                const sizeY = sizeYMatch ? parseFloat(sizeYMatch[1]) : 0;
                
                // 解析BlockInnerInfo中的高度字段
                let height = 0;
                if (item.BlockInnerInfo && item.BlockInnerInfo.高度) {
                    height = parseFloat(item.BlockInnerInfo.高度);
                }

                // 存储门数据
                Doors_Points.push({
                    points: doorPointsArray,
                    size: { x: sizeX, y: sizeY },
                    typeid: item.TypeId,
                    height: height,
                });

                // 对应一个图例对象；
                const ShapeDXF = {};
                // 解析出id：
                ShapeDXF.id = item.TypeId;
                ShapeDXF.id += `_${dxf_num++}`;

                // 异形门；
                if(item.TypeId in freestyle){
                    ShapeDXF.points = doorPointsArray;
                }

                // 解析出中心点：
                const basepoint = {};
                const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
                const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
                const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
                basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
                ShapeDXF.basepoint = basepoint;

                
                // 解析出放缩矩阵：
                ShapeDXF.scale = {};
                ShapeDXF.scale.x = item.OutXScale;
                ShapeDXF.scale.y = item.OutYScale;
                ShapeDXF.scale.z = item.OutZScale;

                // 解析出旋转系数；
                ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

                // 添加此图例对象到户型图例数组；
                SoftList.push(ShapeDXF);
            }
        });
    
    // 解析窗数据
    if (window_list && Array.isArray(window_list))
        window_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points) && item.Size && item.TypeId) {
                let windowPointsArray = [];
                
                // 解析Points字段
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        windowPointsArray.push({x, y, z, bulge});
                    }
                });

                // 处理窗的弧形采样
                // let newWindowPointsArray = [];
                // let startPoint = windowPointsArray[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < windowPointsArray.length + 1; i++){
                //     let endPoint = windowPointsArray[i % windowPointsArray.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newWindowPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newWindowPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                windowPointsArray = sampleAllArcs(windowPointsArray);
                
                // 解析Size字段
                const sizeXMatch = item.Size.match(/X=([\d.-]+)/);
                const sizeYMatch = item.Size.match(/Y=([\d.-]+)/);
                const sizeX = sizeXMatch ? parseFloat(sizeXMatch[1]) : 0;
                const sizeY = sizeYMatch ? parseFloat(sizeYMatch[1]) : 0;
                
                // 解析BlockInnerInfo中的离地高度和高度字段
                let groundHeight = 0;  // 离地高度
                let height = 0;        // 高度
                if (item.BlockInnerInfo) {
                    if (item.BlockInnerInfo.离地高度) {
                        groundHeight = parseFloat(item.BlockInnerInfo.离地高度);
                    }
                    if (item.BlockInnerInfo.高度) {
                        height = parseFloat(item.BlockInnerInfo.高度);
                    }
                }

                // 存储窗数据
                Windows_Points.push({
                    points: windowPointsArray,
                    size: { x: sizeX, y: sizeY },
                    typeid: item.TypeId,
                    groundHeight: groundHeight,
                    height: height,
                });

                // 对应一个图例对象；
                const ShapeDXF = {};
                // 解析出id：
                ShapeDXF.id = item.TypeId;
                ShapeDXF.id += `_${dxf_num++}`;

                // 异形窗；
                if(item.TypeId in freestyle){
                    ShapeDXF.points = windowPointsArray;
                }

                // 解析出中心点：
                const basepoint = {};
                const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
                const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
                const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
                basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
                ShapeDXF.basepoint = basepoint;
                
                // 解析出放缩矩阵：
                ShapeDXF.scale = {};
                ShapeDXF.scale.x = item.OutXScale;
                ShapeDXF.scale.y = item.OutYScale;
                ShapeDXF.scale.z = item.OutZScale;

                // 解析是否翻转；
                ShapeDXF.verticalFlip = item.VerticalFlip;
                ShapeDXF.horizontalFlip = item.HorizontalFlip;

                // 解析出旋转系数；
                ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

                // 添加此图例对象到户型图例数组；
                SoftList.push(ShapeDXF);
            }
        });

    parse_data.Room_Points = Room_Points;
    parse_data.Room_Names = Room_Names;
    parse_data.Room_Info = Room_Info;
    parse_data.SoftLists = SoftList;
    parse_data.Dim_Points = Dim_Points;
    parse_data.door_list = Doors_Points;
    parse_data.window_list = Windows_Points;

    // 处理弧形，进行采样；
    parse_data.Room_Points.forEach((item, index)=> { // 每一个item都是一个数组（表示房间），每一个数组里面有N个对象元素{x, y, z, b}（表示坐标点），从右上角逆时针到右下角；
        let newitem = [];
        let startPoint = item[0];
        // 之所以停止条件为+1就是因为要要整个空间闭合；
        for (let i =1; i < item.length+1; i++){
            let endPoint = item[i%item.length];
            if(startPoint.bulge !=0){
                let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                newitem.push(...arcpoints);
                startPoint = endPoint;
            }else{
                newitem.push(startPoint);
                startPoint = endPoint;
            }
        }
        parse_data.Room_Points[index] = newitem; // 替换掉原来的数组；不能通过item直接修改，因为item是一个局部变量引用，改变他不会改变原数组的对象；
    });

    return parse_data;
}

/**
 * 计算房间各面内墙及其两端点（mm）。
 *
 * 输入是房间的原始边界点（带 bulge）。处理原则：
 * - 带 bulge 的边是一条弧墙，单独成一面墙，长度取真实弧长（不是弦长）；
 * - 相邻的直边若近似共线（门窗洞口、柱子把一面墙切成几段），合并回一面墙；
 * - 过短的碎段（洞口侧壁、回折）丢弃。
 * 保留每面墙的起止端点（弧墙用弦端点）与 isArc 标记，供俯视图定位标注。
 *
 * @param {Array<{x:number,y:number,bulge?:number}>} pts - 原始边界点（首尾隐式相连）
 * @returns {Array<{a:{x,y}, b:{x,y}, len:number, isArc:boolean}>} 每面墙，按轮廓顺序
 */
function computeRoomWalls(pts) {
    if (!pts || pts.length < 3) return [];

    const MERGE_ANGLE = 15 * Math.PI / 180;  // 直墙相邻边转角小于此值视为共线、合并（弧墙已单独处理，无需靠这个并弧）
    const MIN_WALL = 300;                     // 短于此长度的墙段丢弃（门窗洞口侧壁、柱子回折等碎段，mm）

    // 逐边：直边记方向，弧边（有 bulge）算真实弧长并标记
    const edges = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        const chord = Math.hypot(dx, dy);
        if (chord <= 1) continue;   // 跳过重复点造成的零长边
        const ea = { x: a.x, y: a.y }, eb = { x: b.x, y: b.y };
        const bulge = a.bulge || 0;
        if (Math.abs(bulge) > 0.001) {
            // 弧长：bulge = tan(θ/4)，θ 为弧所对圆心角
            const theta = 4 * Math.atan(Math.abs(bulge));
            const radius = chord / (2 * Math.sin(theta / 2));
            // 标注锚点取弧顶：直接采样这段弧、找离弦最远的点。
            // 不靠 bulge 正负或「远离质心」推方向——对 >180° 的反弧(凸窗)那些启发式都会指反。
            let apex = { x: (ea.x + eb.x) / 2, y: (ea.y + eb.y) / 2 }, maxD = -1;
            const arcPts = sampleDoorWindowArc(a, b, bulge);
            for (const q of arcPts) {
                const d = Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / chord; // 点到弦距离
                if (d > maxD) { maxD = d; apex = { x: q.x, y: q.y }; }
            }
            edges.push({ a: ea, b: eb, mid: apex, len: radius * theta, ang: Math.atan2(dy, dx), isArc: true });
        } else {
            edges.push({ a: ea, b: eb, len: chord, ang: Math.atan2(dy, dx), isArc: false });
        }
    }
    if (edges.length === 0) return [];

    const angDiff = (a, b) => {
        let d = Math.abs(a - b) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        return d;
    };

    // 合并：弧边自成一段、打断直边的合并；直边间近似共线才累加
    const walls = [];
    let cur = null;
    for (const e of edges) {
        if (e.isArc) {
            if (cur) { walls.push(cur); cur = null; }
            walls.push({ a: e.a, b: e.b, mid: e.mid, len: e.len, ang: e.ang, isArc: true });
        } else if (cur && !cur.isArc && angDiff(e.ang, cur.ang) < MERGE_ANGLE) {
            cur.len += e.len;   // 同一面直墙，累加并延伸终点
            cur.b = e.b;
        } else {
            if (cur) walls.push(cur);
            cur = { a: e.a, b: e.b, len: e.len, ang: e.ang, isArc: false };
        }
    }
    if (cur) walls.push(cur);

    // 环闭合：首尾两段若都是直墙且共线，合并为一面墙
    if (walls.length > 1 && !walls[0].isArc && !walls[walls.length - 1].isArc &&
        angDiff(walls[0].ang, walls[walls.length - 1].ang) < MERGE_ANGLE) {
        const last = walls.pop();
        walls[0].len += last.len;
        walls[0].a = last.a;
    }

    return walls
        .filter(w => w.len >= MIN_WALL)
        .map(w => ({
            a: w.a, b: w.b,
            // 标注锚点：直墙取两端中点，弧墙取弧顶（采样求得）
            mid: w.mid || { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 },
            len: Math.round(w.len),
            isArc: !!w.isArc,
        }));
}

/**
 * 使用SampleArc函数处理所有点，包括弧形段
 * @param {Array} points - 原始点数组，格式: [{x, y, z, bulge}, ...]
 * @returns {Array} 采样后的点数组
 */
function sampleAllArcs(points) {
    let sampledPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const currentPoint = points[i];
        const nextPoint = points[(i + 1) % points.length];
        
        // 检查当前点是否有bulge值
        if (currentPoint.bulge && Math.abs(currentPoint.bulge) > 0.001) {
            try {
                // 使用专门的门窗弧形采样函数
                const arcPoints = sampleDoorWindowArc(currentPoint, nextPoint, currentPoint.bulge);
                
                // 添加弧形采样点（排除最后一个点，避免重复）
                for (let j = 0; j < arcPoints.length - 1; j++) {
                    sampledPoints.push(arcPoints[j]);
                }
            } catch (error) {
                console.warn('弧形采样失败，使用直线替代:', error);
                sampledPoints.push(currentPoint);
            }
        } else {
            // 直接添加当前点
            sampledPoints.push(currentPoint);
        }
    }
    
    return sampledPoints;
}

/**
 * 门窗专用弧形采样函数 - 适配顺时针坐标系（去除THREE.js依赖）
 * @param {Object} startPoint - 起点 {x, y, z, bulge}
 * @param {Object} endPoint - 终点 {x, y, z, bulge}
 * @param {number} bulge - 凸度值
 * @returns {Array} 采样点数组
 */
function sampleDoorWindowArc(startPoint, endPoint, bulge) {
    // 1. 计算弦长和方向向量
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const chordLength = Math.sqrt(dx * dx + dy * dy);

    if (chordLength === 0) {
        console.warn("起点和终点重合，无法绘制圆弧");
        return [startPoint];
    }

    // 2. 根据 bulge 值计算圆弧对应的夹角（弧度）
    const theta = 2 * Math.atan(Math.abs(bulge));
    const radius = chordLength / (2 * Math.sin(theta));

    // 3. 计算垂直于弦的方向（即指向圆心的方向）
    const perpDirX = -dy / chordLength;
    const perpDirY = dx / chordLength;

    // 4. 圆心位置
    const chordMidpointX = (startPoint.x + endPoint.x) / 2;
    const chordMidpointY = (startPoint.y + endPoint.y) / 2;

    const centerOffset = radius * Math.cos(theta); // 向圆心偏移的距离
    const centerX = chordMidpointX + perpDirX * centerOffset * (bulge > 0 ? 1 : -1);
    const centerY = chordMidpointY + perpDirY * centerOffset * (bulge > 0 ? 1 : -1);

    // 5. 起始角和终止角
    const startAngle = Math.atan2(startPoint.y - centerY, startPoint.x - centerX);
    const endAngle = Math.atan2(endPoint.y - centerY, endPoint.x - centerX);

    // 6. 确定圆弧方向（门窗坐标系：bulge < 0 表示顺时针）
    const clockwise = bulge < 0;
    
    // 7. 计算角度差
    let angleDiff = endAngle - startAngle;
    if (clockwise) {
        if (angleDiff > 0) {
            angleDiff -= 2 * Math.PI;
        }
    } else {
        if (angleDiff < 0) {
            angleDiff += 2 * Math.PI;
        }
    }

    // 8. 采样（降低采样密度以减少复杂度）
    const sampleCount = 50; // 采样点数量
    let points = [];
    
    for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount;
        const angle = startAngle + angleDiff * t;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        points.push({x: x, y: y, z: 0, bulge: 0});
    }
    
    return points;
}
