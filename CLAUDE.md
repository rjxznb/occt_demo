# CLAUDE.md

给在本仓库工作的 AI / 开发者的注意事项。记录的都是**实际踩过的坑**——它们的共同特点是
**不会报错，只会静默地给出错误结果**，所以格外值得先读一遍。

## 项目速览

纯前端应用，无后端，不依赖 WebAssembly。几何运算全在客户端用 JS 完成。

```bash
npm run dev      # Vite, http://localhost:3000
npm run build
```

启动后先出现数据选择界面（`DataSourcePicker`），可选本地文件或内置示例数据。

---

## 一、CSG 布尔运算的四条铁律

全部集中在 `src/components/RoomRenderer.js`。违反任何一条都不会抛异常。

### 1. 不要对零厚度的平面做 CSG

平面没有"内部"和"外部"，而布尔运算的整个理论基础就是内外判定。引擎在这种退化情形下
只能空转：**实测单次减法 1597ms，是同一引擎在 3D 实体上的近 100 倍。**

原来的 `PlanRenderer` 对 `ShapeGeometry`（零厚度）做了 31 次布尔，耗时 **49.5 秒**。
现在改用 `THREE.Shape.holes`——外轮廓为 shape，房间/门/窗作为 holes，`ShapeGeometry`
一次三角化完成，**16ms**。

> 2D 的任何"挖洞"需求，答案都是 `Shape.holes`，不是 CSG。

### 2. 减数不能无脑合并——重叠会产生非流形几何

"把互不相交的减数合并成一个几何体，再一次减掉"是本项目最大的性能优化（避免逐个累积时
被减数不断膨胀、每轮重建 BVH）。**但前提是它们真的互不相交。**

门窗为了挖穿墙体各自向外扩了 15mm，**相邻的会互相重叠**。把重叠的实体拼进同一个缓冲区
会得到非流形几何，BVH 的内外判定随即失效——**洞根本挖不出来，且不报任何错**。

所以必须先用 `groupDisjoint()` 按包围盒把减数贪心分组成互不重叠的批次，每批合并后减一次。
实际数据下通常只分出 2~3 组，性能收益基本保留。

### 3. 挖洞必须用 `processed_*`（外扩版），不是显示用的门窗

`getDoorsAndWindows()` 返回两套数据：

- `doors` / `windows` — 原始尺寸，**用于显示**
- `processed_doors` / `processed_windows` — 向外扩了 15mm，**用于挖洞**

用原始尺寸挖洞，洞壁会与门窗自身的面**完全共面**，导致 z-fighting（表现为放射状条纹）。

这个 bug 在旧代码里潜伏了很久，因为外轮廓那步走的是 BSP 引擎，而 `App.js` 传的
`csgEpsilon = 30.1`（30 毫米的容差！）恰好把洞切"松"了，掩盖了共面。换成精确的
three-bvh-csg 之后它立刻现形。

### 4. 每次布尔前必须清理退化三角形

**three-bvh-csg 自己的输出里会夹带零面积三角形。** 本项目是链式布尔（外轮廓先减房间、
再减门窗），把上一次的结果直接喂回去做下一次，引擎在算面法线时会拿到 `null` 并抛出：

```
Cannot read properties of null (reading 'dot')
```

而这个异常会被 CSG 的 catch 吞掉（见下一节），表现为**洞静默地没挖出来**。

`bakeGeometry()` 末尾的 `removeDegenerateTriangles()` 负责此事。实测数据：外轮廓减完
7 个房间后，3560 个三角形里有 8 个零面积、2 个极小面积——足以让下一次布尔整个失败。

> 排查这类问题时，**先打印几何体的退化三角形数量**，不要靠猜。我为了这个 bug 依次排除了
> 顶点重复、绕向、短边清理、减数偏移，全都不是——最后加一行诊断就看清了。

---

## 二、静默失败的模式

### CSG 失败会被吞掉

