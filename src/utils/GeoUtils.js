/**
 * Geometry Utilities for OpenCascade.js
 * JavaScript port of GeoUtils.cpp
 */

export class GeoUtils {
    constructor(oc) {
        this.oc = oc;
    }

    /**
     * Create polygon face from points
     * @param {Array} points - Array of points [{x, y, z}, ...]
     * @returns {object|null} TopoDS_Face or null if failed
     */
    createPolygon(points) {
        if (!points || points.length <= 1) {
            return null;
        }

        try {
            const mkPoly = new this.oc.BRepBuilderAPI_MakePolygon_1();
            
            for (const point of points) {
                const gp_point = new this.oc.gp_Pnt_3(point.x, point.y, point.z);
                mkPoly.Add_1(gp_point);
                gp_point.delete();
            }

            if (mkPoly.IsDone()) {
                mkPoly.Close();
                const wire = mkPoly.Wire();
                const mkFace = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
                
                const face = mkFace.IsDone() ? mkFace.Face() : null;
                mkFace.delete();
                mkPoly.delete();
                return face;
            }

            mkPoly.delete();
            return null;

        } catch (error) {
            console.error('Create polygon failed:', error);
            return null;
        }
    }

    /**
     * Create polygon face from vertices with bulge values
     * @param {Array} vertices - Array of vertices with bulge [{x, y, z, bulge}, ...]
     * @returns {object|null} TopoDS_Face or null if failed
     */
    createPolygonWithBulge(vertices) {
        try {
            const wire = this.makeWireFromVerticesWithBulge(vertices);
            if (!wire || wire.IsNull()) {
                return null;
            }

            const faceBuilder = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
            if (!faceBuilder.IsDone()) {
                faceBuilder.delete();
                return null;
            }

            const face = faceBuilder.Face();
            faceBuilder.delete();
            return face;

        } catch (error) {
            console.error('Create polygon with bulge failed:', error);
            return null;
        }
    }

    /**
     * Create wire from points
     * @param {Array} points - Array of points [{x, y, z}, ...]
     * @returns {object|null} TopoDS_Wire or null if failed
     */
    createWireFromPoints(points) {
        if (!points || points.length < 2) {
            return null;
        }

        try {
            const mkWire = new this.oc.BRepBuilderAPI_MakeWire_1();

            for (let i = 0; i < points.length - 1; i++) {
                const p1 = new this.oc.gp_Pnt_3(points[i].x, points[i].y, points[i].z);
                const p2 = new this.oc.gp_Pnt_3(points[i + 1].x, points[i + 1].y, points[i + 1].z);
                
                const edge = new this.oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
                if (edge.IsDone()) {
                    mkWire.Add_1(edge.Edge());
                }
                
                p1.delete();
                p2.delete();
                edge.delete();
            }

            if (mkWire.IsDone()) {
                const wire = mkWire.Wire();
                mkWire.delete();
                return wire;
            }

            mkWire.delete();
            return null;

        } catch (error) {
            console.error('Create wire from points failed:', error);
            return null;
        }
    }

    /**
     * Create edge from two points
     * @param {object} startPoint - Start point {x, y, z}
     * @param {object} endPoint - End point {x, y, z}
     * @returns {object|null} TopoDS_Edge or null if failed
     */
    createEdgeFromPoints(startPoint, endPoint) {
        try {
            const p1 = new this.oc.gp_Pnt_3(startPoint.x, startPoint.y, startPoint.z);
            const p2 = new this.oc.gp_Pnt_3(endPoint.x, endPoint.y, endPoint.z);
            
            const edge = new this.oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
            const result = edge.IsDone() ? edge.Edge() : null;
            
            p1.delete();
            p2.delete();
            edge.delete();
            
            return result;

        } catch (error) {
            console.error('Create edge from points failed:', error);
            return null;
        }
    }

