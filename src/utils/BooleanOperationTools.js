/**
 * Boolean Operation Tools for OpenCascade.js
 * JavaScript port of BooleanOperationTools.cpp
 */

// Boolean operation types enum
export const BooleanOperationType = {
    BOP_Cut: 'cut',
    BOP_Fuse: 'fuse', 
    BOP_Common: 'common',
    BOP_Section: 'section'
};

// Face change types enum
export const EFaceChangeType = {
    Unchanged: 'unchanged',
    Modified: 'modified',
    Deleted: 'deleted',
    Split: 'split',
    Generated: 'generated'
};

export class BooleanOperationTools {
    constructor(oc) {
        this.oc = oc;
    }

    /**
     * Build shape from boolean operation
     * @param {string} booleanType - Type of boolean operation
     * @param {Array} baseShapes - Array of base shapes
     * @param {Array} toolShapes - Array of tool shapes
     * @param {number} tolerance - Tolerance for operation
     * @returns {object|null} Result shape or null if failed
     */
    buildShapeFromBooleanOperation(booleanType, baseShapes, toolShapes, tolerance = 1e-6) {
        let booleanOperation = null;
        
        try {
            // Create appropriate boolean operation
            switch (booleanType) {
                case BooleanOperationType.BOP_Cut:
                    booleanOperation = new this.oc.BRepAlgoAPI_Cut_3();
                    break;
                case BooleanOperationType.BOP_Fuse:
                    booleanOperation = new this.oc.BRepAlgoAPI_Fuse_3();
                    break;
                case BooleanOperationType.BOP_Common:
                    booleanOperation = new this.oc.BRepAlgoAPI_Common_3();
                    break;
                case BooleanOperationType.BOP_Section:
                    booleanOperation = new this.oc.BRepAlgoAPI_Section_3();
                    break;
                default:
                    console.error('Invalid boolean operation type:', booleanType);
                    return null;
            }

            if (!booleanOperation) {
                return null;
            }

            // Create shape lists
            const shapeArguments = new this.oc.TopTools_ListOfShape_1();
            const shapeTools = new this.oc.TopTools_ListOfShape_1();

            // Add base shapes to arguments
            baseShapes.forEach(shape => {
                if (shape) {
                    shapeArguments.Append_1(shape);
                }
            });

            // Add tool shapes to tools
            toolShapes.forEach(shape => {
                if (shape) {
                    shapeTools.Append_1(shape);
                }
            });

            // Set up operation
            booleanOperation.SetArguments(shapeArguments);
            booleanOperation.SetTools(shapeTools);
            booleanOperation.SetFuzzyValue(tolerance);

            // Build operation
            const progressRange = new this.oc.Message_ProgressRange_1();
            booleanOperation.Build(progressRange);

            let resultShape = null;
            if (booleanOperation.IsDone()) {
                resultShape = booleanOperation.Shape();
            }

            // Clean up
            shapeArguments.delete();
            shapeTools.delete();
            progressRange.delete();
            booleanOperation.delete();

            return resultShape;

        } catch (error) {
            console.error('Boolean operation failed:', error);
            
            // Clean up on error
            if (booleanOperation) {
                booleanOperation.delete();
            }
            
            return null;
        }
    }

    /**
     * Build triangulation from boolean operation result
     * @param {string} booleanType - Type of boolean operation
     * @param {Array} baseShapes - Array of base shapes  
     * @param {Array} toolShapes - Array of tool shapes
     * @param {number} tolerance - Tolerance for operation
     * @returns {Array} Array of triangulation data
     */
    buildTriangulationFromBooleanOperation(booleanType, baseShapes, toolShapes, tolerance = 1e-6) {
        const resultShape = this.buildShapeFromBooleanOperation(booleanType, baseShapes, toolShapes, tolerance);
        
        if (resultShape && !resultShape.IsNull()) {
            return this.buildTriangulationFromShape(resultShape);
        }
        
        return [];
    }

