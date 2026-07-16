# SceneModel —— 统一场景数据结构设计

> 目标：让 2D 彩平图与 3D 视图共享同一套底层数据，从根上解决选中、材质、软装
> 在两个视图间不同步的问题。本文是设计草案，尚未落地实现。

## 背景：现在为什么不同步

当前 `App.loadData()` 从 `GeometryService` 取 `{outline, rooms, doorWindows}`，然后给
2D 和 3D 各做一份**深拷贝**（`JSON.parse(JSON.stringify(data))`），两个渲染器各自建
独立的 mesh，彼此之间**没有任何 id 关联**。

结果：
- 共享的只是"输入 JSON"，不是"场景实体"。
- 2D 选中一个房间，3D 对应的墙不会高亮（两边靠 `userData.roomIndex` / `userData.type`
  各认各的）。
- 3D 改了材质，2D 不知道。
- 软装只活在 2D（`SoftlistRenderer` 挂 2D 场景），3D 里根本没有。

这不是"共享同一套底层数据结构"，而是"两条独立管线恰好吃同一份输入"。

---

## 完整 entity 清单

盘点全项目后，实际涉及的 entity 如下。

### A. 当前实际渲染的（9 类）

| entity | 来源 | 2D | 3D | 几何本质 |
|---|---|:--:|:--:|---|
| 房间 room | `final_room_list` | 选择+彩色面 | CSG减+地板 | footprint(带bulge) + 高2800 |
| 墙 wall | **房间边派生** | — | 直/弧分段 | 房间边 → 直墙/弧墙段 |
| 地板 floor | **房间派生** | — | ✓ | footprint @ z=0 |
| 外轮廓 outline | **房间并集派生** | 底板 | 挤出壳体 | {outer, holes} 环 |
| 门 door | `door_list` | 挖洞 | 挤出+挖洞 | footprint + 高, base=0 |
| 窗 window | `window_list` | 挖洞 | 挤出+挖洞 | footprint + 高 + base=离地 |
| 软装(dxf) softlist | `soft_list` + parsed_dxf | 符号 | — | polylines+wipeouts + (宽×长) |
| 软装(自由) freestyle | `soft_list`(点在JSON) | ✓ | — | 内联点 + 颜色 |
| 放置模型 placedModel | **运行时拖拽** | — | ✓ | 基本体 + 位置 |

### B. 已解析但未渲染（1 类）

- **尺寸标注 dimension**（`final_space_dim_list` → `Dim_Points`）：标注线段
  `[{x,y,z}]`。`json_parse` 解析了，但没有任何渲染器用它。

### C. JSON 里存在、当前完全没碰（~28 个 list）

梁 `beam`、柱 `pillar`、飘窗/平台 `platform`、壁龛 `niche`、窗台 `window_sill`、
承重/内墙 `load_bearing_wall`/`in_wall`/`independent_wall`、散热器 `radiator`、
强弱电箱、各种水/污/燃气管、摄像头、动线 `move_path` …… 结构/机电类，全未接入。

---

## 关键观察：只需要 3 种几何表示

把所有 entity 摊开看，几何本质只有三形态：

1. **`area` 面体** —— footprint（带 bulge 的多边形）+ `{base, height}` 竖向区间。
   覆盖：房间、墙、地板、外轮廓、门、窗、软装占位块，以及那 28 个里的实体类
   （梁/柱/飘窗/窗台/壁龛/墙，乃至管道当细长盒子）。**这是 90% 的情况。**
2. **`symbol` 符号** —— 一组 polylines + 填充块（wipeouts），平面画。
   覆盖：软装的 dxf 图形、freestyle。
3. **`annotation` 标注** —— polylines + 文字，非实体。
   覆盖：尺寸标注、动线。

一个 entity 可以**同时挂多种表示**——软装就是既有 `area`（3D 占位块）又有
`symbol`（2D 平面符号）。

---

## 数据结构