    /**
     * Create vertex from point
     * @param {object} point - Point {x, y, z}
     * @returns {object|null} TopoDS_Vertex or null if failed
     */
    makeVertex(point) {
        try {
            const gp_point = new this.oc.gp_Pnt_3(point.x, point.y, point.z);
            const vertex = new this.oc.BRepBuilderAPI_MakeVertex(gp_point);
            const result = vertex.Vertex();
            
            gp_point.delete();
            vertex.delete();
            
            return result;

        } catch (error) {
            console.error('Make vertex failed:', error);
            return null;
        }
    }

    /**
     * Create rectangle face
     * @param {number} length - Length of rectangle
     * @param {number} width - Width of rectangle
     * @returns {object|null} TopoDS_Face or null if failed
     */
    makeRectangle(length, width) {
        try {
            // Create points for rectangle
            const points = [
                { x: 0, y: 0, z: 0 },
                { x: length, y: 0, z: 0 },
                { x: length, y: width, z: 0 },
                { x: 0, y: width, z: 0 }
            ];

            return this.createPolygon(points);

        } catch (error) {
            console.error('Make rectangle failed:', error);
            return null;
        }
    }

    /**
     * Create circle wire
     * @param {number} radius - Radius of circle
     * @param {object} center - Center point {x, y, z}, default origin
     * @returns {object|null} TopoDS_Wire or null if failed
     */
    makeCircleWire(radius, center = { x: 0, y: 0, z: 0 }) {
        try {
            const centerPnt = new this.oc.gp_Pnt_3(center.x, center.y, center.z);
            const dir = new this.oc.gp_Dir_4(0, 0, 1); // Z-axis direction
            const ax2 = new this.oc.gp_Ax2_3(centerPnt, dir);
            const circle = new this.oc.gp_Circ_2(ax2, radius);
            
            const edge = new this.oc.BRepBuilderAPI_MakeEdge_8(circle);
            const wire = new this.oc.BRepBuilderAPI_MakeWire_2(edge.Edge());
            
            const result = wire.IsDone() ? wire.Wire() : null;
            
            centerPnt.delete();
            dir.delete();
            ax2.delete();
            circle.delete();
            edge.delete();
            wire.delete();
            
            return result;

        } catch (error) {
            console.error('Make circle wire failed:', error);
            return null;
        }
    }

    /**
     * Create circle face
     * @param {number} radius - Radius of circle
     * @param {object} center - Center point {x, y, z}, default origin
     * @returns {object|null} TopoDS_Face or null if failed
     */
    makeCircleFace(radius, center = { x: 0, y: 0, z: 0 }) {
        try {
            const wire = this.makeCircleWire(radius, center);
            if (!wire || wire.IsNull()) {
                return null;
            }

            const face = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
            const result = face.IsDone() ? face.Face() : null;
            
            face.delete();
            return result;

        } catch (error) {
            console.error('Make circle face failed:', error);
            return null;
        }
    }

    /**
     * Create box solid
     * @param {number} length - Length of box
     * @param {number} width - Width of box  
     * @param {number} height - Height of box
     * @returns {object|null} TopoDS_Shape or null if failed
     */
    makeBox(length, width, height) {
        try {
            const box = new this.oc.BRepPrimAPI_MakeBox_2(length, width, height);
            const result = box.IsDone() ? box.Shape() : null;
            
            box.delete();
            return result;

        } catch (error) {
            console.error('Make box failed:', error);
            return null;
        }
    }

    /**
     * Create cylinder solid
     * @param {number} radius - Radius of cylinder
     * @param {number} height - Height of cylinder
     * @param {number} angle - Angle in radians, default full circle
     * @returns {object|null} TopoDS_Shape or null if failed
     */
    makeCylinder(radius, height, angle = 2 * Math.PI) {
        try {
            const cylinder = new this.oc.BRepPrimAPI_MakeCylinder_2(radius, height, angle);
            const result = cylinder.IsDone() ? cylinder.Shape() : null;
            
            cylinder.delete();
            return result;

        } catch (error) {
            console.error('Make cylinder failed:', error);
            return null;
        }
    }