    /**
     * Build triangulation data from shape
     * @param {object} shape - OpenCascade shape
     * @returns {Array} Array of triangulation data
     */
    buildTriangulationFromShape(shape) {
        const triangulations = [];
        
        try {
            // Build mesh for the shape
            const meshBuilder = new this.oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, true);
            meshBuilder.Perform();

            // Extract triangulation from faces
            const faceExplorer = new this.oc.TopExp_Explorer_2(shape, this.oc.TopAbs_ShapeEnum.TopAbs_FACE, this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            
            while (faceExplorer.More()) {
                const face = this.oc.TopoDS.Face_1(faceExplorer.Current());
                const location = new this.oc.TopLoc_Location_1();
                const triangulation = this.oc.BRep_Tool.Triangulation(face, location);
                
                if (!triangulation.IsNull()) {
                    const vertices = [];
                    const indices = [];
                    
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
                    
                    // Extract triangle indices
                    const triangleCount = triangulation.NbTriangles();
                    for (let i = 1; i <= triangleCount; i++) {
                        const triangle = triangulation.Triangle(i);
                        let n1 = triangle.Value(1) - 1; // Convert to 0-based
                        let n2 = triangle.Value(2) - 1;
                        let n3 = triangle.Value(3) - 1;
                        
                        // Check face orientation
                        if (face.Orientation_1() === this.oc.TopAbs_Orientation.TopAbs_REVERSED) {
                            [n2, n3] = [n3, n2]; // Reverse winding
                        }
                        
                        indices.push(n1, n2, n3);
                    }
                    
                    triangulations.push({
                        vertices: vertices,
                        indices: indices
                    });
                }
                
                location.delete();
                faceExplorer.Next();
            }
            
            meshBuilder.delete();
            faceExplorer.delete();
            
        } catch (error) {
            console.error('Triangulation extraction failed:', error);
        }
        
        return triangulations;
    }
}

/**
 * Simple Face Change Tracker for OpenCascade.js
 * JavaScript port of FSimpleFaceChangeTracker
 */
export class SimpleFaceChangeTracker {
    constructor(oc) {
        this.oc = oc;
        this.originalShape = null;
        this.resultShape = null;
        this.faceChanges = [];
        this.operationSteps = [];
    }

    /**
     * Begin tracking face changes
     * @param {object} originalShape - Original shape to track
     */
    beginTracking(originalShape) {
        this.originalShape = originalShape;
        this.faceChanges = [];
        this.operationSteps = [];
    }

    /**
     * Add operation step for tracking
     * @param {object} inputShape - Input shape
     * @param {object} outputShape - Output shape  
     * @param {object} history - Operation history
     * @param {string} operationName - Name of operation
     */
    addOperationStep(inputShape, outputShape, history, operationName) {
        this.operationSteps.push({
            inputShape: inputShape,
            outputShape: outputShape,
            history: history,
            operationName: operationName
        });
    }

    /**
     * End tracking with steps
     * @param {object} resultShape - Final result shape
     */
    endTrackingWithSteps(resultShape) {
        this.resultShape = resultShape;
        this.analyzeFaceChangesWithSteps();
    }

    /**
     * Analyze face changes through operation steps
     */
    analyzeFaceChangesWithSteps() {
        this.faceChanges = [];
        
        if (!this.originalShape) {
            return;
        }

        // Analyze each face in original shape
        const originalFaceExplorer = new this.oc.TopExp_Explorer_2(
            this.originalShape, 
            this.oc.TopAbs_ShapeEnum.TopAbs_FACE, 
            this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );
        
        let originalFaceIndex = 0;
        
        while (originalFaceExplorer.More()) {
            const originalFace = this.oc.TopoDS.Face_1(originalFaceExplorer.Current());
            
            const changeInfo = {
                originalFace: originalFace,
                originalFaceID: `Face_${originalFaceIndex}`,
                changeType: EFaceChangeType.Unchanged,
                resultingFaces: [],
                resultingFaceIDs: []
            };

            // Track face through all operation steps
            let currentFaces = [originalFace];
            let faceDeleted = false;

            console.log(`Tracking face ${changeInfo.originalFaceID} through ${this.operationSteps.length} operations`);

            for (let stepIndex = 0; stepIndex < this.operationSteps.length; stepIndex++) {
                const step = this.operationSteps[stepIndex];
                const nextFaces = [];

                console.log(`  Step ${stepIndex} (${step.operationName}): ${currentFaces.length} faces`);

                for (const currentFace of currentFaces) {
                    if (step.history && !step.history.IsNull()) {
                        // Check if face was removed
                        if (step.history.IsRemoved(currentFace)) {
                            console.log(`    Face removed in step ${stepIndex}`);
                            continue;
                        }

                        // Check if face was modified
                        const modifiedShapes = step.history.Modified(currentFace);
                        if (!modifiedShapes.IsEmpty()) {
                            const modIt = new this.oc.TopTools_ListIteratorOfListOfShape_1(modifiedShapes);
                            while (modIt.More()) {
                                const modShape = modIt.Value();
                                if (modShape.ShapeType() === this.oc.TopAbs_ShapeEnum.TopAbs_FACE) {
                                    const modifiedFace = this.oc.TopoDS.Face_1(modShape);
                                    nextFaces.push(modifiedFace);
                                    console.log(`    Face modified in step ${stepIndex}`);
                                }
                                modIt.Next();
                            }
                            modIt.delete();
                        } else {
                            // Face unchanged
                            nextFaces.push(currentFace);
                            console.log(`    Face unchanged in step ${stepIndex}`);
                        }
                    } else {
                        // No history, try geometric matching
                        const correspondingFace = this.findCorrespondingFace(currentFace, step.outputShape);
                        if (correspondingFace && !correspondingFace.IsNull()) {
                            nextFaces.push(correspondingFace);
                        }
                    }
                }

                currentFaces = nextFaces;
                if (currentFaces.length === 0) {
                    faceDeleted = true;
                    console.log(`  Face disappeared after step ${stepIndex}`);
                    break;
                }
            }

            // Determine change type based on tracking result
            if (faceDeleted || currentFaces.length === 0) {
                changeInfo.changeType = EFaceChangeType.Deleted;
                console.log(`Final result: Face ${changeInfo.originalFaceID} deleted`);
            } else if (currentFaces.length === 1 && this.isSameFace(originalFace, currentFaces[0])) {
                changeInfo.changeType = EFaceChangeType.Unchanged;
                changeInfo.resultingFaces = currentFaces;
                changeInfo.resultingFaceIDs = [changeInfo.originalFaceID];
                console.log(`Final result: Face ${changeInfo.originalFaceID} unchanged`);
            } else if (currentFaces.length > 1) {
                changeInfo.changeType = EFaceChangeType.Split;
                changeInfo.resultingFaces = currentFaces;
                for (let i = 0; i < currentFaces.length; i++) {
                    changeInfo.resultingFaceIDs.push(`${changeInfo.originalFaceID}_Split_${i}`);
                }
                console.log(`Final result: Face ${changeInfo.originalFaceID} split into ${currentFaces.length} faces`);
            } else {
                changeInfo.changeType = EFaceChangeType.Modified;
                changeInfo.resultingFaces = currentFaces;
                changeInfo.resultingFaceIDs = [`${changeInfo.originalFaceID}_Modified`];
                console.log(`Final result: Face ${changeInfo.originalFaceID} modified`);
            }

            this.faceChanges.push(changeInfo);
            originalFaceIndex++;
            originalFaceExplorer.Next();
        }

        originalFaceExplorer.delete();

        // Identify generated faces
        this.identifyGeneratedFaces();
    }

