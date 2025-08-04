/**
 * OpenCascade.js 布尔运算工具类
 * 负责 THREE.js Mesh 与 OpenCascade Shape 之间的转换和高精度布尔运算
 */

import * as THREE from 'three';

export class OCCTBooleanOperations {
    constructor(oc) {
        this.oc = oc;
        this.tolerance = 1e-3; // 默认1mm容差
        this.linearDeflection = 0.1; // 三角剖分线性偏差
        this.angularDeflection = 0.1; // 三角剖分角度偏差
    }

    /**
     * 设置布尔运算的模糊值（容差）
     * @param {number} tolerance - 容差值，单位mm
     */
    setFuzzyValue(tolerance) {
        this.tolerance = tolerance;
        console.log(`OCCT容差设置为: ${tolerance}mm`);
    }

    /**
     * 设置三角剖分参数
     * @param {number} linearDeflection - 线性偏差
     * @param {number} angularDeflection - 角度偏差
     */
    setTriangulationParams(linearDeflection, angularDeflection) {
        this.linearDeflection = linearDeflection;
        this.angularDeflection = angularDeflection;
    }

    /**
     * 将 THREE.js Mesh 转换为 OpenCascade Shape
     * @param {THREE.Mesh} mesh - THREE.js网格对象
     * @returns {TopoDS_Shape} OpenCascade形状对象
     */
    meshToOCCTShape(mesh) {
        try {
            console.log('开始将THREE.js Mesh转换为OCCT Shape...');
            
            const geometry = mesh.geometry;
            const positions = geometry.attributes.position.array;
            const indices = geometry.index ? geometry.index.array : null;
            
            // 创建三角形集合
            const triangles = [];
            
            if (indices) {
                // 有索引的几何体
                for (let i = 0; i < indices.length; i += 3) {
                    const i1 = indices[i] * 3;
                    const i2 = indices[i + 1] * 3;
                    const i3 = indices[i + 2] * 3;
                    
                    triangles.push([
                        [positions[i1], positions[i1 + 1], positions[i1 + 2]],
                        [positions[i2], positions[i2 + 1], positions[i2 + 2]],
                        [positions[i3], positions[i3 + 1], positions[i3 + 2]]
                    ]);
                }
            } else {
                // 无索引的几何体
                for (let i = 0; i < positions.length; i += 9) {
                    triangles.push([
                        [positions[i], positions[i + 1], positions[i + 2]],
                        [positions[i + 3], positions[i + 4], positions[i + 5]],
                        [positions[i + 6], positions[i + 7], positions[i + 8]]
                    ]);
                }
            }

            console.log(`提取了${triangles.length}个三角形`);

            // 使用三角形构建OCCT Shape
            return this.trianglesToOCCTShape(triangles);

        } catch (error) {
            console.error('THREE.js Mesh转OCCT Shape失败:', error);
            throw error;
        }
    }

    /**
     * 从三角形数组构建OCCT Shape
     * @param {Array} triangles - 三角形数组 [[[x,y,z], [x,y,z], [x,y,z]], ...]
     * @returns {TopoDS_Shape} OCCT形状对象
     */
    trianglesToOCCTShape(triangles) {
        try {
            // 创建复合形状构建器
            const builder = new this.oc.BRep_Builder_1();
            const compound = new this.oc.TopoDS_Compound();
            builder.MakeCompound(compound);

            // 为每个三角形创建面
            triangles.forEach((triangle, index) => {
                try {
                    const face = this.createTriangleFace(triangle);
                    if (face) {
                        builder.Add(compound, face);
                    }
                } catch (error) {
                    console.warn(`三角形${index}处理失败:`, error.message);
                }
            });

            // 尝试将复合形状融合为单一固体
            try {
                const sewing = new this.oc.BRepBuilderAPI_Sewing_2(this.tolerance);
                sewing.Add(compound);
                sewing.Perform(new this.oc.Message_ProgressRange_1());
                
                const sewedShape = sewing.SewedShape();
                sewing.delete();

                // 尝试构建固体
                const solidMaker = new this.oc.BRepBuilderAPI_MakeSolid_1();
                const shellExp = new this.oc.TopExp_Explorer_2(
                    sewedShape, 
                    this.oc.TopAbs_ShapeEnum.TopAbs_SHELL,
                    this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
                );

                while (shellExp.More()) {
                    const shell = this.oc.TopoDS.Shell_1(shellExp.Current());
                    solidMaker.Add(shell);
                    shellExp.Next();
                }

                shellExp.delete();

                if (solidMaker.IsDone()) {
                    const solid = solidMaker.Solid();
                    solidMaker.delete();
                    console.log('成功构建OCCT固体');
                    return solid;
                } else {
                    solidMaker.delete();
                    console.log('无法构建固体，返回缝合形状');
                    return sewedShape;
                }

            } catch (error) {
                console.warn('形状缝合失败，返回复合形状:', error.message);
                return compound;
            }

        } catch (error) {
            console.error('构建OCCT Shape失败:', error);
            throw error;
        }
    }

