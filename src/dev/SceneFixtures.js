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

const U_WINDOW_1408 = Object.freeze({
    BasePoint: 'X=3631.313676 Y=-4488.045438 Z=0.000000',
    BlockInnerInfo: Object.freeze({
        长: 2870,
        下厚: 240,
        左厚: 180,
        右厚: 220,
        左宽: 1030,
        右宽: 810,
        高度: 1600,
        墙厚: 240,
        左右翻转: 0,
        上下翻转: 0,
        旋转角度: 0,
        离地高度: 900,
    }),
    ChildType: 0,
    HorizontalFlip: false,
    MarkType: 1,
    OutRotateRadian: 180,
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    Points: Object.freeze([
        'X=3631.313676 Y=-4488.045438 Z=0.000000 B=0.000000',
        'X=281.313676 Y=-4488.045438 Z=0.000000 B=0.000000',
        'X=281.313676 Y=-5758.045438 Z=0.000000 B=0.000000',
        'X=461.313676 Y=-5758.045438 Z=0.000000 B=0.000000',
        'X=461.313676 Y=-4728.045438 Z=0.000000 B=0.000000',
        'X=3411.313676 Y=-4728.045438 Z=0.000000 B=0.000000',
        'X=3411.313676 Y=-5538.045438 Z=0.000000 B=0.000000',
        'X=3631.313676 Y=-5538.045438 Z=0.000000 B=0.000000',
    ]),
    Size: 'X=2870.000000 Y=1030.000000',
    TypeId: '1408',
    VerticalFlip: false,
});

function cloneCornerDoor1313() {
    return {
        ...CORNER_DOOR_1313,
        BlockInnerInfo: { ...CORNER_DOOR_1313.BlockInnerInfo },
        Points: [...CORNER_DOOR_1313.Points],
    };
}

function cloneUWindow1408() {
    return {
        ...U_WINDOW_1408,
        BlockInnerInfo: { ...U_WINDOW_1408.BlockInnerInfo },
        Points: [...U_WINDOW_1408.Points],
    };
}

export function applySceneFixture(drawing, fixtureName) {
    if (!drawing || typeof drawing !== 'object') return drawing;
    if (fixtureName === '1313') {
        const doorList = Array.isArray(drawing.door_list) ? drawing.door_list : [];
        return {
            ...drawing,
            door_list: [...doorList, cloneCornerDoor1313()],
        };
    }
    if (fixtureName === '1408') {
        const windowList = Array.isArray(drawing.window_list) ? drawing.window_list : [];
        return {
            ...drawing,
            window_list: [...windowList, cloneUWindow1408()],
        };
    }
    return drawing;
}
