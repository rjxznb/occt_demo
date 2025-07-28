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

// console.log(parse_data.Room_Points);

// 构建多边形的wire（不仅限于矩形）
function createRectWire(points) {
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
        console.log("createRectWire异常:", error.message);
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

// 在Express应用中添加CORS支持
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});


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
                let wire = createRectWire(parse_data.Room_Points[i]);
                let offsetWires = offsetWire(wire, 240); // 5cm = 50mm
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
        // wireToPoints(scaleWire(wire1, 2, [0, 0, 0])); // 缩小wire1为原来的一半
        
        // 2. 向外平移5cm
        // let offsetWires1 = offsetWire(wire1, 50); // 5cm = 50mm
        // let offsetWires2 = offsetWire(wire2, 50);
        
        // if (!offsetWires1 || !offsetWires2) {
        //     return res.status(500).json({ error: "偏移操作失败" });
        // }
        
        // 3. 从平移后的wire构成面（使用第一个wire）


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
        console.log("开始处理房间数据...");
        
        let roomPoints = [];
        
        // 为每个房间创建偏移后的点数据
        for(let i = 0; i < parse_data.Room_Points.length; i++) {
            console.log(`处理第${i}个房间...`);
            
            try {
                let wire = createRectWire(parse_data.Room_Points[i]);
                if (!wire) {
                    console.log(`第${i}个房间wire创建失败，跳过`);
                    continue;
                }
                
                // 不进行偏移，直接使用原始房间边界
                let points = wireToPoints(wire);
                if (points.length > 0) {
                    roomPoints.push(points);
                    console.log(`第${i}个房间处理完成，点数: ${points.length}`);
                } else {
                    console.log(`第${i}个房间点提取失败`);
                }
                
            } catch (error) {
                console.log(`处理第${i}个房间时出错:`, error.message);
            }
        }
        
        console.log(`房间数据处理完成，总共${roomPoints.length}个房间`);
        
        // 返回结果
        res.json({
            success: true,
            roomPoints: roomPoints,
            message: `处理完成，共${roomPoints.length}个房间`
        });
        
    } catch (error) {
        console.error('房间数据处理失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
    console.log(`访问 http://localhost:${port}/outline 来获取外轮廓`);
    console.log(`访问 http://localhost:${port}/rooms 来获取房间数据`);
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