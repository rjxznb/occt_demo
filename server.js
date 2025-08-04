import initOpenCascade from "opencascade.js/dist/node.js"
import express from 'express';
import ParseJson from "./json_parse.js";
import {readFileSync} from "node:fs";



let oc = await initOpenCascade();


// 读取JSON文件并解析
let json = JSON.parse(readFileSync("C:/Users/User/Desktop/Drawing2.json", "utf-8"));
let parse_data = ParseJson(json); // 解析json数据

// 转换成数组；
parse_data.Room_Points.forEach((item, index) => {
    for (let i = 0; i < item.length; i++) {
        item[i] = Object.values(item[i]);
    }
});


// 构建多边形的wire（不仅限于矩形）
function createPolygonWire(points) {
    try {
        console.log(`创建wire，点数: ${points.length}`);
        let wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
        
        for (let i = 0; i < points.length; i++) {
            let p1 = new oc.gp_Pnt_3(points[i][0], points[i][1], points[i][2]);
            let p2 = new oc.gp_Pnt_3(points[(i + 1) % points.length][0], points[(i + 1) % points.length][1], points[(i + 1) % points.length][2]);
            
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

// 在Express应用中添加CORS支持
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
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


// 注册GET方法回调函数
// 在Express应用中调整处理逻辑
app.get('/outline', async (req, res) => {
    try {
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
                    const sampledPoints = sampleAllArcs(door.points);
                    console.log(`门${i}采样后点数量:`, sampledPoints.length);

                    doorData.push({
                        ...door,
                        points: structuredClone(sampledPoints)
                    });
                    
                    // 转换点格式为3D坐标
                    const points3D = sampledPoints.map(point => [point.x, point.y, 0]);
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
                        const sampledPoints = sampleAllArcs(door.points);
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
                    const sampledPoints = sampleAllArcs(window.points);
                    console.log(`窗${i}采样前点数量: ${window.points.length}, 采样后点数量: ${sampledPoints.length}`);
                    
                    windowData.push({
                        ...window,
                        points: structuredClone(sampledPoints)
                    });
                    

                    // 转换点格式为3D坐标
                    const points3D = sampledPoints.map(point => [point.x, point.y, 0]);
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
                        const sampledPoints = sampleAllArcs(window.points);
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