```js
/**
 * 场景模型：视图无关的单一真相源。2D/3D 都从它投影。
 */
SceneModel {
  units: 'mm',
  wallHeight: 2800,           // 全局默认层高
  wallThickness: 240,

  entities: Map<EntityId, Entity>,   // 所有实体，按稳定 id 索引

  // 派生缓存（由 rooms 算出，脏了重算，不手写）
  derived: {
    outline: { outer, holes },       // 房间并集外扩后的边界
    // walls / floors 也可缓存，或渲染时现算
  },
}

EntityId = string   // 稳定 id：'room:3' | 'door:5' | 'soft:20cd02_0' | 'wall:3/2'

Entity {
  id: EntityId,
  kind: 'room'|'wall'|'floor'|'outline'|'door'|'window'
       |'softlist'|'freestyle'|'dimension'|'placedModel'
       |'beam'|'pillar'|'platform'|'niche'|'sill'|...,   // 可扩展
  source: 'json'|'derived'|'runtime',   // 来自JSON / 派生 / 运行时新增
  typeId?: string,                      // 语义（软装/门窗的图例类型）

  // ── 几何：三种表示，按需挂，可并存 ──
  area?: {
    footprint: Point[],   // [{x, y, bulge}]  ← 2D/3D 共享的脊梁
    base:   number,       // 底面 z（门=0，窗=离地，梁=层高-梁高…）
    height: number,       // 竖向厚度（2D 忽略）
    holes?: Point[][],    // 仅 outline 用（内环）
  },
  symbol?: {
    polylines: Point[][], // 线
    fills:     Point[][], // 填充块（wipeout）
  },
  annotation?: {
    lines: Point[][],
    labels?: { text, at }[],
  },

  // ── 摆放（软装/放置模型：symbol/area 是局部坐标，靠这个变换到世界）──
  transform?: { base: {x,y,z}, rotate: number, scale: {x,y,z} },

  // ── 状态（2D/3D 共享，改一处两边同步）──
  material?: MaterialRef,
  selected?: boolean,
  visible?: boolean,
}

Point = { x: number, y: number, bulge?: number }   // bulge≠0 表示到下一点是弧
```

---

## 每类 entity 怎么落

### 门（worked example）

门的原始 JSON 与 2D/3D 的字段需求：

| JSON 字段 | 解析成 | 2D 用 | 3D 用 |
|---|---|:--:|:--:|
| `Points`(世界坐标轮廓) | `area.footprint` | ✓ 挖洞 | ✓ 挤出截面 |
| `BlockInnerInfo.高度` | `area.height` | — | ✓ 挤出高度 |
| `BlockInnerInfo.离地高度` | `area.base` | — | ✓（窗台 z；门=0） |
| `Size` | — | — | — （现在解析了但没人用，删） |
| `TypeId` | `typeId` | — | 语义标识 |
| `BasePoint`/`OutRotate`/`OutScale`/`翻转` | — | — | — （Points 已是世界绝对坐标） |

```js
{ id:'door:5', kind:'door', source:'json', typeId:'20xx',
  area: { footprint:[{x,y,bulge:0}, ...], base:0, height:2000 } }
// 2D：读 area.footprint 挖洞（忽略 base/height）
// 3D：读 area.footprint 从 z=0 挤到 z=2000
// 挖洞用的外扩版 = area.footprint 派生（不再是平行数组 processed_doors）
```

### 全表

| kind | area | symbol | annotation | transform |
|---|:--:|:--:|:--:|:--:|
| room | ✓ footprint+高2800 | | | |
| wall | ✓ (房间边派生) | | | |
| floor | ✓ base=0,height=0 | | | |
| outline | ✓ +holes | | | |
| door | ✓ base=0 | | | |
| window | ✓ base=离地 | | | |
| softlist | ✓ 宽×长占位(3D) | ✓ dxf图形(2D) | | ✓ |
| freestyle | (可选占位) | ✓ 内联点 | | ✓ |
| dimension | | | ✓ | |
| placedModel | ✓ | | | ✓ |

---

## source vs derived —— 消除重复解释

- **source（JSON 直出）**：room / door / window / softlist —— 存原始 footprint。
- **derived（算出来的）**：outline / wall / floor —— 由 rooms 算，进 `derived` 缓存。