    /**
     * Create pad (extrusion) from face
     * @param {number} height - Extrusion height
     * @param {object} profileFace - Profile face to extrude
     * @returns {object|null} TopoDS_Shape or null if failed
     */
    makePad(height, profileFace) {
        try {
            const direction = new this.oc.gp_Dir_4(0, 0, 1); // Z direction
            const prism = new this.oc.BRepPrimAPI_MakePrism_1(profileFace, new this.oc.gp_Vec_4(direction, height));
            
            const result = prism.IsDone() ? prism.Shape() : null;
            
            direction.delete();
            prism.delete();
            return result;

        } catch (error) {
            console.error('Make pad failed:', error);
            return null;
        }
    }

    /**
     * Create face from closed wire
     * @param {object} wire - Closed wire
     * @returns {object|null} TopoDS_Face or null if failed
     */
    makeFaceFromClosedWire(wire) {
        try {
            const face = new this.oc.BRepBuilderAPI_MakeFace_15(wire, true);
            const result = face.IsDone() ? face.Face() : null;
            
            face.delete();
            return result;

        } catch (error) {
            console.error('Make face from closed wire failed:', error);
            return null;
        }
    }

    /**
     * Create wire from vertices with bulge values
     * @param {Array} vertices - Array of vertices with bulge [{x, y, z, bulge}, ...]
     * @param {boolean} autoLoop - Auto close the wire
     * @returns {object|null} TopoDS_Wire or null if failed
     */
    makeWireFromVerticesWithBulge(vertices, autoLoop = true) {
        if (!vertices || vertices.length < 2) {
            return null;
        }

        try {
            const mkWire = new this.oc.BRepBuilderAPI_MakeWire_1();
            
            for (let i = 0; i < vertices.length; i++) {
                const currentVertex = vertices[i];
                const nextVertex = vertices[(i + 1) % vertices.length];
                
                // Skip last iteration if not auto-looping
                if (!autoLoop && i === vertices.length - 1) {
                    break;
                }

                let edge = null;
                
                // Check if current vertex has bulge (curved segment)
                if (currentVertex.bulge && Math.abs(currentVertex.bulge) > 1e-6) {
                    edge = this.createArcEdge(currentVertex, nextVertex, currentVertex.bulge);
                } else {
                    // Create straight line edge
                    edge = this.createEdgeFromPoints(currentVertex, nextVertex);
                }
                
                if (edge && !edge.IsNull()) {
                    mkWire.Add_1(edge);
                }
            }

            if (mkWire.IsDone()) {
                const wire = mkWire.Wire();
                mkWire.delete();
                return wire;
            }

            mkWire.delete();
            return null;

        } catch (error) {
            console.error('Make wire from vertices with bulge failed:', error);
            return null;
        }
    }

