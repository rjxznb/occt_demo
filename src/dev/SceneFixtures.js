const CORNER_DOOR_1313 = Object.freeze({
    BasePoint: 'X=-1498.686324 Y=-5448.045438 Z=0.000000',
    BlockInnerInfo: Object.freeze({
        长: 1200,
        宽: 1500,
        高度: 2200,
        外边长: 180,
        外边宽: 240,
        左右翻转: 0,
        上下翻转: 0,
        旋转角度: 0,
        离地高度: 0,
    }),
    ChildType: 0,
    HorizontalFlip: false,
    MarkType: 1,
    OutRotateRadian: 0,
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    Points: Object.freeze([
        'X=-1498.686324 Y=-5448.045438 Z=0.000000 B=0.000000',
        'X=-1498.686324 Y=-3948.045438 Z=0.000000 B=0.000000',
        'X=-1258.686324 Y=-3948.045438 Z=0.000000 B=0.000000',
        'X=-1258.686324 Y=-5268.045438 Z=0.000000 B=0.000000',
        'X=-298.686324 Y=-5268.045438 Z=0.000000 B=0.000000',
        'X=-298.686324 Y=-5448.045438 Z=0.000000 B=0.000000',
    ]),
    Size: 'X=1200.000000 Y=1500.000000',
    TypeId: '1313',
    VerticalFlip: false,
});

function cloneCornerDoor1313() {
    return {
        ...CORNER_DOOR_1313,
        BlockInnerInfo: { ...CORNER_DOOR_1313.BlockInnerInfo },
        Points: [...CORNER_DOOR_1313.Points],
    };
}

export function applySceneFixture(drawing, fixtureName) {
    if (fixtureName !== '1313' || !drawing || typeof drawing !== 'object') return drawing;
    const doorList = Array.isArray(drawing.door_list) ? drawing.door_list : [];
    return {
        ...drawing,
        door_list: [...doorList, cloneCornerDoor1313()],
    };
}
