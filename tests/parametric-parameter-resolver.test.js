import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveParametricParameters } from '../src/components/ParametricParameterResolver.js';

const selection = modelParameterMap => ({
    templateEntry: { ModelParamterMap: modelParameterMap },
});

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