    /**
     * Create arc edge from two points and bulge value
     * @param {object} startPoint - Start point {x, y, z, bulge}
     * @param {object} endPoint - End point {x, y, z}
     * @param {number} bulge - Bulge value
     * @returns {object|null} TopoDS_Edge or null if failed
     */
    createArcEdge(startPoint, endPoint, bulge) {
        try {
            // Calculate arc parameters from bulge
            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const chordLength = Math.sqrt(dx * dx + dy * dy);

            if (chordLength < 1e-10) {
                return this.createEdgeFromPoints(startPoint, endPoint);
            }

            // Calculate arc center and radius
            const theta = 2 * Math.atan(Math.abs(bulge));
            const radius = chordLength / (2 * Math.sin(theta));

            // Calculate perpendicular direction
            const perpDirX = -dy / chordLength;
            const perpDirY = dx / chordLength;

            // Calculate center point
            const chordMidX = (startPoint.x + endPoint.x) / 2;
            const chordMidY = (startPoint.y + endPoint.y) / 2;
            const centerOffset = radius * Math.cos(theta);
            
            const centerX = chordMidX + perpDirX * centerOffset * (bulge > 0 ? 1 : -1);
            const centerY = chordMidY + perpDirY * centerOffset * (bulge > 0 ? 1 : -1);
            const centerZ = startPoint.z; // Assume planar arc

            // Create arc
            const center = new this.oc.gp_Pnt_3(centerX, centerY, centerZ);
            const start = new this.oc.gp_Pnt_3(startPoint.x, startPoint.y, startPoint.z);
            const end = new this.oc.gp_Pnt_3(endPoint.x, endPoint.y, endPoint.z);

            // Create circle and trim to arc
            const dir = new this.oc.gp_Dir_4(0, 0, 1); // Z-axis
            const ax2 = new this.oc.gp_Ax2_3(center, dir);
            const circle = new this.oc.gp_Circ_2(ax2, radius);

            // Calculate parameter values
            const startParam = this.calculateCircleParameter(circle, start);
            const endParam = this.calculateCircleParameter(circle, end);

            const edge = new this.oc.BRepBuilderAPI_MakeEdge_9(circle, startParam, endParam);
            const result = edge.IsDone() ? edge.Edge() : null;

            // Clean up
            center.delete();
            start.delete();
            end.delete();
            dir.delete();
            ax2.delete();
            circle.delete();
            edge.delete();

            return result;

        } catch (error) {
            console.error('Create arc edge failed:', error);
            return this.createEdgeFromPoints(startPoint, endPoint);
        }
    }

    /**
     * Calculate parameter value for point on circle
     * @param {object} circle - gp_Circ
     * @param {object} point - gp_Pnt
     * @returns {number} Parameter value
     */
    calculateCircleParameter(circle, point) {
        try {
            // Project point to circle and get parameter
            const center = circle.Location();
            const dx = point.X() - center.X();
            const dy = point.Y() - center.Y();
            
            return Math.atan2(dy, dx);

        } catch (error) {
            console.error('Calculate circle parameter failed:', error);
            return 0;
        }
    }

    /**
     * Get offset wire
     * @param {object} wire - Input wire
     * @param {number} offset - Offset distance
     * @returns {object|null} TopoDS_Wire or null if failed
     */
    getOffsetWire(wire, offset) {
        try {
            const offsetAlgo = new this.oc.BRepOffsetAPI_MakeOffset_1();
            offsetAlgo.Init_2(this.oc.GeomAbs_JoinType.GeomAbs_Intersection, false);
            offsetAlgo.AddWire(wire);
            offsetAlgo.Perform(offset, 0);

            const resultShape = offsetAlgo.Shape();
            
            // Extract first wire from result
            const exp = new this.oc.TopExp_Explorer_2(
                resultShape,
                this.oc.TopAbs_ShapeEnum.TopAbs_WIRE,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );
            
            let resultWire = null;
            if (exp.More()) {
                resultWire = this.oc.TopoDS.Wire_1(exp.Current());
            }

            exp.delete();
            offsetAlgo.delete();
            
            return resultWire;

        } catch (error) {
            console.error('Get offset wire failed:', error);
            return null;
        }
    }

    /**
     * Fuse multiple shapes
     * @param {Array} shapes - Array of shapes to fuse
     * @param {number} tolerance - Tolerance for operation
     * @returns {object|null} Fused shape or null if failed
     */
    fuseShapes(shapes, tolerance = 1e-6) {
        if (!shapes || shapes.length === 0) {
            return null;
        }

        if (shapes.length === 1) {
            return shapes[0];
        }

        try {
            let result = shapes[0];
            
            for (let i = 1; i < shapes.length; i++) {
                const fuse = new this.oc.BRepAlgoAPI_Fuse_3(result, shapes[i], new this.oc.Message_ProgressRange_1());
                fuse.Build(new this.oc.Message_ProgressRange_1());
                
                if (fuse.IsDone()) {
                    result = fuse.Shape();
                } else {
                    console.warn(`Fuse operation ${i} failed`);
                }
                
                fuse.delete();
            }

            return result;

        } catch (error) {
            console.error('Fuse shapes failed:', error);
            return null;
        }
    }