现在 outline 在 `GeometryService` 算、wall 在 `WallFactory` 算、floor 在
`FloorFactory` 算，**各算各的、口径还不一致**；统一后它们都是"rooms 的投影"，
一处算、带缓存。

这也顺手解决两个现存脆点：

1. **`processed_doors`（外扩挖洞版）现在是平行数组、靠"和 doors 同下标"关联**，
   很脆。统一后它是 `door.area.footprint` 的**派生属性**，下标耦合消失。
2. **门靠 `doorIndex`、软装靠 `TypeId_序号`、房间靠数组下标** 各认各的 →
   统一成稳定 `id`。这是 2D/3D 选中同步的地基。

---

## 两个渲染器怎么投影

渲染器从"拥有者"退化成"投影"——**只读** `SceneModel`，各自建 mesh，但每个 mesh 记
`mesh.userData.entityId` 指回模型。

- **PlanRenderer（2D）**：遍历 entities，`area` → `flatten(footprint)` 平面三角化；
  `symbol` → 画线+填充；`annotation` → 画标注。忽略 `base/height`。
- **RoomRenderer（3D）**：`area` → `flatten(footprint)` 从 `base` 挤到 `base+height`；
  `symbol`/`annotation` 等 2D 专属的跳过。

### 状态同步

不共享 `THREE.Mesh`（2D 和 3D 几何本就不同），共享的是**实体和它的状态**：一个中央
`SelectionController` 持 `selectedEntityId`，两个视图都订阅——2D 点 `room:3` →
设 `selectedEntityId='room:3'` → 3D 监听到、把 `entityId==='room:3'` 的墙高亮。选中、
材质、软装，全靠这条"id + 状态订阅"自动同步。

---

## 弧（bulge）的统一处理

弧在源数据里就是**顶点上的一个 `bulge` 值**（单边+bulge，不是预先密采样）。当前同一个
概念被三处用三种方式处理：

| 谁 | 怎么处理弧 |
|---|---|
| 门窗 / freestyle | `json_parse` 里 `sampleAllArcs` 采样成折线 |
| 房间外轮廓(Clipper) | `offsetPolygon` 只取 x,y → **把弧当成弦**（弧丢了，潜在 bug） |
| 墙体 | `WallFactory.analyzeWallSegments` 读 bulge → 单独建 arc 段 |

**结论：**

1. **弧不是一种独立实体，是 footprint 一条边的属性**（`bulge`）。弧形墙和直墙是同一个
   `kind:'wall'`，区别只在某条边 `bulge≠0`。不要给"弧形墙"单开 kind。
2. **弧的采样收敛成一个共享的 `flatten(footprint, 容差)`**，把 bulge 弧采成密折线。
   2D/3D、外轮廓、墙，全走它。替换掉现在散在三处、还各有 bug 的处理。
3. **曲面细分密度是渲染参数，不进模型。** 模型只说"这条边 bulge=0.5"，3D 渲染器自己
   决定切多少段。

---

## 可扩展性

那 28 个没接的 list，**不需要新机制**：

- 梁/柱/飘窗/窗台/壁龛/墙 → 加个 `kind` 挂 `area`（都是 footprint+高）。
- 管道/动线 → `annotation` 或细长 `area`。
- 强弱电箱/摄像头 → 带 `transform` 的 `symbol`/`area`。

模型天生能容纳，接不接是渲染层要不要画的问题。

---

## 落地路径（增量）

不必一次重写。建议竖切验证：

1. **先做"房间选中同步"这一条**：给房间编稳定 id + `SelectionController` +
   2D/3D 两边订阅。跑通证明"单一真相源 + 视图投影"模式成立。
2. 再把门窗接进 `SceneModel`（`GeometryService` 输出改成实体），验证 3D/2D 都从模型投影。
3. 材质状态收拢到实体（`entity.material`），两个材质侧边栏改成读写实体。
4. 软装提升为一等实体（同一个 `soft:xxx` id，3D 占位块 + 2D 符号）。
5. 弧处理合并成 `flatten`。
6. 视需要接入结构/机电 list。

每步都能独立验证、独立收益，不需要"大爆炸"式重构。
