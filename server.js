import initOpenCascade from "opencascade.js/dist/node.js"
import express from 'express';
import ParseJson from "./json_parse.js";
import {fstat, readFileSync} from "node:fs";
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';



// 初始化OpenCascade和数据（异步，不阻塞服务器启动）
let oc = null;
let json = null;
let parse_data = null;

// 异步初始化函数
async function initializeServerData() {
    try {
        console.log('正在初始化OpenCascade...');
        oc = await initOpenCascade();
        console.log('OpenCascade初始化完成');

        let json_file_path = "C:/Users/User/Desktop/Drawing2.json";
        let executeParser_path = "F:/vscode_project/dxfparse/Source/CadToolTest/Debug/CadToolTest.exe";

        console.log('正在执行解析器...');
        // let res = await executeParser(executeParser_path, [json_file_path]);
        // console.log('解析器执行完成:', res);

        // 读取JSON文件并解析
        console.log('正在解析JSON数据...');
        json = JSON.parse(readFileSync(json_file_path, "utf-8"));
        parse_data = ParseJson(json); // 解析json数据

        // 注意：必须在ParseJson完成弧形采样后再转换成数组格式
        // ParseJson中的弧形采样需要对象格式 {x,y,z,bulge}
        // 转换成数组格式供前端渲染使用，保留bulge信息；
        parse_data.Room_Points.forEach((item, index) => {
            for (let i = 0; i < item.length; i++) {
                // 检查是否已经是数组格式，避免重复转换
                if (typeof item[i] === 'object' && !Array.isArray(item[i])) {
                    // 保留bulge值，格式：[x, y, z, bulge]
                    item[i] = [item[i].x, item[i].y, item[i].z || 0, item[i].bulge || 0];
                }
            }
        });
        
        console.log('服务器数据初始化完成');
    } catch (error) {
        console.error('服务器数据初始化失败:', error);
        console.log('服务器将以有限功能模式运行');
    }
}

// 启动异步初始化，但不等待完成
initializeServerData();


// 构建多边形的wire（不仅限于矩形）
function createPolygonWire(points) {
    try {
        console.log(`创建wire，点数: ${points.length}`);
        let wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
        
        for (let i = 0; i < points.length; i++) {
            // 从4元素数组中取前3个坐标 [x, y, z, bulge] -> [x, y, z]
            let p1 = new oc.gp_Pnt_3(points[i][0], points[i][1], points[i][2] || 0);
            let p2 = new oc.gp_Pnt_3(points[(i + 1) % points.length][0], points[(i + 1) % points.length][1], points[(i + 1) % points.length][2] || 0);
            
            // 检查点是否相同（避免创建长度为0的边）
            let distance = p1.Distance(p2);
            if (distance < 1e-6) {
                console.log(`跳过长度为0的边: ${i} -> ${(i + 1) % points.length}`);
                p1.delete();
                p2.delete();
                continue;
            }
            
            let edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
            if (edgeBuilder.IsDone()) {
                wireBuilder.Add_1(edgeBuilder.Edge());
            } else {
                console.log(`创建第${i}条边失败`);
            }
            
            p1.delete();
            p2.delete();
            edgeBuilder.delete();
        }
        
        if (!wireBuilder.IsDone()) {
            console.log("Wire构建失败");
            wireBuilder.delete();
            return null;
        }
        
        let result = wireBuilder.Wire();
        wireBuilder.delete();
        console.log("Wire创建成功");
        return result;
        
    } catch (error) {
        console.log("createPolygonWire异常:", error.message);
        return null;
    }
}

