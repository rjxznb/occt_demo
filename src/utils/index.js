/**
 * OpenCascade.js Utilities Index
 * Exports all utility classes and functions
 */

export { 
    BooleanOperationTools, 
    SimpleFaceChangeTracker,
    BooleanOperationType,
    EFaceChangeType
} from './BooleanOperationTools.js';

export { GeoUtils } from './GeoUtils.js';

// Initialize utilities with OpenCascade instance
export function initializeUtils(oc) {
    return {
        booleanOps: new BooleanOperationTools(oc),
        geoUtils: new GeoUtils(oc),
        faceTracker: new SimpleFaceChangeTracker(oc)
    };
}