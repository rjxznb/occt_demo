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

function cadPoint(x, y, bulge = 0) {
    return `X=${x.toFixed(6)} Y=${y.toFixed(6)} Z=0.000000 B=${bulge.toFixed(6)}`;
}

function cadBasePoint(x, y) {
    return `X=${x.toFixed(6)} Y=${y.toFixed(6)} Z=0.000000`;
}

function makeRectFixture({
    typeId, x, y, length, depth, height, groundHeight,
    horizontalFlip = false, verticalFlip = false, blockExtra = {},
}) {
    return Object.freeze({
        BasePoint: cadBasePoint(x, y),
        BlockInnerInfo: Object.freeze({
            ['\u957f']: length,
            ['\u5bbd']: depth,
            ['\u9ad8\u5ea6']: height,
            ['\u79bb\u5730\u9ad8\u5ea6']: groundHeight,
            ['\u5de6\u53f3\u7ffb\u8f6c']: horizontalFlip ? 1 : 0,
            ['\u4e0a\u4e0b\u7ffb\u8f6c']: verticalFlip ? 1 : 0,
            ['\u65cb\u8f6c\u89d2\u5ea6']: 0,
            ...blockExtra,
        }),
        ChildType: 0,
        HorizontalFlip: horizontalFlip,
        MarkType: 1,
        OutRotateRadian: 0,
        OutXScale: 1,
        OutYScale: 1,
        OutZScale: 1,
        Points: Object.freeze([
            cadPoint(x, y),
            cadPoint(x + length, y),
            cadPoint(x + length, y + depth),
            cadPoint(x, y + depth),
        ]),
        Size: `X=${length.toFixed(6)} Y=${depth.toFixed(6)}`,
        TypeId: typeId,
        VerticalFlip: verticalFlip,
    });
}

const STANDARD_WINDOW_1402 = makeRectFixture({
    typeId: '1402', x: -5200, y: -5650,
    length: 1500, depth: 240, height: 2200, groundHeight: 0,
});

const DOUBLE_BAY_WINDOW_140302 = makeRectFixture({
    typeId: '140302', x: -3400, y: -5650,
    length: 1800, depth: 600, height: 1200, groundHeight: 900,
    verticalFlip: true,
});

const ARC_BAY_WINDOW_1405 = makeRectFixture({
    typeId: '1405', x: -1300, y: -5650,
    length: 1600, depth: 600, height: 1200, groundHeight: 900,
});

const CORNER_BAY_WINDOW_1406 = Object.freeze({
    BasePoint: cadBasePoint(800, -5650),
    BlockInnerInfo: Object.freeze({
        ['\u957f']: 900,
        ['\u5bbd']: 1200,
        ['\u5916\u8fb9\u957f']: 180,
        ['\u5916\u8fb9\u5bbd']: 240,
        ['\u9ad8\u5ea6']: 1500,
        ['\u79bb\u5730\u9ad8\u5ea6']: 900,
        ['\u5de6\u53f3\u7ffb\u8f6c']: 0,
        ['\u4e0a\u4e0b\u7ffb\u8f6c']: 0,
        ['\u65cb\u8f6c\u89d2\u5ea6']: 0,
    }),
    ChildType: 0,
    HorizontalFlip: false,
    MarkType: 1,
    OutRotateRadian: 0,
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    Points: Object.freeze([
        cadPoint(800, -5650),
        cadPoint(800, -4450),
        cadPoint(560, -4450),
        cadPoint(560, -5830),
        cadPoint(1700, -5830),
        cadPoint(1700, -5650),
    ]),
    Size: 'X=900.000000 Y=1200.000000',
    TypeId: '1406',
    VerticalFlip: false,
});

const RAILING_140E = Object.freeze({
    BasePoint: cadBasePoint(2200, -5650),
    BlockInnerInfo: Object.freeze({
        ['\u9ad8\u5ea6']: 1050,
        ['\u79bb\u5730\u9ad8\u5ea6']: 300,
        ['\u65cb\u8f6c\u89d2\u5ea6']: 0,
    }),
    ChildType: 0,
    HorizontalFlip: false,
    MarkType: 1,
    OutRotateRadian: 0,
    OutXScale: 1,
    OutYScale: 1,
    OutZScale: 1,
    Points: Object.freeze([
        cadPoint(2200, -5650, 0),
        cadPoint(3200, -5650, 0.25),
        cadPoint(3200, -4650, 0),
        cadPoint(3400, -4650, -0.25),
        cadPoint(3400, -5850, 0),
        cadPoint(2200, -5850, 0),
    ]),
    Size: 'X=0.000000 Y=0.000000',
    TypeId: '140e',
    VerticalFlip: false,
});