`CSGOperations.subtractGeometry()` 的 catch 分支是 `return meshA`——**原样返回被减数**。
这意味着"洞没挖出来"和"一切正常"在代码层面看不出区别，只能靠肉眼看渲染结果。

改动 CSG 相关代码后，**必须看图**（见下文"验证"）。

### 不要用 node_modules 路径 import three

曾经有一行：

```javascript
import * as THREE from '../../node_modules/three/build/three.module.js';  // 错误
```

Vite 会把裸模块名 `three` 预打包成一份实例，而这个裸路径是另一份——**两份 three 的
class 身份不同**。后果是 `geometry instanceof THREE.BufferGeometry` 恒为 `false`，
校验函数误判"几何体无效"，CSG 抛错后被 catch 吞掉，布尔运算变成**静默的空操作**。

一律用 `import * as THREE from 'three'`。

---

## 三、性能：先剖析，再优化

**调用次数多 ≠ 耗时多。** 本项目里靠"数调用次数"推断出的瓶颈，实测全是噪声：

| 看起来很可怕的东西 | 实测耗时 |
|---|---|
| `isValidMesh` 全顶点扫描，累计扫了 **287 万个顶点** | **19 ms** |
| `computeBoundingBox` 调用 **2910 次** | **11 ms** |

真正的瓶颈全部是**算法层面**的：对平面做 CSG、逐个累积布尔、每条线一个 draw call。

### 剖析方法

用 monkey-patch 给关键方法打点，不改源码。注意两个陷阱：

- **不要用 `--virtual-time-budget`**：它会冻结 `performance.now()`，所有耗时都测成 0。
  用 puppeteer-core + 真实时钟。
- **必须用与真实应用一致的构造参数**：我第一次剖析时给 `RoomRenderer` 传了默认参数，
  导致真实应用会走的那条 CSG 引擎路径根本没被触发，测出来的数据是假的。

### 当前各阶段耗时（示例户型：7 房间 / 15 门 / 9 窗 / 62 软装）

| 阶段 | 耗时 |
|---|---|
| 加载并解析户型 JSON | ~0.1 s |
| 几何服务（外轮廓并集等） | ~0.01 s |
| 3D 建模 | ~0.76 s |
| 2D 彩平图（含软装） | ~0.14 s |

---

## 四、验证：必须看图，且要放大看

**1 倍分辨率的截图会掩盖 z-fighting。** 重构 CSG 时我在 1x 截图上确认"画面一致"，
实际上弧形窗上已经出现了条纹——放大到 3 倍（`deviceScaleFactor: 3`）才看见。

推荐做法（临时装 `puppeteer-core`，用系统自带的 Edge，验证完卸载）：

```javascript
const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']  // headless 下需要软件 WebGL
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 3 });
await page.goto('http://localhost:3000/');

// 等应用把状态推到「就绪」——它是在 loadData() 成功返回之后才写的
await page.waitForFunction(
    () => document.getElementById('info')?.textContent?.includes('就绪'),
    { timeout: 180000, polling: 500 }
);

// 局部放大截图，重点看弧形墙/弧形窗——它们最容易暴露 CSG 问题
await page.screenshot({ path: 'zoom.png', clip: { x: 390, y: 130, width: 200, height: 160 } });
```

改动渲染逻辑前**先存一张基准图**，改完逐处比对。想拿到"重构前"的基准，可以
`git stash push -- <file>` 后截图，再 `git stash pop`。

场景可以从 `window.occtApp.roomRenderer.sceneGroup` 拿到，用来逐类隐藏物体、
定位是哪个 mesh 出了问题。

---

## 五、数据

### 需要两样东西，且它们绑死在一起

1. **户型 JSON** — 房间、门窗、图例清单
2. **`parsed_dxf/{TypeId}_{序号}.json`** — 每个图例实例的几何

