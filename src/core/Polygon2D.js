import ClipperLib from 'clipper-lib';

/**
 * 二维多边形运算（偏移 + 并集）
 *
 * 这里替代的是原先 OpenCascade 承担的全部工作。之所以能替代，是因为本项目里
 * OpenCascade 实际只做了两件二维操作：
 *   1. 房间轮廓向外偏移墙厚 → 求并集 → 取外边界（户型外轮廓）
 *   2. 门窗轮廓向外偏移 15mm（用于 CSG 挖洞留余量）
 *
 * 所有输入都在 z=0 平面上，弧线在 json_parse 里已被采样成折线。也就是说，
 * 一个 50MB 的 CAD 内核只是被当成二维多边形库在用，还要付 5 秒的 wasm 初始化。
 *
 * Clipper 用整数坐标以保证鲁棒性，故需先放大再还原。原始单位是毫米，
 * SCALE=100 即 0.01mm 精度，远高于建筑图纸所需。
 */

const SCALE = 100;

const toClipper = points => points.map(p => ({
    X: Math.round((Array.isArray(p) ? p[0] : p.x) * SCALE),
    Y: Math.round((Array.isArray(p) ? p[1] : p.y) * SCALE)
}));

const fromClipper = path => path.map(p => [p.X / SCALE, p.Y / SCALE, 0]);

// 清理阈值：0.1mm。低于此的边和共线点会被合并。
// 弧线采样 + 偏移会留下大量极短边与近共线点，它们会让 ExtrudeGeometry 产出
// 退化三角形，进而使 three-bvh-csg 抛异常（"Cannot read properties of null (reading 'dot')"）——
// 而该异常又会被 CSG 的 catch 吞掉，表现为「洞静默地没挖出来」。
const CLEAN_DISTANCE = 0.1 * SCALE;

const clean = paths => ClipperLib.Clipper.CleanPolygons(paths, CLEAN_DISTANCE)
    .filter(p => p.length >= 3);

/** 有符号面积：正为逆时针，负为顺时针 */
function signedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const ax = Array.isArray(a) ? a[0] : a.x, ay = Array.isArray(a) ? a[1] : a.y;
        const bx = Array.isArray(b) ? b[0] : b.x, by = Array.isArray(b) ? b[1] : b.y;
        sum += ax * by - bx * ay;
    }
    return sum / 2;
}

/**
 * 让 ring 的绕向与参考多边形一致。
 *
 * Clipper 会把输出路径规范化成固定绕向，而调用方（ExtrudeGeometry → CSG）依赖
 * 绕向来判定内外：绕向反了，挤出体的法线朝内，布尔运算就挖不出洞——而且不报错。
 * 原先的 OpenCascade 实现保留了输入多边形的绕向，这里必须复现这一点。
 */
function matchWinding(ring, reference) {
    const refCCW = signedArea(reference) >= 0;
    const ringCCW = signedArea(ring) >= 0;
    return refCCW === ringCCW ? ring : [...ring].reverse();
}

/**
 * 多边形向外偏移
 *
 * JoinType.jtMiter 对应原先 OpenCascade 的 GeomAbs_Intersection：
 * 保持尖角，而不是把拐角磨圆。
 *
 * @param {Array} points - 多边形顶点，[x,y] 或 {x,y}
 * @param {number} distance - 偏移距离（正数向外）
 * @returns {Array<Array>} 偏移后的多边形（可能不止一个）
 */
export function offsetPolygon(points, distance) {
    if (!points || points.length < 3) return [];

    const co = new ClipperLib.ClipperOffset(2.0, 0.25);
    co.AddPath(
        toClipper(points),
        ClipperLib.JoinType.jtMiter,
        ClipperLib.EndType.etClosedPolygon
    );

    const solution = [];
    co.Execute(solution, distance * SCALE);

    // 绕向必须与输入一致，否则下游挤出体的法线会朝内，CSG 挖不出洞
    return clean(solution).map(fromClipper).map(ring => matchWinding(ring, points));
}

/**
 * 多个多边形求并集，返回外边界。
 *
 * 对应原先的 BRepAlgoAPI_Fuse + ShapeAnalysis_FreeBounds：逐个融合后提取边界线。
 * pftNonZero 保证内部的洞不会被当成外边界。
 *
 * @param {Array<Array>} polygons - 多边形数组
 * @returns {Array<Array>} 并集的各条边界（外环 + 可能的内环）
 */
export function unionPolygons(polygons) {
    const paths = polygons
        .filter(p => p && p.length >= 3)
        .map(toClipper);

    if (paths.length === 0) return [];

    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);

    const solution = [];
    clipper.Execute(
        ClipperLib.ClipType.ctUnion,
        solution,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
    );

    return clean(solution).map(fromClipper);
}

/** 多边形面积（用于和 OpenCascade 的结果做等价性比对） */
export { matchWinding };

export function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const ax = Array.isArray(a) ? a[0] : a.x, ay = Array.isArray(a) ? a[1] : a.y;
        const bx = Array.isArray(b) ? b[0] : b.x, by = Array.isArray(b) ? b[1] : b.y;
        area += ax * by - bx * ay;
    }
    return Math.abs(area) / 2;
}