    /**
     * 从三个点创建三角形面
     * @param {Array} triangle - 三角形顶点 [[x,y,z], [x,y,z], [x,y,z]]
     * @returns {TopoDS_Face} OCCT面对象
     */
    createTriangleFace(triangle) {
        try {
            const [p1, p2, p3] = triangle;
            
            // 创建点
            const pnt1 = new this.oc.gp_Pnt_3(p1[0], p1[1], p1[2]);
            const pnt2 = new this.oc.gp_Pnt_3(p2[0], p2[1], p2[2]);
            const pnt3 = new this.oc.gp_Pnt_3(p3[0], p3[1], p3[2]);

            // 检查点是否共线
            const vec1 = new this.oc.gp_Vec_4(pnt1, pnt2);
            const vec2 = new this.oc.gp_Vec_4(pnt1, pnt3);
            const cross = vec1.Crossed(vec2);
            
            if (cross.Magnitude() < 1e-10) {
                // 点共线，跳过此三角形
                pnt1.delete();
                pnt2.delete();
                pnt3.delete();
                vec1.delete();
                vec2.delete();
                cross.delete();
                return null;
            }

            // 创建边
            const edge1 = new this.oc.BRepBuilderAPI_MakeEdge_3(pnt1, pnt2).Edge();
            const edge2 = new this.oc.BRepBuilderAPI_MakeEdge_3(pnt2, pnt3).Edge();
            const edge3 = new this.oc.BRepBuilderAPI_MakeEdge_3(pnt3, pnt1).Edge();

            // 创建线框
            const wireMaker = new this.oc.BRepBuilderAPI_MakeWire_1();
            wireMaker.Add_1(edge1);
            wireMaker.Add_1(edge2);
            wireMaker.Add_1(edge3);

            if (!wireMaker.IsDone()) {
                throw new Error('无法创建三角形线框');
            }

            const wire = wireMaker.Wire();

            // 创建面
            const faceMaker = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
            
            if (!faceMaker.IsDone()) {
                throw new Error('无法创建三角形面');
            }

            const face = faceMaker.Face();

            // 清理临时对象
            pnt1.delete();
            pnt2.delete();
            pnt3.delete();
            vec1.delete();
            vec2.delete();
            cross.delete();
            wireMaker.delete();
            faceMaker.delete();

            return face;

        } catch (error) {
            console.warn('创建三角形面失败:', error.message);
            return null;
        }
    }

