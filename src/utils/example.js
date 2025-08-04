/**
 * Usage examples for OpenCascade.js utilities
 * Demonstrates how to use the ported C++ functions
 */

import initOpenCascade from "opencascade.js";
import { initializeUtils, BooleanOperationType } from './index.js';

// Example usage
async function demonstrateUtilities() {
    // Initialize OpenCascade
    const oc = await initOpenCascade();
    
    // Initialize utility classes
    const { booleanOps, geoUtils, faceTracker } = initializeUtils(oc);

    console.log('OpenCascade.js utilities initialized');

    // Example 1: Create basic geometry
    console.log('\n=== Example 1: Basic Geometry Creation ===');
    
    // Create a rectangle
    const rectangle = geoUtils.makeRectangle(100, 50);
    console.log('Rectangle created:', rectangle ? 'Success' : 'Failed');

    // Create a circle
    const circle = geoUtils.makeCircleFace(25, { x: 50, y: 25, z: 0 });
    console.log('Circle created:', circle ? 'Success' : 'Failed');

    // Example 2: Boolean operations
    console.log('\n=== Example 2: Boolean Operations ===');
    
    if (rectangle && circle) {
        // Subtract circle from rectangle
        const cutResult = booleanOps.buildShapeFromBooleanOperation(
            BooleanOperationType.BOP_Cut,
            [rectangle],
            [circle],
            1e-6
        );
        console.log('Boolean cut operation:', cutResult ? 'Success' : 'Failed');

        // Get triangulation from result
        if (cutResult) {
            const triangulations = booleanOps.buildTriangulationFromShape(cutResult);
            console.log('Triangulation extracted:', triangulations.length, 'mesh(es)');
        }
    }

    // Example 3: Create geometry from points
    console.log('\n=== Example 3: Geometry from Points ===');
    
    const points = [
        { x: 0, y: 0, z: 0 },
        { x: 50, y: 0, z: 0 },
        { x: 50, y: 30, z: 0 },
        { x: 25, y: 40, z: 0 },
        { x: 0, y: 30, z: 0 }
    ];
    
    const polygon = geoUtils.createPolygon(points);
    console.log('Polygon from points:', polygon ? 'Success' : 'Failed');

    // Example 4: Create geometry with bulge values (arcs)
    console.log('\n=== Example 4: Geometry with Arcs ===');
    
    const verticesWithBulge = [
        { x: 0, y: 0, z: 0, bulge: 0 },
        { x: 50, y: 0, z: 0, bulge: 0.5 }, // Arc segment
        { x: 50, y: 50, z: 0, bulge: 0 },
        { x: 0, y: 50, z: 0, bulge: -0.3 } // Arc segment (opposite direction)
    ];
    
    const arcPolygon = geoUtils.createPolygonWithBulge(verticesWithBulge);
    console.log('Polygon with arcs:', arcPolygon ? 'Success' : 'Failed');

    // Example 5: Extrusion (Pad)
    console.log('\n=== Example 5: Extrusion ===');
    
    if (polygon) {
        const extrudedShape = geoUtils.makePad(20, polygon);
        console.log('Extruded shape:', extrudedShape ? 'Success' : 'Failed');
        
        if (extrudedShape) {
            // Get triangulation for rendering
            const meshData = geoUtils.buildTriangulationFromShape(extrudedShape);
            console.log('Extrusion mesh data:', meshData.length, 'face(s)');
        }
    }

    // Example 6: Face change tracking
    console.log('\n=== Example 6: Face Change Tracking ===');
    
    if (rectangle && circle) {
        // Start tracking
        faceTracker.beginTracking(rectangle);
        
        // Perform operation with tracking
        const cutResult2 = booleanOps.buildShapeFromBooleanOperation(
            BooleanOperationType.BOP_Cut,
            [rectangle],
            [circle],
            1e-6
        );
        
        if (cutResult2) {
            // End tracking and analyze changes
            faceTracker.endTrackingWithSteps(cutResult2);
            const changes = faceTracker.getFaceChanges();
            console.log('Face changes tracked:', changes.length, 'face(s) analyzed');
            
            changes.forEach((change, index) => {
                console.log(`  Face ${index}: ${change.changeType}`);
            });
        }
    }

    // Example 7: Utility functions
    console.log('\n=== Example 7: Utility Functions ===');
    
    if (polygon) {
        // Get edges
        const edges = geoUtils.getShapeEdges(polygon);
        console.log('Polygon edges:', edges.length);
        
        // Get vertices
        const vertices = geoUtils.getShapeVertices(polygon);
        console.log('Polygon vertices:', vertices.length);
        
        // Check if closed
        const isClosed = geoUtils.isShapeClosed(polygon);
        console.log('Polygon is closed:', isClosed);
        
        // Copy shape
        const copiedPolygon = geoUtils.copyShape(polygon);
        console.log('Shape copied:', copiedPolygon ? 'Success' : 'Failed');
        
        // Transform shape
        const transformedPolygon = geoUtils.transformShape(polygon, {
            translation: { x: 100, y: 100, z: 0 },
            scale: 1.5
        });
        console.log('Shape transformed:', transformedPolygon ? 'Success' : 'Failed');
    }

    console.log('\n=== Examples completed ===');
}

// Example for server-side usage (Node.js)
async function serverSideExample() {
    console.log('Running server-side OpenCascade.js example...');
    
    try {
        await demonstrateUtilities();
    } catch (error) {
        console.error('Example failed:', error);
    }
}

// Example for browser usage
function browserExample() {
    console.log('Browser example - call demonstrateUtilities() when ready');
    
    // In browser, you would typically call this after user interaction
    // demonstrateUtilities().catch(console.error);
}

// Export for different environments
export { demonstrateUtilities, serverSideExample, browserExample };

// Auto-run in Node.js environment
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    // serverSideExample();
}