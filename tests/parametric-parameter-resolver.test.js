import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveParametricParameters } from '../src/components/ParametricParameterResolver.js';

const selection = modelParameterMap => ({
    templateEntry: { ModelParamterMap: modelParameterMap },
});

const valueOf = (parameters, name) =>
    parameters.find(parameter => parameter.name === name)?.value;

function assertNear(actual, expected, label, tolerance = 1e-3) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected}, got ${actual}`);
}

test('maps standard-window CAD dimensions to model semantics', () => {
    const parameters = resolveParametricParameters({
        typeId: '1401',
        rawBlockInnerInfo: { 长: 1100, 宽: 240, 高度: 1380, 离地高度: 890 },
    }, selection({}));

    assert.deepEqual(parameters, [
        { name: '宽度', value: 1100 },
        { name: '高度', value: 1380 },
        { name: '离地', value: 890 },
        { name: '墙厚', value: 240 },
    ]);
});

test('maps both Drawing2 arc-window paths to literal model semantics', () => {
    const fixtures = [
        {
            instance: {
                typeId: '140c',
                cadPath: [
                    { x: -3828.686478, y: 6031.954413, z: 0, bulge: 0 },
                    { x: 0, y: 0, z: 0, bulge: 0 },
                    { x: 0, y: 0, z: 0, bulge: 0 },
                    { x: -6638.686234, y: 4641.953907, z: 0, bulge: -1.455308 },
                ],
                rawBlockInnerInfo: { 高度: 1500 },
            },
            expected: {
                chord: 3134.996018,
                sagitta: 2281.192393,
                sashCount: 11,
            },
        },
        {
            instance: {
                typeId: '140c',
                cadPath: [
                    { x: 5591.313296, y: -378.045377, z: 0, bulge: 0 },
                    { x: 0, y: 0, z: 0, bulge: 0 },
                    { x: 0, y: 0, z: 0, bulge: 0 },
                    { x: 5591.314060, y: -4748.045378, z: 0, bulge: 0.224261 },
                ],
                rawBlockInnerInfo: { 高度: 1500 },
            },
            expected: {
                chord: 4370.000001,
                sagitta: 490.010285,
                sashCount: 8,
            },
        },
    ];

    for (const { instance, expected } of fixtures) {
        const parameters = resolveParametricParameters(instance, selection({}));
        assert.deepEqual(parameters.map(parameter => parameter.name), [
            '弦长', '拱高', '窗扇数量', '高度',
        ]);
        assertNear(parameters[0].value, expected.chord, 'chord');
        assertNear(parameters[1].value, expected.sagitta, 'sagitta');
        assert.equal(parameters[2].value, expected.sashCount);
        assert.equal(parameters[3].value, 1500);
    }
});

test('keeps generic geometry aliases without scene transforms', () => {
    const parameters = resolveParametricParameters({
        typeId: '225903',
        rawBlockInnerInfo: {
            长: 800,
            宽: 600,
            高: 880,
            高度: 900,
            离地高度: 120,
            旋转角度: 90,
            左右翻转: 1,
            上下翻转: 1,
        },
    }, selection({}));

    assert.deepEqual(parameters, [
        { name: '长度', value: 800 },
        { name: '宽度', value: 600 },
        { name: '高度', value: 900 },
    ]);
});

test('deduplicates final names and accepts only finite numeric template defaults', () => {
    const parameters = resolveParametricParameters({
        typeId: 'generic',
        rawBlockInnerInfo: {
            长: 800,
            高: Number.NaN,
            自身高度: '900',
            挡水条高度: '12.5',
        },
    }, selection({
        长度: 700,
        数字默认: 42,
        数字字符串: '43',
        无穷值: Number.POSITIVE_INFINITY,
        非数字: Number.NaN,
    }));

    assert.deepEqual(parameters, [
        { name: '长度', value: 700 },
        { name: '自身高度', value: 900 },
        { name: '挡水条高度', value: 12.5 },
        { name: '数字默认', value: 42 },
    ]);
});

test('limits parameters to 64 unique finite names', () => {
    const defaults = Object.fromEntries(Array.from(
        { length: 70 },
        (_, index) => [`参数${index}`, index],
    ));
    const parameters = resolveParametricParameters({
        typeId: 'unknown',
        rawBlockInnerInfo: {},
    }, selection(defaults));

    assert.equal(parameters.length, 64);
    assert.equal(new Set(parameters.map(item => item.name)).size, 64);
    assert.deepEqual(parameters[0], { name: '参数0', value: 0 });
    assert.deepEqual(parameters[63], { name: '参数63', value: 63 });
});

test('keeps type-specific parameters inside the 64-entry limit ahead of defaults', () => {
    const defaults = Object.fromEntries(Array.from(
        { length: 70 },
        (_, index) => [`默认参数${index}`, index],
    ));
    const parameters = resolveParametricParameters({
        typeId: '1401',
        rawBlockInnerInfo: { 长: 1100, 宽: 240, 高度: 1380, 离地高度: 890 },
    }, selection(defaults));

    assert.equal(parameters.length, 64);
    assert.deepEqual(parameters.slice(0, 4), [
        { name: '宽度', value: 1100 },
        { name: '高度', value: 1380 },
        { name: '离地', value: 890 },
        { name: '墙厚', value: 240 },
    ]);
});

test('maps corner-window sides consistently for either footprint winding', () => {
    const footprint = [
        { x: 0, y: 0 },
        { x: 0, y: 1080 },
        { x: -240, y: 1080 },
        { x: -240, y: -240 },
        { x: 435, y: -240 },
        { x: 435, y: 0 },
    ];
    const current = {
        typeId: '1407',
        basePoint: { x: 0, y: 0, z: 0 },
        rawBlockInnerInfo: {
            长: 435,
            宽: 1080,
            高度: 1500,
            离地高度: 900,
            外边长: 210,
            外边宽: 240,
        },
    };
    const expected = [
        { name: '右宽', value: 435 },
        { name: '左宽', value: 1080 },
        { name: '高度', value: 1500 },
        { name: '离地', value: 900 },
        { name: '右墙厚', value: 210 },
        { name: '左墙厚', value: 240 },
    ];

    assert.deepEqual(resolveParametricParameters({
        ...current,
        footprint,
    }, selection({})), expected);
    assert.deepEqual(resolveParametricParameters({
        ...current,
        footprint: [footprint[0], ...footprint.slice(1).reverse()],
    }, selection({})), expected);

    assert.deepEqual(resolveParametricParameters({
        ...current,
        footprint,
        rawBlockInnerInfo: {
            ...current.rawBlockInnerInfo,
            长: 1080,
            宽: 435,
        },
    }, selection({})), [
        { name: '右宽', value: 435 },
        { name: '左宽', value: 1080 },
        { name: '高度', value: 1500 },
        { name: '离地', value: 900 },
        { name: '右墙厚', value: 240 },
        { name: '左墙厚', value: 210 },
    ]);
});

test('corner-window fallback remains deterministic when orientation is unavailable', () => {
    const parameters = resolveParametricParameters({
        typeId: '1407',
        basePoint: null,
        footprint: [],
        rawBlockInnerInfo: {
            长: 435,
            宽: 1080,
            高度: 1500,
            离地高度: 900,
            外边长: 210,
            外边宽: 240,
        },
    }, selection({}));

    assert.deepEqual(parameters, [
        { name: '右宽', value: 435 },
        { name: '左宽', value: 1080 },
        { name: '高度', value: 1500 },
        { name: '离地', value: 900 },
        { name: '右墙厚', value: 210 },
        { name: '左墙厚', value: 240 },
    ]);
});

test('maps L-shaped sliding-door sides to the model parameter names', () => {
    const parameters = resolveParametricParameters({
        typeId: '1313',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 },
            { x: 0, y: 1200 },
            { x: -240, y: 1200 },
            { x: -240, y: -180 },
            { x: 1500, y: -180 },
            { x: 1500, y: 0 },
        ],
        rawBlockInnerInfo: {
            长: 1500,
            宽: 1200,
            高度: 2200,
            外边长: 180,
            外边宽: 240,
        },
    }, selection({}));

    assert.deepEqual(parameters, [
        { name: '右宽', value: 1500 },
        { name: '左宽', value: 1200 },
        { name: '高度', value: 2200 },
        { name: '右墙厚', value: 180 },
        { name: '左墙厚', value: 240 },
    ]);
});

test('maps 1408 U-window CAD fields to UE parameter names', () => {
    const parameters = resolveParametricParameters({
        typeId: '1408',
        externalWallThickness: 240,
        rawBlockInnerInfo: {
            长: 2870,
            下厚: 240,
            左厚: 180,
            右厚: 220,
            左宽: 1030,
            右宽: 810,
            高度: 1600,
            离地高度: 900,
            墙厚: 260,
        },
    }, selection({ 宽度: 3970, 高度: 1900 }));

    assert.deepEqual(parameters, [
        { name: '宽度', value: 2870 },
        { name: '深度', value: 240 },
        { name: '左深', value: 180 },
        { name: '右深', value: 220 },
        { name: '左宽', value: 1030 },
        { name: '右宽', value: 810 },
        { name: '高度', value: 1600 },
        { name: '离地', value: 900 },
        { name: '墙厚', value: 260 },
    ]);
});

test('uses drawing external wall thickness when 1408 has no explicit wall thickness', () => {
    const parameters = resolveParametricParameters({
        typeId: '1408',
        externalWallThickness: 240,
        rawBlockInnerInfo: {
            长: 2870,
            下厚: 240,
            左厚: 180,
            右厚: 220,
            左宽: 1030,
            右宽: 810,
            高度: 1600,
            离地高度: 900,
        },
    }, selection({}));

    assert.deepEqual(parameters.at(-1), { name: '墙厚', value: 240 });
    assert.equal(parameters.length, 9);
});

test('maps every remaining rectangular window family to standard window parameters', () => {
    for (const typeId of ['1402', '1403', '140302', '140303', '1404', '1405']) {
        const parameters = resolveParametricParameters({
            typeId,
            rawBlockInnerInfo: {
                ['\u957f']: 1680,
                ['\u5bbd']: 260,
                ['\u9ad8\u5ea6']: 1450,
                ['\u79bb\u5730\u9ad8\u5ea6']: 820,
            },
        }, selection({}));

        assert.equal(valueOf(parameters, '\u5bbd\u5ea6'), 1680, `${typeId} width`);
        assert.equal(valueOf(parameters, '\u9ad8\u5ea6'), 1450, `${typeId} height`);
        assert.equal(valueOf(parameters, '\u79bb\u5730'), 820, `${typeId} ground`);
        assert.equal(valueOf(parameters, '\u5899\u539a'), 260, `${typeId} wall`);
    }
});

test('140302 selects its visible side from the CAD vertical flip', () => {
    const instance = verticalFlip => ({
        typeId: '140302',
        verticalFlip,
        rawBlockInnerInfo: {
            ['\u957f']: 1800,
            ['\u5bbd']: 600,
            ['\u9ad8\u5ea6']: 1200,
            ['\u79bb\u5730\u9ad8\u5ea6']: 900,
        },
    });

    const right = resolveParametricParameters(instance(false), selection({}));
    const left = resolveParametricParameters(instance(true), selection({}));

    assert.equal(valueOf(right, '\u7a97\u6237\u7c7b\u578b'), '\u53f3\u4fa7\u73bb\u7483');
    assert.equal(valueOf(right, '\u6321\u677f'), '\u53f3\u4fa7\u6321\u677f');
    assert.equal(valueOf(left, '\u7a97\u6237\u7c7b\u578b'), '\u5de6\u4fa7\u73bb\u7483');
    assert.equal(valueOf(left, '\u6321\u677f'), '\u5de6\u4fa7\u6321\u677f');
});

test('1406 maps winding-aware left and right bay dimensions', () => {
    const parameters = resolveParametricParameters({
        typeId: '1406',
        basePoint: { x: 0, y: 0, z: 0 },
        footprint: [
            { x: 0, y: 0 },
            { x: 0, y: 1200 },
            { x: -240, y: 1200 },
            { x: -240, y: -180 },
            { x: 900, y: -180 },
            { x: 900, y: 0 },
        ],
        rawBlockInnerInfo: {
            ['\u957f']: 900,
            ['\u5bbd']: 1200,
            ['\u9ad8\u5ea6']: 1500,
            ['\u79bb\u5730\u9ad8\u5ea6']: 900,
            ['\u5916\u8fb9\u957f']: 180,
            ['\u5916\u8fb9\u5bbd']: 240,
        },
    }, selection({}));

    assert.equal(valueOf(parameters, '\u53f3\u5bbd'), 900);
    assert.equal(valueOf(parameters, '\u5de6\u5bbd'), 1200);
    assert.equal(valueOf(parameters, '\u53f3\u5899\u539a'), 180);
    assert.equal(valueOf(parameters, '\u5de6\u5899\u539a'), 240);
    assert.equal(valueOf(parameters, '\u79bb\u5730'), 900);
});

test('140f keeps door-window source values and derives UE total height', () => {
    const parameters = resolveParametricParameters({
        typeId: '140f',
        rawBlockInnerInfo: {
            ['\u7c7b\u578b']: '\u843d\u5730\u7a97\u6709\u526f\u7a97',
            ['\u95e8\u9ad8']: 2100,
            ['\u7a97\u9ad8']: 600,
            ['\u526f\u7a97\u9ad8\u5ea6']: 300,
            ['\u5916\u8fb9\u957f']: 900,
            ['\u957f']: 2400,
        },
    }, selection({}));
    const noSubWindow = resolveParametricParameters({
        typeId: '140f',
        rawBlockInnerInfo: {
            ['\u7c7b\u578b']: '\u975e\u843d\u5730\u7a97\u65e0\u526f\u7a97',
            ['\u95e8\u9ad8']: 2100,
            ['\u7a97\u9ad8']: 600,
            ['\u526f\u7a97\u9ad8\u5ea6']: 300,
            ['\u5916\u8fb9\u957f']: 900,
            ['\u957f']: 2400,
        },
    }, selection({}));

    assert.equal(valueOf(parameters, '\u7c7b\u578b'), '\u843d\u5730\u7a97');
    assert.equal(valueOf(parameters, '\u95e8\u9ad8'), 2100);
    assert.equal(valueOf(parameters, '\u7a97\u9ad8'), 600);
    assert.equal(valueOf(parameters, '\u526f\u7a97\u9ad8\u5ea6'), 300);
    assert.equal(valueOf(parameters, '\u5916\u8fb9\u957f'), 900);
    assert.equal(valueOf(parameters, '\u957f\u5ea6'), 2400);
    assert.equal(valueOf(parameters, '\u603b\u9ad8\u5ea6'), 2700);
    assert.equal(valueOf(noSubWindow, '\u7c7b\u578b'), '\u975e\u843d\u5730\u7a97_\u65e0\u526f\u7a97');
    assert.equal(valueOf(noSubWindow, '\u603b\u9ad8\u5ea6'), 2100);
});

test('140e02 adds UE radius and major-minor arc parameters', () => {
    const cases = [
        {
            start: { x: -6638.686234, y: 4641.953907, z: 0, bulge: -1.455308 },
            end: { x: -3828.686478, y: 6031.954413, z: 0, bulge: 0 },
            radius: 1704.14130477725,
            arcKind: '\u4f18\u5f27',
        },
        {
            start: { x: 5591.314060, y: -4748.045378, z: 0, bulge: 0.224261 },
            end: { x: 5591.313296, y: -378.045377, z: 0, bulge: 0 },
            radius: 5141.561053971859,
            arcKind: '\u52a3\u5f27',
        },
    ];

    for (const fixture of cases) {
        const parameters = resolveParametricParameters({
            typeId: '140e02',
            cadPath: [
                fixture.end,
                { x: 0, y: 0, z: 0, bulge: 0 },
                { x: 0, y: 0, z: 0, bulge: 0 },
                fixture.start,
            ],
            rawBlockInnerInfo: { ['\u9ad8\u5ea6']: 1050 },
        }, selection({}));

        assertNear(valueOf(parameters, '\u534a\u5f84'), fixture.radius, 'railing radius');
        assert.equal(valueOf(parameters, '\u4f18\u52a3\u5f27'), fixture.arcKind);
        assert.ok(valueOf(parameters, '\u5f26\u957f') > 0);
        assert.ok(valueOf(parameters, '\u62f1\u9ad8') > 0);
        assert.ok(valueOf(parameters, '\u7a97\u6247\u6570\u91cf') >= 1);
        assert.equal(valueOf(parameters, '\u9ad8\u5ea6'), 1050);
    }
});

test('140e02 omits arc-only parameters when its inner arc is invalid', () => {
    const parameters = resolveParametricParameters({
        typeId: '140e02',
        cadPath: [],
        rawBlockInnerInfo: { ['\u9ad8\u5ea6']: 1050 },
    }, selection({}));

    assert.equal(valueOf(parameters, '\u534a\u5f84'), undefined);
    assert.equal(valueOf(parameters, '\u4f18\u52a3\u5f27'), undefined);
});