    /**
     * Cut tool shapes from base shape
     * @param {object} baseShape - Base shape
     * @param {Array} toolShapes - Array of tool shapes
     * @param {number} tolerance - Tolerance for operation
     * @returns {object|null} Result shape or null if failed
     */
    cutToolShapesFromBaseShape(baseShape, toolShapes, tolerance = 1e-6) {
        if (!baseShape || !toolShapes || toolShapes.length === 0) {
            return baseShape;
        }

        try {
            let result = baseShape;

            for (const toolShape of toolShapes) {
                if (toolShape && !toolShape.IsNull()) {
                    const cut = new this.oc.BRepAlgoAPI_Cut_3(result, toolShape, new this.oc.Message_ProgressRange_1());
                    cut.Build(new this.oc.Message_ProgressRange_1());
                    
                    if (cut.IsDone()) {
                        result = cut.Shape();
                    } else {
                        console.warn('Cut operation failed');
                    }
                    
                    cut.delete();
                }
            }

            return result;

        } catch (error) {
            console.error('Cut tool shapes from base shape failed:', error);
            return baseShape;
        }
    }

    /**
     * Build triangulation from shape
     * @param {object} shape - Input shape
     * @param {number} linearDeflection - Linear deflection for meshing
     * @param {number} angularDeflection - Angular deflection for meshing
     * @returns {Array} Array of triangulation data
     */
    buildTriangulationFromShape(shape, linearDeflection = 0.1, angularDeflection = 0.5) {
        const triangulations = [];

        try {
            // Build mesh
            const mesh = new this.oc.BRepMesh_IncrementalMesh_2(shape, linearDeflection, false, angularDeflection, true);
            mesh.Perform();

            // Extract triangulations from faces
            const faceExp = new this.oc.TopExp_Explorer_2(
                shape,
                this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );

            while (faceExp.More()) {
                const face = this.oc.TopoDS.Face_1(faceExp.Current());
                const location = new this.oc.TopLoc_Location_1();
                const triangulation = this.oc.BRep_Tool.Triangulation(face, location);

                if (!triangulation.IsNull()) {
                    const vertices = [];
                    const indices = [];
                    const normals = [];

                    // Extract vertices
                    const nodeCount = triangulation.NbNodes();
                    for (let i = 1; i <= nodeCount; i++) {
                        const node = triangulation.Node(i);
                        vertices.push({
                            x: node.X(),
                            y: node.Y(),
                            z: node.Z()
                        });
                    }

                    // Extract triangles
                    const triangleCount = triangulation.NbTriangles();
                    for (let i = 1; i <= triangleCount; i++) {
                        const triangle = triangulation.Triangle(i);
                        let n1 = triangle.Value(1) - 1;
                        let n2 = triangle.Value(2) - 1;
                        let n3 = triangle.Value(3) - 1;

                        // Handle face orientation
                        if (face.Orientation_1() === this.oc.TopAbs_Orientation.TopAbs_REVERSED) {
                            [n2, n3] = [n3, n2];
                        }

                        indices.push(n1, n2, n3);
                    }

                    triangulations.push({
                        vertices: vertices,
                        indices: indices,
                        normals: normals
                    });
                }

                location.delete();
                faceExp.Next();
            }

            mesh.delete();
            faceExp.delete();

        } catch (error) {
            console.error('Build triangulation from shape failed:', error);
        }

        return triangulations;
    }

