/**
 * OpenCascade.js Utility Functions
 * 用于几何处理的工具函数集合
 */

export class OpenCascadeUtils {
    constructor(oc) {
        this.oc = oc;
    }

    /**
     * 创建多边形Wire（支持矩形和复杂多边形）
     * @param {Array} points - 点数组，格式: [[x,y,z], [x,y,z], ...]
     * @returns {TopoDS_Wire|null} Wire对象或null
     */
    createPolygonWire(points) {
        try {
            console.log(`创建wire，点数: ${points.length}`);
            let wireBuilder = new this.oc.BRepBuilderAPI_MakeWire_1();
            
            for (let i = 0; i < points.length; i++) {
                let p1 = new this.oc.gp_Pnt_3(points[i][0], points[i][1], points[i][2]);
                let p2 = new this.oc.gp_Pnt_3(
                    points[(i + 1) % points.length][0], 
                    points[(i + 1) % points.length][1], 
                    points[(i + 1) % points.length][2]
                );
                
                // 检查点是否相同（避免创建长度为0的边）
                let distance = p1.Distance(p2);
                if (distance < 1e-6) {
                    console.log(`跳过长度为0的边: ${i} -> ${(i + 1) % points.length}`);
                    p1.delete();
                    p2.delete();
                    continue;
                }
                
                let edgeBuilder = new this.oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
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

    /**
     * 创建圆形Wire
     * @param {Array} center - 圆心坐标 [x, y, z]
     * @param {number} radius - 半径
     * @returns {TopoDS_Wire|null} Wire对象或null
     */
    createCircleWire(center, radius) {
        try {
            let centerPnt = new this.oc.gp_Pnt_3(center[0], center[1], center[2]);
            let normal = new this.oc.gp_Dir_3(new this.oc.gp_XYZ_2(0, 0, 1)); // Z轴方向
            let axis = new this.oc.gp_Ax2_3(centerPnt, normal);
            let circle = new this.oc.gp_Circ_2(axis, radius);

            // 从圆创建edge
            let edgeBuilder = new this.oc.BRepBuilderAPI_MakeEdge_8(circle);
            let edge = edgeBuilder.Edge();
            
            // 从edge创建wire
            let wireBuilder = new this.oc.BRepBuilderAPI_MakeWire_2(edge);
            let result = wireBuilder.Wire();
            
            // 清理内存
            centerPnt.delete();
            normal.delete();
            axis.delete();
            circle.delete();
            edgeBuilder.delete();
            wireBuilder.delete();
            
            return result;
        } catch (error) {
            console.log("createCircleWire异常:", error.message);
            return null;
        }
    }

    /**
     * Wire偏移操作
     * @param {TopoDS_Wire} wire - 输入Wire
     * @param {number} offset - 偏移距离
     * @returns {TopoDS_Wire|null} 偏移后的Wire或null
     */
    offsetWire(wire, offset) {
        try {
            let offsetAlgo = new this.oc.BRepOffsetAPI_MakeOffset_1();
            // 设置连接类型为尖角，保持矩形形状
            offsetAlgo.Init_2(this.oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
            offsetAlgo.AddWire(wire);
            
            offsetAlgo.Perform(offset, 0);
            
            let resultShape = offsetAlgo.Shape();
            
            // 从结果中提取第一个Wire
            let exp = new this.oc.TopExp_Explorer_2(resultShape, this.oc.TopAbs_ShapeEnum.TopAbs_WIRE, this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            let resultWire = null;
            if (exp.More()) {
                resultWire = this.oc.TopoDS.Wire_1(exp.Current());
            }
            
            exp.delete();
            offsetAlgo.delete();
            return resultWire;
            
        } catch (error) {
            console.log("offsetWire异常:", error.message);
            return null;
        }
    }

    /**
     * Wire缩放操作
     * @param {TopoDS_Wire} wire - 输入Wire
     * @param {number} scaleFactor - 缩放因子
     * @param {Array} centerPoint - 缩放中心点 [x, y, z]
     * @returns {TopoDS_Wire|null} 缩放后的Wire或null
     */
    scaleWire(wire, scaleFactor, centerPoint = [0, 0, 0]) {
        try {
            const transform = new this.oc.gp_Trsf_1();
            const center = new this.oc.gp_Pnt_3(centerPoint[0], centerPoint[1], centerPoint[2]);
            transform.SetScale(center, scaleFactor);

            const transformer = new this.oc.BRepBuilderAPI_Transform_2(wire, transform, true);
            const scaledShape = transformer.Shape();
            
            // 从Shape中提取Wire
            let exp = new this.oc.TopExp_Explorer_2(scaledShape, this.oc.TopAbs_ShapeEnum.TopAbs_WIRE, this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            let resultWire = null;
            if (exp.More()) {
                resultWire = this.oc.TopoDS.Wire_1(exp.Current());
            }

            center.delete();
            transformer.delete();
            exp.delete();
            return resultWire;
            
        } catch (error) {
            console.log("scaleWire异常:", error.message);
            return null;
        }
    }

    /**
     * 从Wire创建Face
     * @param {TopoDS_Wire} wire - 输入Wire
     * @returns {TopoDS_Face|null} Face对象或null
     */
    createFaceFromWire(wire) {
        if (!wire) {
            console.error("无法创建面：wire为空");
            return null;
        }
        
        try {
            // 先检查wire是否有效
            let wireChecker = new this.oc.BRepCheck_Wire(wire);
            console.log("Wire检查状态:", wireChecker.Status());
            
            // 尝试创建面
            let faceBuilder = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
            console.log("Face构建器状态:", faceBuilder.IsDone());
            
            if (!faceBuilder.IsDone()) {
                console.log("Face构建失败，尝试不同的构建方法");
                faceBuilder.delete();
                
                // 尝试另一种方法
                let faceBuilder2 = new this.oc.BRepBuilderAPI_MakeFace_5(wire);
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

    /**
     * 融合两个Shape
     * @param {TopoDS_Shape} shape1 - 第一个Shape
     * @param {TopoDS_Shape} shape2 - 第二个Shape
     * @returns {TopoDS_Shape|null} 融合后的Shape或null
     */
    fuseShapes(shape1, shape2) {
        try {
            let fuse = new this.oc.BRepAlgoAPI_Fuse_3(shape1, shape2, new this.oc.Message_ProgressRange_1());
            fuse.Build(new this.oc.Message_ProgressRange_1());
            
            if (!fuse.IsDone()) {
                console.error("融合操作失败");
                fuse.delete();
                return null;
            }
            
            let result = fuse.Shape();
            fuse.delete();
            return result;
            
        } catch (error) {
            console.log("fuseShapes异常:", error.message);
            return null;
        }
    }

    /**
     * 获取Shape的边界线Wire（改进版本）
     * @param {TopoDS_Shape} shape - 输入Shape
     * @param {number} tolerance - 容差
     * @returns {Array} Wire数组
     */
    getShapeBoundWires(shape, tolerance = 1e-6) {
        if (!shape) {
            console.log("getShapeBoundWires: shape为null");
            return [];
        }
        
        try {
            let boundsWire;
            
            // 检查形状类型
            if (shape.ShapeType() === this.oc.TopAbs_ShapeEnum.TopAbs_FACE) {
                boundsWire = shape;
            } else {
                try {
                    // 尝试使用正确的构造函数参数
                    let boundsAnalyzer = new this.oc.ShapeAnalysis_FreeBounds_2(shape, tolerance, true, true);
                    boundsWire = boundsAnalyzer.GetClosedWires();
                    boundsAnalyzer.delete();
                } catch (err) {
                    console.log("ShapeAnalysis_FreeBounds失败，使用fallback方法:", err.message);
                    // 如果失败，直接使用原始shape
                    boundsWire = shape;
                }
            }
            
            // 创建Wire映射
            let wireMap = new this.oc.TopTools_IndexedMapOfShape_1();
            this.oc.TopExp.MapShapes_1(boundsWire, this.oc.TopAbs_ShapeEnum.TopAbs_WIRE, wireMap);
            
            let retWires = [];
            
            // 遍历所有Wire
            for (let i = 1; i <= wireMap.Extent(); i++) {
                let wire = this.oc.TopoDS.Wire_1(wireMap.FindKey(i));
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
                return this.getOutlineWires(shape);
            }
            
            return retWires;
            
        } catch (error) {
            console.log("getShapeBoundWires异常，使用备选方法:", error.message);
            // 如果完全失败，使用原来的方法
            return this.getOutlineWires(shape);
        }
    }

    /**
     * 获取面的轮廓线（备选方法）
     * @param {TopoDS_Shape} face - 输入Face
     * @returns {Array} Wire数组
     */
    getOutlineWires(face) {
        try {
            let wires = [];
            let exp = new this.oc.TopExp_Explorer_2(face, this.oc.TopAbs_ShapeEnum.TopAbs_WIRE, this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            
            while (exp.More()) {
                wires.push(exp.Current());
                exp.Next();
            }
            
            exp.delete();
            return wires;
            
        } catch (error) {
            console.log("getOutlineWires异常:", error.message);
            return [];
        }
    }

    /**
     * 将Wire转换为点数组
     * @param {TopoDS_Wire} wire - 输入Wire
     * @returns {Array} 点数组 [[x,y,z], ...]
     */
    wireToPoints(wire) {
        if (!wire) {
            console.log("wireToPoints: wire为null");
            return [];
        }
        
        let points = [];
        try {
            // 确保传入的是TopoDS_Wire类型
            let wireObj = this.oc.TopoDS.Wire_1(wire);
            let exp = new this.oc.TopExp_Explorer_2(wireObj, this.oc.TopAbs_ShapeEnum.TopAbs_VERTEX, this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            
            while (exp.More()) {
                let vertex = this.oc.TopoDS.Vertex_1(exp.Current());
                let pnt = this.oc.BRep_Tool.Pnt(vertex);
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

    /**
     * 批量融合多个Face
     * @param {Array} faces - Face数组
     * @returns {TopoDS_Shape|null} 融合后的Shape或null
     */
    fuseFaces(faces) {
        if (!faces || faces.length === 0) {
            console.log("fuseFaces: faces数组为空");
            return null;
        }
        
        if (faces.length === 1) {
            return faces[0];
        }
        
        try {
            let result = faces[0];
            
            for (let i = 1; i < faces.length; i++) {
                console.log(`融合第${i}个面...`);
                result = this.fuseShapes(result, faces[i]);
                if (!result) {
                    console.log(`融合第${i}个面失败`);
                    return null;
                }
            }
            
            console.log("所有面融合完成");
            return result;
            
        } catch (error) {
            console.log("fuseFaces异常:", error.message);
            return null;
        }
    }
}

export default OpenCascadeUtils;