// 向外平移wire，返回平移后全部的Wire；
function offsetWire(wire, offset) {
    let offsetAlgo = new oc.BRepOffsetAPI_MakeOffset_1();
    // 设置连接类型为尖角，保持矩形形状
    offsetAlgo.Init_2(oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
    offsetAlgo.AddWire(wire);
    
    offsetAlgo.Perform(offset, 0);
    
    let resultShape = offsetAlgo.Shape();
    
    // 从结果中提取第一个Wire
    let exp = new oc.TopExp_Explorer_2(resultShape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let resultWire = null;
    if (exp.More()) {
        resultWire = oc.TopoDS.Wire_1(exp.Current());
    }
    
    exp.delete();
    offsetAlgo.delete();
    return resultWire;
}


// 修改 createFaceFromWire 函数以处理数组
function createFaceFromWire(wire) {
    if (!wire) {
        console.error("无法创建面：wire为空");
        return null;
    }
    
    try {
        // 先检查wire是否有效
        let wireChecker = new oc.BRepCheck_Wire(wire);
        console.log("Wire检查状态:", wireChecker.Status());
        
        // 尝试创建面
        let faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
        console.log("Face构建器状态:", faceBuilder.IsDone());
        
        if (!faceBuilder.IsDone()) {
            console.log("Face构建失败，尝试不同的构建方法");
            faceBuilder.delete();
            
            // 尝试另一种方法
            let faceBuilder2 = new oc.BRepBuilderAPI_MakeFace_5(wire);
            if (!faceBuilder2.IsDone()) {
                console.log("第二种Face构建方法也失败");
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
        console.log("createFaceFromWire异常:", error.message);
        return null;
    }
}

// 融合两个面
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

// 获取Shape的边界线Wire（修正版本）
function getShapeBoundWires(shape, tolerance = 1e-6) {
    if (!shape) {
        console.log("getShapeBoundWires: shape为null");
        return [];
    }
    
    try {
        let boundsWire;
        
        // 检查形状类型
        if (shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
            boundsWire = shape;
        } else {
            try {
                // 尝试使用正确的构造函数参数
                let boundsAnalyzer = new oc.ShapeAnalysis_FreeBounds_2(shape, tolerance, true, true);
                boundsWire = boundsAnalyzer.GetClosedWires();
                boundsAnalyzer.delete();
            } catch (err) {
                console.log("ShapeAnalysis_FreeBounds失败，使用fallback方法:", err.message);
                // 如果失败，直接使用原始shape
                boundsWire = shape;
            }
        }
        
        // 创建Wire映射
        let wireMap = new oc.TopTools_IndexedMapOfShape_1();
        oc.TopExp.MapShapes_1(boundsWire, oc.TopAbs_ShapeEnum.TopAbs_WIRE, wireMap);
        
        let retWires = [];
        
        // 遍历所有Wire
        for (let i = 1; i <= wireMap.Extent(); i++) {
            let wire = oc.TopoDS.Wire_1(wireMap.FindKey(i));
            if (!wire) {
                continue;
            }
            
            retWires.push(wire);
        }
        
        wireMap.delete();
        console.log(`getShapeBoundWires提取到${retWires.length}条边界线`);
        
        // 如果没有找到边界线，使用备选方法
        if (retWires.length === 0) {
            console.log("使用备选方法getOutlineWires");
            return getOutlineWires(shape);
        }
        
        return retWires;
        
    } catch (error) {
        console.log("getShapeBoundWires异常，使用备选方法:", error.message);
        // 如果完全失败，使用原来的方法
        return getOutlineWires(shape);
    }
}

// 获取面的轮廓线（保留原函数作为备选）
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


// 将轮廓线拆分成点
function wireToPoints(wire) {
    if (!wire) {
        console.log("wireToPoints: wire为null");
        return [];
    }
    
    let points = [];
    try {
        // 确保传入的是TopoDS_Wire类型
        let wireObj = oc.TopoDS.Wire_1(wire);
        let exp = new oc.TopExp_Explorer_2(wireObj, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        
        while (exp.More()) {
            let vertex = oc.TopoDS.Vertex_1(exp.Current());
            let pnt = oc.BRep_Tool.Pnt(vertex);
            points.push([pnt.X(), pnt.Y(), pnt.Z()]);
            exp.Next();
        }
        
        exp.delete();
        console.log(`wireToPoints成功提取${points.length}个点`);
    } catch (error) {
        console.log("wireToPoints错误:", error.message);
    }
    
    return points;
}

// 创建Express应用
const app = express();
const port = 4001;

// 添加JSON解析中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 在Express应用中添加CORS支持
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

// 配置静态文件服务和MIME类型（放在API路由之前）
app.use(express.static('.', {
    setHeaders: (res, path) => {
        console.log('Serving static file:', path);
        if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (path.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html');
        }
    }
}));

// 添加服务器状态检查端点
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        dataInitialized: !!(parse_data && oc),
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 注册GET方法回调函数
// 在Express应用中调整处理逻辑
app.get('/outline', async (req, res) => {
    try {
        // 检查数据是否已初始化
        if (!parse_data || !oc) {
            return res.status(503).json({ 
                error: '服务器数据尚未初始化完成，请稍后重试',
                status: 'initializing'
            });
        }
        
        console.log("开始处理矩形...");
        
        // 1. 创建原始矩形的wire以及对应的面；
        console.log("解析的房间数量:", parse_data.Room_Points.length);
        console.log("第一个房间点数据:", parse_data.Room_Points[0]);
        
        let wires = [];
        let faces = [];
        for(let i = 0; i < parse_data.Room_Points.length; i++) {
            console.log(`开始创建第${i}个房间的wire...`);
            console.log(`第${i}个房间的点:`, parse_data.Room_Points[i]);
            
            try {
                let wire = createPolygonWire(parse_data.Room_Points[i]);
                let offsetWires = offsetWire(wire, 240); // 墙厚240mm
                console.log(`第${i}个wire创建结果:`, wire);
                wires.push(offsetWires);
                if (!wire) {
                    console.log(`第${i}个wire创建失败`);
                    return res.status(500).json({ error: `无法创建第${i}个wire` });
                }
                
                console.log(`开始为第${i}个wire创建面...`);
                let face = createFaceFromWire(offsetWires);
                console.log(`第${i}个face创建结果:`, face);
                if (!face) {
                    console.log(`第${i}个face创建失败`);
                    return res.status(500).json({ error: `无法创建第${i}个面` });
                }
                faces.push(face);
                console.log(`第${i}个房间处理完成`);
            } catch (error) {
                console.log(`处理第${i}个房间时出错:`, error.message);
                return res.status(500).json({ error: `处理第${i}个房间时出错: ${error.message}` });
            }
        }
        console.log("所有faces:", faces);

        // 4. 逐步融合所有面；
        console.log("开始融合面，总数量:", faces.length);
        let face1 = faces[0];
        console.log("初始面face1:", face1);
        
        for (let i = 1; i < faces.length; i++) {
            console.log(`开始融合第${i}个面...`);
            let face2 = faces[i];
            console.log(`face2:`, face2);
            
            try {
                face1 = fuseShapes(face1, face2);
                console.log(`融合第${i}个面后的结果:`, face1);
                if (!face1) {
                    console.log(`融合第${i}个面失败`);
                    return res.status(500).json({ error: `无法完成第${i}个面的融合操作` });
                }
            } catch (error) {
                console.log(`融合第${i}个面时出错:`, error.message);
                return res.status(500).json({ error: `融合第${i}个面时出错: ${error.message}` });
            }
        }
        console.log("所有面融合完成，最终结果:", face1);


        if (face1) {
            console.log("融合后的面对象:", face1);
            
            // 5. 获取融合后面的边界线
            let outlineWires = getShapeBoundWires(face1);
            console.log("提取的边界线数量:", outlineWires.length);
            
            // 6. 将轮廓线拆分成点
            let allPoints = [];
            outlineWires.forEach((wire, index) => {
                console.log(`处理第${index}个wire:`, wire);
                let points = wireToPoints(wire);
                console.log(`第${index}个wire的点数:`, points.length);
                allPoints.push(...points);
            });
            
            console.log("最终点数量:", allPoints.length);

            // 返回结果
            res.json({
                success: true,
                outlinePoints: allPoints,
                message: "处理完成"
            });
        } else {
            res.status(500).json({ error: "无法完成融合操作" });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } 
});

// 添加房间数据端点
app.get('/rooms', async (req, res) => {
    try {
        // 检查数据是否已初始化
        if (!parse_data || !oc) {
            return res.status(503).json({ 
                error: '服务器数据尚未初始化完成，请稍后重试',
                status: 'initializing'
            });
        }
        res.json({
            success: true,
            roomPoints: parse_data.Room_Points,
            message: `处理完成，共${parse_data.Room_Points.length}个房间`
        });
    } catch (error) {
        console.error('房间数据处理失败:', error);
        res.status(500).json({ error: error.message });
    }
});


// 获取门窗数据
app.get('/doors_and_windows', async (req, res) => {
    try {
        // 检查数据是否已初始化
        if (!parse_data || !oc) {
            return res.status(503).json({ 
                error: '服务器数据尚未初始化完成，请稍后重试',
                status: 'initializing'
            });
        }
        console.log("开始处理门窗数据...");
        
        // 处理门数据
        let processedDoors = []; // 用于存储扩充后的挖洞门窗数据；
        let doorData = []; // 用于存储原始画图用的门窗数据；

        
        if (parse_data.door_list && parse_data.door_list.length > 0) {
            console.log(`处理${parse_data.door_list.length}个门`);
            
            for (let i = 0; i < parse_data.door_list.length; i++) {
                const door = parse_data.door_list[i];
                console.log(`处理第${i}个门:`, door);
                
                try {
                    // 先处理弧形采样（门通常不会有弧形，但为了统一处理）
                    const sampledPoints = door.points;
                    console.log(`门${i}采样后点数量:`, sampledPoints.length);

                    doorData.push({
                        ...door,
                        points: structuredClone(sampledPoints)
                    });
                    
                    // 转换点格式为3D坐标（保持与房间数据一致的4元素格式）
                    const points3D = sampledPoints.map(point => [point.x, point.y, 0, 0]);
                    console.log(`门${i}的3D点:`, points3D);
                    
                    // 构建门的wire
                    const doorWire = createPolygonWire(points3D);
                    if (!doorWire) {
                        console.warn(`门${i}的wire创建失败，使用原始点`);
                        processedDoors.push(door);
                        continue;
                    }
                    
                    // 向外偏移50mm (5cm)
                    console.log(`对门${i}进行offset 50mm`);
                    const offsetDoorWire = offsetWire(doorWire, 15);
                    if (!offsetDoorWire) {
                        console.warn(`门${i}的offset失败，使用原始wire`);
                        // 将原始wire转换回点  
                        const originalPoints = wireToPoints(doorWire);
                        const convertedPoints = originalPoints.map(point => ({x: point[0], y: point[1], z: point[2] || 0, bulge: 0}));
                        processedDoors.push({
                            ...door,
                            points: convertedPoints
                        });
                    } else {
                        // 将offset后的wire转换回点
                        const offsetPoints = wireToPoints(offsetDoorWire);
                        const convertedPoints = offsetPoints.map(point => ({x: point[0], y: point[1], z: point[2] || 0, bulge: 0}));
                        console.log(`门${i}扩大后的点数量:`, convertedPoints.length);
                        
                        processedDoors.push({
                            ...door,
                            points: convertedPoints
                        });
                    }
                    
                    // 清理OpenCascade对象
                    if (doorWire) doorWire.delete();
                    if (offsetDoorWire) offsetDoorWire.delete();
                    
                } catch (error) {
                    console.error(`处理门${i}时出错:`, error);
                    // 出错时先尝试采样，如果采样也失败则使用原始数据
                    try {
                        const sampledPoints = door.points;
                        // 添加到原始数据数组
                        doorData.push({
                            ...door,
                            points: structuredClone(sampledPoints)
                        });
                        // 添加到处理数据数组
                        processedDoors.push({
                            ...door,
                            points: sampledPoints
                        });
                    } catch (sampleError) {
                        console.error(`门${i}采样也失败:`, sampleError);
                        // 完全失败时使用原始数据
                        doorData.push(door);
                        processedDoors.push(door);
                    }
                }
            }
        }
        
        // 处理窗数据
        let processedWindows = [];
        let windowData = [];
        if (parse_data.window_list && parse_data.window_list.length > 0) {
            console.log(`处理${parse_data.window_list.length}个窗`);
            
            for (let i = 0; i < parse_data.window_list.length; i++) {
                const window = parse_data.window_list[i];
                console.log(`处理第${i}个窗:`, window);
                
                try {
                    // 先处理弧形采样（窗户可能有弧形，需要特别处理）
                    const sampledPoints = window.points;
                    console.log(`窗${i}采样前点数量: ${window.points.length}, 采样后点数量: ${sampledPoints.length}`);
                    
                    windowData.push({
                        ...window,
                        points: structuredClone(sampledPoints)
                    });
                    

                    // 转换点格式为3D坐标（保持与房间数据一致的4元素格式）
                    const points3D = sampledPoints.map(point => [point.x, point.y, 0, 0]);
                    console.log(`窗${i}的3D点:`, points3D);
                    
                    // 构建窗的wire
                    const windowWire = createPolygonWire(points3D);
                    if (!windowWire) {
                        console.warn(`窗${i}的wire创建失败，使用原始点`);
                        processedWindows.push(window);
                        continue;
                    }
                    
                    // 向外偏移50mm (5cm)
                    console.log(`对窗${i}进行offset 50mm`);
                    const offsetWindowWire = offsetWire(windowWire, 15);
                    if (!offsetWindowWire) {
                        console.warn(`窗${i}的offset失败，使用原始wire`);
                        // 将原始wire转换回点
                        const originalPoints = wireToPoints(windowWire);
                        const convertedPoints = originalPoints.map(point => ({x: point[0], y: point[1], z: point[2] || 0, bulge: 0}));
                        processedWindows.push({
                            ...window,
                            points: convertedPoints
                        });
                    } else {
                        // 将offset后的wire转换回点
                        const offsetPoints = wireToPoints(offsetWindowWire);
                        const convertedPoints = offsetPoints.map(point => ({x: point[0], y: point[1], z: point[2] || 0, bulge: 0}));
                        console.log(`窗${i}扩大后的点数量:`, convertedPoints.length);
                        
                        processedWindows.push({
                            ...window,
                            points: convertedPoints
                        });
                    }
                    
                    // 清理OpenCascade对象
                    if (windowWire) windowWire.delete();
                    if (offsetWindowWire) offsetWindowWire.delete();
                    
                } catch (error) {
                    console.error(`处理窗${i}时出错:`, error);
                    // 出错时先尝试采样，如果采样也失败则使用原始数据
                    try {
                        const sampledPoints = window.points;
                        // 添加到原始数据数组
                        windowData.push({
                            ...window,
                            points: structuredClone(sampledPoints)
                        });
                        // 添加到处理数据数组
                        processedWindows.push({
                            ...window,
                            points: sampledPoints
                        });
                    } catch (sampleError) {
                        console.error(`窗${i}采样也失败:`, sampleError);
                        // 完全失败时使用原始数据
                        windowData.push(window);
                        processedWindows.push(window);
                    }
                }
            }
        }
        
        console.log(`门窗处理完成，处理后门数量: ${processedDoors.length}，窗数量: ${processedWindows.length}`);
        
        res.json({
            success: true,
            processed_doors: processedDoors,
            doors: doorData,
            processed_windows: processedWindows,
            windows: windowData,
            message: `处理完成，共${processedDoors.length}个门（已扩大50cm），${processedWindows.length}个窗（已扩大50cm）`
        });
    } catch (error) {
        console.error('门窗数据处理失败:', error);
        res.status(500).json({ 
            error: error.message,
            doors: parse_data.door_list || [],
            windows: parse_data.window_list || []
        });
    }
});


// 获取软装
app.get('/softlists', async (req, res) => {
    // let json = JSON.parse(readFileSync("C:/Users/User/Desktop/Drawing2.json", "utf-8"));
    // let parse_data = ParseJson(json); // 解析json数据
    try {
        // 检查数据是否已初始化
        if (!parse_data) {
            return res.status(503).json({ 
                error: '服务器数据尚未初始化完成，请稍后重试',
                status: 'initializing'
            });
        }
        res.json({
            success: true,
            softlists: parse_data.SoftLists || []
        });
    } catch (error) {
        console.error('房间数据处理失败:', error);
        res.status(500).json({ error: error.message });
    }
});


// 前端发来请求的软装id，服务端根据id读取文件返回数据；
app.get('/softlists_points', async (req, res) => {
    const { id } = req.query;
    
    // 验证ID参数是否存在
    if (!id) {
        return res.status(400).json({ error: '软装ID不能为空' });
    }
    
    // 验证ID格式，防止路径遍历攻击
    if (!/^[a-zA-Z0-9_]+$/.test(id)) {
        return res.status(400).json({ error: '软装ID格式不正确' });
    }
    
    // 构建文件路径（假设数据文件存放在server.js同级的data/softlists目录下）
    const filePath = path.join('C:','Users', 'User', 'desktop', 'parsed_dxf', `${id}.json`);
    
    try {
        // 读取文件内容
        const data = await fs.promises.readFile(filePath, 'utf8');
        // 解析JSON数据
        const result = JSON.parse(data);
        // 返回成功响应
        res.status(200).json(result);
    } catch (err) {
        // 处理不同类型的错误
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: '软装数据文件不存在' });
        } else if (err instanceof SyntaxError) {
            return res.status(400).json({ error: '文件内容格式错误，无法解析JSON' });
        } else {
            console.error('读取软装数据文件错误:', err);
            return res.status(500).json({ error: '服务器内部错误' });
        }
    }
});


/**
 * 执行解析器可执行文件
 * @param {string} executablePath - 可执行文件路径
 * @param {Array} args - 命令行参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeParser(executablePath, args = []) {
    return new Promise((resolve, reject) => {
        // 确保参数是数组类型
        if (!Array.isArray(args)) {
            reject(new TypeError('args必须是数组类型'));
            return;
        }

        const child = spawn(executablePath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log(`解析器输出: ${data}`);
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error(`解析器错误: ${data}`);
        });

        // 添加错误处理事件
        child.on('error', (err) => {
            console.error('进程启动失败:', err);
            reject(new Error(`执行解析器失败: ${err.message}`));
        });

        // 处理进程退出
        child.on('close', (code) => {
            console.log(`解析器进程退出，退出码: ${code}`);
            if (code !== 0) {
                reject(new Error(`解析器执行失败，退出码: ${code}, 错误信息: ${stderr}`));
                return;
            }
            
            // 成功时resolve Promise
            resolve({
                success: true,
                output: stdout,
                stderr: stderr,
                exitCode: code
            });
        });
    });
}

/**
 * 解析JSON文件的通用函数
 * @param {string} jsonFilePath - JSON文件路径
 * @param {string} executablePath - 可执行文件路径
 * @param {string} outputPath - 输出路径（可选）
 * @returns {Promise<Object>} 解析结果
 */
// async function parseJsonFile(jsonFilePath, executablePath, outputPath = null) {
//     try {
//         // 验证文件存在性
//         if (!fs.existsSync(jsonFilePath)) {
//             throw new Error('JSON文件不存在');
//         }
        
//         if (!fs.existsSync(executablePath)) {
//             throw new Error('可执行文件不存在');
//         }
        
//         // 构建参数
//         const args = [jsonFilePath];
//         if (outputPath) {
//             args.push(outputPath);
//         }
        
//         // 执行解析
//         const result = await executeParser(executablePath, args);
        
//         return {
//             success: result.success,
//             message: result.success ? '解析完成' : '解析失败',
//             output: result.output,
//             stderr: result.stderr,
//             exitCode: result.exitCode
//         };
        
//     } catch (error) {
//         return {
//             success: false,
//             message: '解析过程中发生错误',
//             error: error.message
//         };
//     }
// }

/**
 * 重新加载解析后的数据
 * @param {string} jsonFilePath - JSON文件路径
 */
// async function reloadParsedData(jsonFilePath) {
//     try {
//         console.log(`重新加载数据文件: ${jsonFilePath}`);
        
//         // 重新读取并解析JSON文件
//         const newJson = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
//         const newParseData = ParseJson(newJson);
        
//         // 转换数组格式
//         if (newParseData.Room_Points) {
//             newParseData.Room_Points.forEach((item, index) => {
//                 for (let i = 0; i < item.length; i++) {
//                     item[i] = Object.values(item[i]);
//                 }
//             });
//         }
        
//         // 更新全局变量
//         json = newJson;
//         parse_data = newParseData;
        
//         console.log('数据重新加载完成');
        
//     } catch (error) {
//         console.error('重新加载数据失败:', error);
//         throw error;
//     }
// }

// 添加根路由进行测试
app.get('/', (req, res) => {
    res.send(`
        <h1>OCCT 服务器运行中</h1>
        <p>可用的页面：</p>
        <ul>
            <li><a href="/start.html">启动页面</a></li>
            <li><a href="/index.html">新版应用</a></li>
            <li><a href="/visiualize.html">旧版应用</a></li>
        </ul>
        <p>API 端点：</p>
        <ul>
            <li><a href="/outline">外轮廓数据</a></li>
            <li><a href="/rooms">房间数据</a></li>
            <li><a href="/doors_and_windows">门窗数据</a></li>
            <li><a href="/softlists">软装列表数据</a></li>
            <li><a href="/softlists_points?id=1202">软装点数据</a></li>
        </ul>
    `);
});





// Chrome DevTools 特殊路径处理
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(404).json({ error: 'DevTools manifest not available' });
});

// 404 处理器
app.use((req, res) => {
    // 忽略Chrome DevTools的特殊请求日志
    if (!req.url.includes('.well-known')) {
        console.log('404 - 文件未找到:', req.url);
    }
    res.status(404).send(`
        <h1>404 - 页面未找到</h1>
        <p>请求的文件: <code>${req.url}</code></p>
        <p><a href="/">返回首页</a></p>
    `);
});

// 启动服务器
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
    console.log(`访问 http://localhost:${port}/outline 来获取外轮廓`);
    console.log(`访问 http://localhost:${port}/rooms 来获取房间数据`);
    console.log(`访问http://localhost:${port}/doors_and_windows 来获取房间数据`);
    console.log(`访问http://localhost:${port}/softlists 来获取软装数据`);
});




// function scaleWire(wire, scaleFactor, centerPoint = [0, 0, 0]) {
//     const transform = new oc.gp_Trsf_1();
//     const center = new oc.gp_Pnt_3(centerPoint[0], centerPoint[1], centerPoint[2]);
//     transform.SetScale(center, scaleFactor);

//     const transformer = new oc.BRepBuilderAPI_Transform_2(wire, transform, true);
//     const scaledShape = transformer.Shape();
    
//     // 从Shape中提取Wire
//     let exp = new oc.TopExp_Explorer_2(scaledShape, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
//     let resultWire = null;
//     if (exp.More()) {
//         resultWire = oc.TopoDS.Wire_1(exp.Current());
//     }

//     center.delete();
//     transformer.delete();
//     exp.delete();
//     return resultWire;
// }