    /**
     * Copy shape
     * @param {object} shape - Shape to copy
     * @returns {object|null} Copied shape or null if failed
     */
    copyShape(shape) {
        try {
            const builder = new this.oc.BRepBuilderAPI_Copy_2(shape, true, true);
            const result = builder.Shape();
            
            builder.delete();
            return result;

        } catch (error) {
            console.error('Copy shape failed:', error);
            return null;
        }
    }

    /**
     * Transform shape
     * @param {object} shape - Shape to transform
     * @param {object} transform - Transform object {translation: {x,y,z}, rotation: {x,y,z}, scale: number}
     * @returns {object|null} Transformed shape or null if failed
     */
    transformShape(shape, transform) {
        try {
            const trsf = new this.oc.gp_Trsf_1();
            
            // Apply translation
            if (transform.translation) {
                const vec = new this.oc.gp_Vec_4(transform.translation.x, transform.translation.y, transform.translation.z);
                trsf.SetTranslation_1(vec);
                vec.delete();
            }
            
            // Apply scale
            if (transform.scale && transform.scale !== 1) {
                const origin = new this.oc.gp_Pnt_1();
                trsf.SetScale(origin, transform.scale);
                origin.delete();
            }

            const transformer = new this.oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
            const result = transformer.Shape();
            
            trsf.delete();
            transformer.delete();
            
            return result;

        } catch (error) {
            console.error('Transform shape failed:', error);
            return null;
        }
    }

    /**
     * Check if shape is closed
     * @param {object} shape - Shape to check
     * @returns {boolean} True if shape is closed
     */
    isShapeClosed(shape) {
        try {
            const analyzer = new this.oc.BRepCheck_Analyzer_2(shape, false);
            const isValid = analyzer.IsValid_1();
            
            analyzer.delete();
            return isValid;

        } catch (error) {
            console.error('Check shape closed failed:', error);
            return false;
        }
    }

    /**
     * Get shape edges
     * @param {object} shape - Input shape
     * @returns {Array} Array of edges
     */
    getShapeEdges(shape) {
        const edges = [];
        
        try {
            const edgeExp = new this.oc.TopExp_Explorer_2(
                shape,
                this.oc.TopAbs_ShapeEnum.TopAbs_EDGE,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );

            while (edgeExp.More()) {
                const edge = this.oc.TopoDS.Edge_1(edgeExp.Current());
                edges.push(edge);
                edgeExp.Next();
            }

            edgeExp.delete();

        } catch (error) {
            console.error('Get shape edges failed:', error);
        }

        return edges;
    }

    /**
     * Get shape faces
     * @param {object} shape - Input shape
     * @returns {Array} Array of faces
     */
    getShapeFaces(shape) {
        const faces = [];
        
        try {
            const faceExp = new this.oc.TopExp_Explorer_2(
                shape,
                this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );

            while (faceExp.More()) {
                const face = this.oc.TopoDS.Face_1(faceExp.Current());
                faces.push(face);
                faceExp.Next();
            }

            faceExp.delete();

        } catch (error) {
            console.error('Get shape faces failed:', error);
        }

        return faces;
    }

    /**
     * Get shape vertices as points
     * @param {object} shape - Input shape
     * @returns {Array} Array of points [{x, y, z}, ...]
     */
    getShapeVertices(shape) {
        const points = [];
        
        try {
            const vertexExp = new this.oc.TopExp_Explorer_2(
                shape,
                this.oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
                this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            );

            while (vertexExp.More()) {
                const vertex = this.oc.TopoDS.Vertex_1(vertexExp.Current());
                const point = this.oc.BRep_Tool.Pnt(vertex);
                
                points.push({
                    x: point.X(),
                    y: point.Y(),
                    z: point.Z()
                });
                
                vertexExp.Next();
            }

            vertexExp.delete();

        } catch (error) {
            console.error('Get shape vertices failed:', error);
        }

        return points;
    }
}