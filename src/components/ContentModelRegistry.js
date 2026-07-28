const PARAMETER_NAMES = Object.freeze({
    长: '长度', 宽: '宽度', 高: '高度', 自身高度: '自身高度',
    离地高度: '离地高度', 挡水条高度: '挡水条高度',
});

export function collectContentModelInstances(json) {
    const result = [];
    for (const [sourceList, records] of Object.entries(json ?? {})) {
        if (!sourceList.endsWith('_list') || !Array.isArray(records)) continue;

        const descriptor = {
            sourceList,
            category: sourceList.slice(0, -'_list'.length),
        };
        records.forEach((record, sourceIndex) => {
            const item = normalizeRecord(record, descriptor, sourceIndex);
            if (item) result.push(item);
        });
    }
    return result;
}

function parseVector(value, requiredAxes = ['X', 'Y', 'Z']) {
    if (typeof value !== 'string') return null;
    const coordinate = (axis) => {
        const match = value.match(new RegExp(`${axis}=([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)`));
        return match ? finiteNumber(match[1]) : null;
    };
    const x = coordinate('X');
    const y = coordinate('Y');
    const z = coordinate('Z');
    const coordinateByAxis = { X: x, Y: y, Z: z };
    return requiredAxes.some(axis => coordinateByAxis[axis] === null) ? null : { x, y, z };
}

function parsePoints(points) {
    if (!Array.isArray(points)) return [];
    return points
        .map(value => parseVector(value))
        .filter(Boolean)
        .map(({ x, y }) => ({ x, y }));
}

function finiteNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function readFlip(record, blockInnerInfo, innerKey, legacyKey) {
    if (Object.prototype.hasOwnProperty.call(blockInnerInfo, innerKey)) {
        return Boolean(blockInnerInfo[innerKey]);
    }
    return Boolean(record[legacyKey]);
}

function hasUsablePlanDimensions(size) {
    return size && size.x > 0 && size.y > 0;
}

function readHeight(blockInnerInfo) {
    const heightKey = ['\u9ad8', '\u9ad8\u5ea6', '\u81ea\u8eab\u9ad8\u5ea6']
        .find(key => Object.prototype.hasOwnProperty.call(blockInnerInfo, key));
    return heightKey ? finiteNumber(blockInnerInfo[heightKey], 0) : 0;
}

function deriveFootprintSize(footprint, blockInnerInfo) {
    if (footprint.length !== 4) return null;

    const firstEdge = Math.hypot(
        footprint[1].x - footprint[0].x,
        footprint[1].y - footprint[0].y,
    );
    const secondEdge = Math.hypot(
        footprint[2].x - footprint[1].x,
        footprint[2].y - footprint[1].y,
    );
    if (!(firstEdge > 0) || !(secondEdge > 0)) return null;

    return {
        x: firstEdge,
        y: secondEdge,
        z: readHeight(blockInnerInfo),
    };
}

function normalizeRecord(record, descriptor, sourceIndex) {
    if (!record || typeof record !== 'object') return null;

    const typeId = record.TypeId == null ? '' : String(record.TypeId).trim();
    const basePoint = parseVector(record.BasePoint);
    if (!typeId) return null;

    const blockInnerInfo = record.BlockInnerInfo && typeof record.BlockInnerInfo === 'object'
        ? record.BlockInnerInfo
        : {};
    const footprint = parsePoints(record.Points);
    const parsedSize = parseVector(record.Size, ['X', 'Y']);
    if (parsedSize && parsedSize.z === null) parsedSize.z = readHeight(blockInnerInfo);
    const size = hasUsablePlanDimensions(parsedSize)
        ? parsedSize
        : deriveFootprintSize(footprint, blockInnerInfo);

    const rawBlockInnerInfo = { ...blockInnerInfo };
    const groundHeight = Object.prototype.hasOwnProperty.call(blockInnerInfo, '离地高度')
        ? finiteNumber(blockInnerInfo.离地高度)
        : null;
    const modelParams = Object.entries(PARAMETER_NAMES)
        .filter(([rawName]) => Object.prototype.hasOwnProperty.call(blockInnerInfo, rawName))
        .map(([rawName, name]) => ({ name, value: blockInnerInfo[rawName] }));

    return {
        instanceId: `${descriptor.sourceList}:${sourceIndex}`,
        sourceList: descriptor.sourceList,
        sourceIndex,
        category: descriptor.category,
        typeId,
        basePoint,
        footprint,
        size,
        outScale: {
            x: finiteNumber(record.OutXScale, 1),
            y: finiteNumber(record.OutYScale, 1),
            z: finiteNumber(record.OutZScale, 1),
        },
        rotationDegrees: finiteNumber(record.OutRotateRadian, 0) +
            finiteNumber(blockInnerInfo.旋转角度, 0),
        horizontalFlip: readFlip(record, blockInnerInfo, '左右翻转', 'HorizontalFlip'),
        verticalFlip: readFlip(record, blockInnerInfo, '上下翻转', 'VerticalFlip'),
        groundHeight,
        modelParams,
        rawBlockInnerInfo,
    };
}