    /**
     * Check if two faces are the same
     * @param {object} face1 - First face
     * @param {object} face2 - Second face  
     * @returns {boolean} True if faces are same
     */
    isSameFace(face1, face2) {
        return face1.IsSame(face2);
    }

    /**
     * Find corresponding face in result shape
     * @param {object} originalFace - Original face
     * @param {object} resultShape - Result shape to search in
     * @returns {object|null} Corresponding face or null
     */
    findCorrespondingFace(originalFace, resultShape) {
        // Simplified implementation: return first face found
        const resultFaceExplorer = new this.oc.TopExp_Explorer_2(
            resultShape,
            this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
            this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );
        
        let correspondingFace = null;
        if (resultFaceExplorer.More()) {
            correspondingFace = this.oc.TopoDS.Face_1(resultFaceExplorer.Current());
        }
        
        resultFaceExplorer.delete();
        return correspondingFace;
    }

    /**
     * Identify generated faces in result
     */
    identifyGeneratedFaces() {
        if (!this.resultShape) {
            return;
        }

        const resultFaceExplorer = new this.oc.TopExp_Explorer_2(
            this.resultShape,
            this.oc.TopAbs_ShapeEnum.TopAbs_FACE,
            this.oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );
        
        let generatedFaceIndex = 0;
        
        while (resultFaceExplorer.More()) {
            const resultFace = this.oc.TopoDS.Face_1(resultFaceExplorer.Current());
            
            // Check if this face is already tracked
            let isTracked = false;
            for (const changeInfo of this.faceChanges) {
                for (const trackedFace of changeInfo.resultingFaces) {
                    if (resultFace.IsSame(trackedFace)) {
                        isTracked = true;
                        break;
                    }
                }
                if (isTracked) break;
            }
            
            if (!isTracked) {
                // This is a generated face
                const changeInfo = {
                    originalFace: null,
                    originalFaceID: null,
                    changeType: EFaceChangeType.Generated,
                    resultingFaces: [resultFace],
                    resultingFaceIDs: [`GeneratedFace_${generatedFaceIndex}`]
                };
                
                this.faceChanges.push(changeInfo);
                generatedFaceIndex++;
            }
            
            resultFaceExplorer.Next();
        }
        
        resultFaceExplorer.delete();
    }

    /**
     * Get face changes
     * @returns {Array} Array of face change information
     */
    getFaceChanges() {
        return this.faceChanges;
    }
}