const DOOR_WINDOW_140F = makeRectFixture({
    typeId: '140f', x: 3800, y: -5650,
    length: 2400, depth: 240, height: 2700, groundHeight: 0,
    blockExtra: {
        ['\u7c7b\u578b']: '\u843d\u5730\u7a97\u6709\u526f\u7a97',
        ['\u95e8\u9ad8']: 2100,
        ['\u7a97\u9ad8']: 600,
        ['\u526f\u7a97\u9ad8\u5ea6']: 300,
        ['\u5916\u8fb9\u957f']: 900,
    },
});

const BARN_DOOR_1305 = makeRectFixture({
    typeId: '1305', x: -2500, y: 6500,
    length: 800, depth: 100, height: 2100, groundHeight: 0,
});

const POCKET_DOOR_1311 = makeRectFixture({
    typeId: '1311', x: -1300, y: 6500,
    length: 900, depth: 120, height: 2100, groundHeight: 0,
    blockExtra: { ['\u5916\u8fb9\u957f']: 200 },
});

const REMAINING_WINDOW_FIXTURES = Object.freeze([
    STANDARD_WINDOW_1402,
    DOUBLE_BAY_WINDOW_140302,
    ARC_BAY_WINDOW_1405,
    CORNER_BAY_WINDOW_1406,
    RAILING_140E,
    DOOR_WINDOW_140F,
]);

const REMAINING_DOOR_FIXTURES = Object.freeze([
    BARN_DOOR_1305,
    POCKET_DOOR_1311,
]);

const CAMERA_PRESET_FIXTURES = Object.freeze([
    {
        TypeId: '27d2',
        BasePoint: cadBasePoint(1900, 1000),
        BlockInnerInfo: {
            ['\u7c7b\u578b']: '\u6807\u51c6',
            ['\u79bb\u5730\u9ad8\u5ea6']: 1500,
            ['\u65cb\u8f6c\u89d2\u5ea6']: 180,
            FOV: 90,
        },
    },
    {
        TypeId: '27d2',
        BasePoint: cadBasePoint(1700, -3000),
        BlockInnerInfo: {
            ['\u7c7b\u578b']: '\u5e7f\u89d2',
            ['\u79bb\u5730\u9ad8\u5ea6']: 1500,
            Rotation: 'X=0 Y=90 Z=0',
            FOV: 110,
        },
    },
    {
        TypeId: '27d202',
        BasePoint: cadBasePoint(-4550, 800),
        BlockInnerInfo: {
            ['\u7c7b\u578b']: '\u7279\u5199',
            ['\u79bb\u5730\u9ad8\u5ea6']: 1450,
            ['\u65cb\u8f6c\u89d2\u5ea6']: 0,
            FOV: 60,
        },
    },
]);

const REMAINING_FIXTURE_BY_TYPE = new Map([
    ...REMAINING_WINDOW_FIXTURES.map(record => [record.TypeId, {
        listName: 'window_list', record,
    }]),
    ...REMAINING_DOOR_FIXTURES.map(record => [record.TypeId, {
        listName: 'door_list', record,
    }]),
]);

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

function cloneFixture(record) {
    return {
        ...record,
        BlockInnerInfo: { ...(record.BlockInnerInfo ?? {}) },
        Points: [...(record.Points ?? [])],
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
    if (fixtureName === 'ue-specials') {
        const windowList = Array.isArray(drawing.window_list) ? drawing.window_list : [];
        const doorList = Array.isArray(drawing.door_list) ? drawing.door_list : [];
        return {
            ...drawing,
            window_list: [
                ...windowList,
                ...REMAINING_WINDOW_FIXTURES.map(cloneFixture),
            ],
            door_list: [
                ...doorList,
                ...REMAINING_DOOR_FIXTURES.map(cloneFixture),
            ],
        };
    }
    if (fixtureName === 'cameras') {
        return {
            ...drawing,
            camera_list: CAMERA_PRESET_FIXTURES.map(record => ({
                ...record,
                BlockInnerInfo: { ...record.BlockInnerInfo },
            })),
        };
    }
    if (fixtureName === 'panorama-empty') {
        return {
            ...drawing,
            camera_list: [],
        };
    }
    const remainingFixture = REMAINING_FIXTURE_BY_TYPE.get(fixtureName);
    if (remainingFixture) {
        const sourceList = Array.isArray(drawing[remainingFixture.listName])
            ? drawing[remainingFixture.listName]
            : [];
        return {
            ...drawing,
            [remainingFixture.listName]: [
                ...sourceList,
                cloneFixture(remainingFixture.record),
            ],
        };
    }
    return drawing;
}