**序号是该图例在解析顺序中的下标**（`json_parse.js` 里 `dxf_num++`，跨 soft_list /
door_list / window_list 全局递增）。所以这批文件和特定的户型 JSON 绑死了，换 JSON
必须换整套 `parsed_dxf`——**配错不会报错，只会大面积静默 404**。

`DataSourcePicker` 会在渲染前做配套校验，当场列出缺失项。

两个容易搞错的点：

- **图例清单包含软装、门、窗三类**（示例数据是 62 + 15 + 9 = 86 项，不是 62 项）
- **`freestyle`（自由绘制）图例的点数据直接在户型 JSON 里**，不需要几何文件，校验时要排除

### 不需要原始 .dxf

`parsed_dxf` 不是 DXF 的直接解析结果。外部解析器会按每个实例的宽/长对图例做**参数化拉伸**
（保住边距、只拉伸中段）——同一 TypeId 的不同实例会被拉成不同尺寸。这套逻辑在解析器里，
不在 DXF 里，浏览器无法自行还原。**引入 DXF 解析库也没用**，拿到的会是原始尺寸的图例。

---

## 六、其他坑

### 墙体是零厚度的曲面带，不是实体

`WallFactory` 生成的墙体只是底边顶点 + 顶边顶点连成的三角形带。对它做布尔实际上是
"用实体裁剪开放曲面"，three-bvh-csg 能正确处理，但对容差敏感。

### 二维多边形运算：绕向与多环

`Polygon2D.js`（Clipper 封装）替代了原先的 OpenCascade。两个坑：

- **绕向**：Clipper 会把输出路径规范化成固定绕向，而下游 `ExtrudeGeometry` → CSG 依赖
  绕向判定内外。绕向反了，挤出体的法线朝内，布尔运算挖不出洞——**且不报错**。
  用 `matchWinding()` 让结果与输入保持一致。
- **多环**：并集的边界通常不止一个环（外环 + 房间之间空隙形成的内环）。必须用
  `THREE.Shape` 的 holes 表达，**不能把多个环压平进同一条路径**——那会得到自交的畸形。
  OpenCascade 当年就是这么返回的（还把每条边的两个端点都吐出来、顶点两两重复），
  下游把它当单个多边形三角化，纯属歪打正着。不要复刻那个格式。

### 几何变换的存放位置不统一

- `WallFactory` 直接用**世界坐标**建几何，mesh.position 基本为 0
- `DoorWindowFactory` 把 **z 偏移挂在 `mesh.position`** 上

合并或做布尔前必须先用 `bakeGeometry()` 把 mesh.matrix 烘焙进几何、统一属性集，
否则会错位。

### 依赖

**UI 全是原生 DOM 操作，没有前端框架。** 文档里曾长期写着 "UI: React 18"，是错的——
`react`、`react-dom`、`@vitejs/plugin-react`、`lodash-es`、`@ke/kedxf`、`opencascade.js`
都曾是未被引用的死依赖，现已全部移除。

`three-mesh-bvh` 虽然源码里没直接 import，**是 `three-bvh-csg` 的 peer dependency，
必须保留**。

### 不要在热路径里 console.log

尤其不要打印整个 mesh 对象——它会保留引用阻止 GC。旧代码有 3437 次 console 调用，
实测约占 render 耗时的 13%。

---

## 七、Windows 环境

Bash 工具跑的是 Git Bash，**不是 PowerShell**：

- PowerShell 的 here-string（`@'...'@`）在 Bash 里是普通字符（我因此写坏过两次 commit
  message）。多行文本用 `git commit -F <file>`。
- Git Bash 会做路径转换，`curl http://localhost:3000/data/x.json` 里的 `/data/...`
  可能被当成 Windows 路径。用 PowerShell 的 `Invoke-WebRequest` 更省事。
- 本机有代理，`curl` 访问 localhost 可能返回 502，需要 `--noproxy '*'`。

## 八、Git 操作规范

**不要自动 push**——每次 commit 后必须等用户明确同意再执行 `git push`。
可以先 commit（本地），但 push 前先问用户。