    /**
     * 将 OpenCascade Shape 转换为 THREE.js Mesh
     * @param {TopoDS_Shape} shape - OpenCascade形状对象
     * @param {THREE.Material} material - THREE.js材质
     * @returns {THREE.Mesh} THREE.js网格对象
     */
    occtShapeToMesh(shape, material) {
        try {
            console.log('开始将OCCT Shape转换为THREE.js Mesh...');

            // 对形状进行三角剖分
            const triangulator = new this.oc.BRepMesh_IncrementalMesh_2(
                shape, 
                this.linearDeflection, 
                false, 
                this.angularDeflection,
                true
            );

            if (!triangulator.IsDone()) {
                throw new Error('OCCT形状三角剖分失败');
            }

            // 提取三角形数据
            const vertices = [];
            const indices = [];
            const normals = [];
            const uvs = [];

            let vertexIndex = 0;

            // 遍历所有面
            const faceExp = new this.oc.TopExp_Explorer_2(
                shape, 
                this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );

            while (faceExp.More()) {
                const face = this.oc.TopoDS.Face_1(faceExp.Current());
                
                try {
                    const triangulation = this.oc.BRep_Tool.Triangulation_1(face, new this.oc.TopLoc_Location_1());
                    
                    if (triangulation) {
                        const nodeCount = triangulation.NbNodes();
                        const triangleCount = triangulation.NbTriangles();

                        // 获取面的法向量
                        const surface = this.oc.BRep_Tool.Surface_2(face);
                        const faceOrientation = face.Orientation_1();

                        // 提取顶点
                        const faceVertices = [];
                        for (let i = 1; i <= nodeCount; i++) {
                            const node = triangulation.Node(i);
                            vertices.push(node.X(), node.Y(), node.Z());
                            faceVertices.push(vertexIndex++);

                            // 计算法向量（简化版本）
                            normals.push(0, 0, 1); // 临时法向量，后续可优化

                            // 生成UV坐标
                            uvs.push(0, 0); // 临时UV坐标，后续可优化
                        }

                        // 提取三角形索引
                        for (let i = 1; i <= triangleCount; i++) {
                            const triangle = triangulation.Triangle(i);
                            let n1 = triangle.Value(1) - 1;
                            let n2 = triangle.Value(2) - 1;
                            let n3 = triangle.Value(3) - 1;

                            // 根据面的方向调整三角形顶点顺序
                            if (faceOrientation === this.oc.TopAbs_Orientation.TopAbs_REVERSED) {
                                [n2, n3] = [n3, n2];
                            }

                            indices.push(
                                faceVertices[n1],
                                faceVertices[n2], 
                                faceVertices[n3]
                            );
                        }
                    }
                } catch (error) {
                    console.warn('处理面时出错:', error.message);
                }

                faceExp.Next();
            }

            faceExp.delete();
            triangulator.delete();

            // 创建THREE.js几何体
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);

            // 重新计算法向量
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            console.log(`成功转换: 顶点数=${vertices.length/3}, 三角形数=${indices.length/3}`);

            return new THREE.Mesh(geometry, material);

        } catch (error) {
            console.error('OCCT Shape转THREE.js Mesh失败:', error);
            throw error;
        }
    }

    /**
     * 执行布尔减法运算（A - B）
     * @param {THREE.Mesh} meshA - 被减数网格
     * @param {THREE.Mesh} meshB - 减数网格
     * @returns {Promise<THREE.Mesh>} 运算结果网格
     */
    async subtract(meshA, meshB) {
        try {
            console.log('开始OCCT布尔减法运算...');

            // 转换为OCCT形状
            const shapeA = this.meshToOCCTShape(meshA);
            const shapeB = this.meshToOCCTShape(meshB);

            // 执行布尔减法
            const result = await this.performBooleanOperation(shapeA, shapeB, 'subtract');
            
            // 转换回THREE.js网格
            const resultMesh = this.occtShapeToMesh(result, meshA.material);

            // 清理OCCT对象
            shapeA.delete();
            shapeB.delete();
            result.delete();

            console.log('OCCT布尔减法运算完成');
            return resultMesh;

        } catch (error) {
            console.error('OCCT布尔减法运算失败:', error);
            throw error;
        }
    }

    /**
     * 执行布尔并集运算（A ∪ B）
     * @param {THREE.Mesh} meshA - 网格A
     * @param {THREE.Mesh} meshB - 网格B
     * @returns {Promise<THREE.Mesh>} 运算结果网格
     */
    async union(meshA, meshB) {
        try {
            console.log('开始OCCT布尔并集运算...');

            const shapeA = this.meshToOCCTShape(meshA);
            const shapeB = this.meshToOCCTShape(meshB);

            const result = await this.performBooleanOperation(shapeA, shapeB, 'union');
            const resultMesh = this.occtShapeToMesh(result, meshA.material);

            shapeA.delete();
            shapeB.delete();
            result.delete();

            console.log('OCCT布尔并集运算完成');
            return resultMesh;

        } catch (error) {
            console.error('OCCT布尔并集运算失败:', error);
            throw error;
        }
    }

    /**
     * 执行布尔交集运算（A ∩ B）
     * @param {THREE.Mesh} meshA - 网格A
     * @param {THREE.Mesh} meshB - 网格B
     * @returns {Promise<THREE.Mesh>} 运算结果网格
     */
    async intersect(meshA, meshB) {
        try {
            console.log('开始OCCT布尔交集运算...');

            const shapeA = this.meshToOCCTShape(meshA);
            const shapeB = this.meshToOCCTShape(meshB);

            const result = await this.performBooleanOperation(shapeA, shapeB, 'intersect');
            const resultMesh = this.occtShapeToMesh(result, meshA.material);

            shapeA.delete();
            shapeB.delete();
            result.delete();

            console.log('OCCT布尔交集运算完成');
            return resultMesh;

        } catch (error) {
            console.error('OCCT布尔交集运算失败:', error);
            throw error;
        }
    }

    /**
     * 执行具体的布尔运算操作
     * @param {TopoDS_Shape} shapeA - OCCT形状A
     * @param {TopoDS_Shape} shapeB - OCCT形状B
     * @param {string} operation - 运算类型：'subtract', 'union', 'intersect'
     * @returns {Promise<TopoDS_Shape>} 运算结果形状
     */
    async performBooleanOperation(shapeA, shapeB, operation) {
        return new Promise((resolve, reject) => {
            try {
                let booleanOp;

                // 根据操作类型创建相应的布尔运算器
                switch (operation) {
                    case 'subtract':
                        booleanOp = new this.oc.BRepAlgoAPI_Cut_3(
                            shapeA, 
                            shapeB, 
                            new this.oc.Message_ProgressRange_1()
                        );
                        break;
                    case 'union':
                        booleanOp = new this.oc.BRepAlgoAPI_Fuse_3(
                            shapeA, 
                            shapeB, 
                            new this.oc.Message_ProgressRange_1()
                        );
                        break;
                    case 'intersect':
                        booleanOp = new this.oc.BRepAlgoAPI_Common_3(
                            shapeA, 
                            shapeB, 
                            new this.oc.Message_ProgressRange_1()
                        );
                        break;
                    default:
                        throw new Error(`不支持的布尔运算类型: ${operation}`);
                }

                // 设置模糊值（容差）
                booleanOp.SetFuzzyValue(this.tolerance);

                console.log(`执行${operation}运算，容差=${this.tolerance}mm`);

                // 执行运算
                booleanOp.Build(new this.oc.Message_ProgressRange_1());

                if (!booleanOp.IsDone()) {
                    booleanOp.delete();
                    throw new Error(`OCCT ${operation} 运算失败`);
                }

                const resultShape = booleanOp.Shape();
                booleanOp.delete();

                console.log(`OCCT ${operation} 运算成功`);
                resolve(resultShape);

            } catch (error) {
                console.error(`OCCT ${operation} 运算异常:`, error);
                reject(error);
            }
        });
    }

    /**
     * 验证形状的有效性
     * @param {TopoDS_Shape} shape - OCCT形状
     * @returns {boolean} 是否有效
     */
    validateShape(shape) {
        try {
            const analyzer = new this.oc.BRepCheck_Analyzer_1(shape);
            const isValid = analyzer.IsValid_1();
            analyzer.delete();
            return isValid;
        } catch (error) {
            console.error('形状验证失败:', error);
            return false;
        }
    }

    /**
     * 修复形状
     * @param {TopoDS_Shape} shape - 待修复的OCCT形状
     * @returns {TopoDS_Shape} 修复后的形状
     */
    fixShape(shape) {
        try {
            const fixer = new this.oc.ShapeFix_Shape_1();
            fixer.Init_1(shape);
            fixer.SetPrecision(this.tolerance);
            fixer.Perform(new this.oc.Message_ProgressRange_1());
            
            const fixedShape = fixer.Shape();
            fixer.delete();
            
            return fixedShape;
        } catch (error) {
            console.error('形状修复失败:', error);
            return shape;
        }
    }
}

// 导出单例工厂函数
export function createOCCTBooleanOperations(oc) {
    return new OCCTBooleanOperations(oc);
}