# OCCT 户型图可视化系统

基于 Three.js 的户型图可视化系统，支持 3D 立体显示和 2D 彩平图，提供材质编辑、模型拖拽和 CSG 几何运算。

**纯前端应用**：没有后端服务，也不依赖 WebAssembly，几何运算全部在客户端用 JS 完成。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [安装运行](#安装运行)
- [数据格式](#数据格式)
- [使用说明](#使用说明)
- [开发指南](#开发指南)
- [故障排除](#故障排除)

## 功能特性

### 3D 可视化
- **立体户型显示**：由户型轮廓生成墙体、地板与门窗
- **CSG 几何运算**：三维布尔运算，自动完成门窗开洞
- **材质系统**：材质库与实时材质编辑

### 2D 彩平图
- **平面视图**：房间、门窗、软装的平面呈现
- **房间选择**：交互式房间选择和编辑
- **软装管理**：DXF 软装图例的渲染与材质编辑
- **视图切换**：3D / 2D 无缝切换

### 交互功能
- **双模式操作**：查看模式与编辑模式
- **拖拽操作**：材质和模型的拖拽应用
- **快捷键**：G 移动 / R 旋转 / S 缩放 / Del 删除 / Esc 取消选择
- **右键菜单**：上下文相关操作

## 技术栈

| 用途 | 依赖 |
|---|---|
| 3D 渲染 | Three.js 0.178 |
| 二维多边形运算 | clipper-lib 6.4（偏移 + 并集） |
| CSG 布尔运算 | three-bvh-csg 0.0.17 + three-mesh-bvh 0.8 |
| UI | 原生 DOM（无框架） |
| 构建 | Vite 6 |

> UI 全部是原生 DOM 操作，没有前端框架。`three-mesh-bvh` 虽然源码里没直接
> import，但它是 `three-bvh-csg` 的 peer dependency，必须保留。

## 项目结构

```
occt/
├── index.html                    # 应用入口
├── vite.config.js
├── public/
│   └── data/                     # 内置示例数据
│       ├── Drawing2.json         # 户型 JSON
│       └── parsed_dxf/           # 软装/门窗图例几何
├── src/
│   ├── App.js                    # 主应用
│   ├── core/
│   │   ├── GeometryService.js    # 几何服务：户型解析 + 外轮廓/门窗轮廓计算
│   │   ├── Polygon2D.js          # 二维多边形运算（Clipper 封装）
│   │   ├── DataSource.js         # 数据来源抽象（内置示例 / 本地文件）
│   │   ├── SceneManager.js       # 3D 场景管理
│   │   └── Scene2DManager.js     # 2D 场景管理
│   ├── components/
│   │   ├── DataSourcePicker.js   # 启动时的数据选择界面
│   │   ├── RoomRenderer.js       # 3D 渲染 + CSG 布尔运算
│   │   ├── PlanRenderer.js       # 2D 彩平图渲染
│   │   ├── SoftlistRenderer.js   # 软装渲染
│   │   ├── WallFactory.js        # 墙体工厂
│   │   ├── FloorFactory.js       # 地板工厂
│   │   ├── DoorWindowFactory.js  # 门窗工厂
│   │   ├── MaterialSidebar.js    # 3D 材质库
│   │   ├── DXFMaterialSidebar.js # 2D 软装材质编辑器
│   │   ├── DragDropManager.js    # 拖拽管理
│   │   ├── SelectionManager.js   # 3D 选择管理
│   │   ├── WallSelector.js       # 墙面选择
│   │   ├── Room2DSelector.js     # 2D 房间选择
│   │   └── Softlist2DSelector.js # 2D 软装选择
│   ├── utils/
│   │   ├── json_parse.js         # 户型 JSON 解析
│   │   ├── colorplane.js         # 弧形采样等几何工具
│   │   └── SVGLoader.js
│   └── config/
│       └── freestyle.js          # 自由绘制图例的 TypeId 配置
└── package.json
```

## 安装运行

### 环境要求
- Node.js >= 16
- 支持 WebGL 2.0 的现代浏览器

```bash
npm install
npm run dev        # 开发服务器，http://localhost:3000
npm run build      # 生产构建
npm run preview    # 预览构建产物
```

打开 http://localhost:3000 后会先出现数据选择界面，可以：

- **选择本地数据**：选一个户型 JSON，再选与之配套的 `parsed_dxf` 目录
- **使用内置示例数据**：直接加载 `public/data/` 下随仓库分发的那一套

## 数据格式

渲染一套户型需要两样东西，**它们是配套的，必须来自同一次解析**：

### 1. 户型 JSON

CAD 导出的图纸数据，包含房间轮廓、门窗，以及软装清单（每个软装实例的 TypeId 与宽/长）。

### 2. parsed_dxf 目录

每个图例实例的几何，文件名为 `{TypeId}_{序号}.json`：

```javascript
{
  "polylines": [ [[x, y], [x, y], ...], ... ],  // 线条
  "wipeouts":  [ [[x, y], [x, y], ...], ... ]   // 填充区域
}
```

> **注意：文件名里的序号是该图例在解析顺序中的下标**，所以这批文件和特定的户型
> JSON 绑死了。换一份 JSON 就必须换上与之一同产出的 `parsed_dxf`，拿旧的去配新的
> 只会大面积缺图。数据选择界面在渲染前会做配套校验，当场列出缺失项。

### 为什么不需要原始 .dxf

`parsed_dxf` 不是 DXF 图例库的直接产物。外部解析器会按每个实例的宽/长对 DXF 图例做
**参数化拉伸**（保住边距、只拉伸中段）后再输出——同一个 TypeId 的不同实例，几何会被
拉成不同尺寸。这套拉伸逻辑不在 DXF 文件里，浏览器无法自行还原，所以必须使用已解析的
JSON，而不是原始 `.dxf`。

### 数据是怎么产出的

```
{TypeId}.dxf 图例库  ┐
                     ├─→ [外部解析器：按实例宽/长参数化拉伸] ─→ parsed_dxf/*.json
户型 JSON（含实例尺寸）┘
```

外部解析器不是本仓库的一部分，也**不是运行本应用的前提**——只要你已经有解析好的数据。

## 使用说明

### 视图切换
- **3D 视图**：立体户型
- **2D 彩平图**：平面图，含软装

### 材质操作
1. 点击「资源库」打开材质侧边栏
2. 拖拽材质到 3D 模型上应用
3. 右键点击对象调整材质属性

### 软装编辑（2D 模式）
1. 切换到 2D 彩平图
2. 点击软装选中
3. 在弹出的材质编辑器中调整属性

## 开发指南

### GeometryService（几何服务）

承担原先后端 `server.js` 的全部职责，跑在浏览器里：

| 方法 | 说明 |
|---|---|
| `init()` | 加载并解析户型数据 |
| `setDataSource(ds)` | 指定数据来源，须在 `init()` 之前调用 |
| `getOutline()` | 户型外轮廓：房间轮廓各自外扩墙厚 → 求并集 → 取边界环（外环 + 内环） |
| `getRooms()` | 房间数据 |
| `getDoorsAndWindows()` | 门窗数据。`processed_*` 是外扩 15mm 后用于挖洞的轮廓 |
| `getSoftlists()` | 图例清单（含软装、门、窗） |
| `getSoftlistPoints(id)` | 按 id 取图例几何 |

### CSG 布尔运算

统一使用 `three-bvh-csg`。核心在 `RoomRenderer.js`：

- **合并后一次减**：房间之间互不相交，把它们的几何合并成一个 BufferGeometry
  （纯缓冲区拼接，零布尔成本）后一次减掉，而不是逐个累积——后者每一轮都要为不断
  膨胀的被减数重建 BVH。
- **但减数不能无脑合并**：门窗为了挖穿墙体各自外扩了 15mm，相邻的会互相重叠。
  把重叠的实体拼进同一个缓冲区会得到**非流形**几何，BVH 的内外判定随即失效、洞挖不出来。
  因此先用包围盒把减数贪心分组成互不重叠的批次（`groupDisjoint`），每批合并后减一次。
- **挖洞必须用 `processed_*`（外扩版）**：用原始尺寸的门窗会让洞壁与门窗自身的面共面，
  导致 z-fighting。
- **每次布尔前清理退化三角形**：three-bvh-csg 的输出里会夹带零面积三角形，把这样的
  结果再喂回去做下一次布尔，它会抛异常——而异常被 catch 吞掉，表现为「洞静默地没挖出来」。
  `bakeGeometry` 末尾的 `removeDegenerateTriangles` 就是为此。

### 2D 渲染

**不要对平面用 CSG。** `PlanRenderer` 用 `THREE.Shape.holes` 挖洞：外轮廓为 shape，
房间/门窗作为 holes，由 `ShapeGeometry` 一次三角化完成。

零厚度的平面没有内外之分，布尔运算在这种退化情形下会空转——实测单次减法耗时 1597ms，
是同一引擎在 3D 实体上的近 100 倍。

### 软装渲染

一个 DXF 图例常有上百条 polyline，每条平均只有 3 个点。若各自成 `THREE.Line`，
整个场景会有上万次 draw call 去画几万个顶点，纯属调用开销。`SoftlistRenderer` 按
图例实例把 polyline 合并成单个 `LineSegments`。

## 故障排除

### 首屏加载
约 2 秒。曾经是 9 秒——当时几何运算用的是 OpenCascade.js，光 wasm 初始化就要 5 秒。
但本项目实际只需要两种二维操作（多边形外扩、并集），且所有输入都在 z=0 平面上，
为此背一个 50MB 的 CAD 内核并不划算，现已改用 clipper-lib（见 `src/core/Polygon2D.js`），
几何运算从 6064ms 降到 13ms。

### 软装大面积缺失
`parsed_dxf` 与户型 JSON 不配套。数据选择界面会在渲染前列出缺失的文件名，
确认它们来自同一次解析。

### CSG 结果异常（洞没挖出来 / 出现条纹）
CSG 失败会被 catch 吞掉并原样返回被减数，所以**先看控制台有没有 `CSG减法失败`**，
再按下面排查：
- `Cannot read properties of null (reading 'dot')`：被减数里有退化三角形
  （多半是上一次 CSG 的产物），见 `removeDegenerateTriangles`
- 洞没挖出来：检查减数是否互相重叠却被合并进了同一批（见 `groupDisjoint`）
- 出现条纹（z-fighting）：检查挖洞是否误用了原始尺寸的门窗，应使用 `processed_*`

### 调试
- 控制台输出各组件的初始化与运行状态
- 右上角 FPS 计数器
- Chrome DevTools 的 Performance / Memory 面板

## 许可证

[待补充]
