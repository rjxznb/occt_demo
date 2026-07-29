# 1408 U 型窗渲染设计

## 目标

在 OCCT 统一内容模型链路中实现 `1408`（U 型窗）的参数化解析和 UE 对齐规则，并通过只在调试 URL 开启的合成 CAD 记录完成本地可视验证。

## 依据

- `public/data/template.json`：`1408 -> ResId 2406318`，名称为 `U形窗`。
- 后端资源详情：`2406318` 是参数化模型，模型名称为 `BIMU形窗`。
- UE `ParameterDataManager.cpp`：8 顶点窗使用 `长/下厚/左厚/右厚/左宽/右宽` 映射参数。
- UE `TemplateManager.cpp`：U 型窗用于放置的尺寸需要 X 加两个外墙厚、Y 加一个外墙厚。
- UE `BIMScene.cpp::GetWindowsBoxBottomCenter`：U 型窗局部 X 原点位于宽度中心，局部 Y 对齐需要扣除外墙厚。

## 范围

- 只修改当前 OCCT 工作分支，不修改或部署 `cad_plugin`。
- 不修改真实 `Drawing2.json`。
- 普通 3D、VR 和 CAD 默认入口保持原行为。
- 仅 `index-3d.html?fixture=1408` 注入合成 U 型窗。
- 资源继续走现有链路：`TypeId -> template ResId -> goods detail -> parametric JSON -> OBJ`。

## 参数解析

`1408` 注册独立参数适配器，按 UE 名称映射：

| CAD `BlockInnerInfo` | 参数化模型参数 |
|---|---|
| `长` | `宽度` |
| `下厚` | `深度` |
| `左厚` | `左深` |
| `右厚` | `右深` |
| `左宽` | `左宽` |
| `右宽` | `右宽` |
| `高度` | `高度` |
| `离地高度` | `离地` |

`墙厚`优先使用 CAD 对象明确提供的墙厚；缺失时使用 drawing 级 `out_wall_thickness`。所有值仍受现有有限数值、去重和 64 项上限约束。

适配器应忠实生成 UE 定义的 `左深/右深` 参数；若当前参数化资源 schema 未声明这些参数，则由现有参数转换层按其既有规则过滤，不得因未知参数中断整个模型加载，也不得因此删除这两条 UE 映射。

## 放置规则

保持 normalized instance 中的 CAD 原始尺寸不变，在 `1408` placement adapter 内计算 UE 修正尺寸：

- `correctedX = Size.X + 2 * externalWallThickness`
- `correctedY = Size.Y + externalWallThickness`
- 人工局部盒：
  - `min = (-correctedX / 2, correctedY - externalWallThickness, 0)`
  - `max = ( correctedX / 2, -externalWallThickness, Size.Z)`
- 世界目标点使用 CAD 8 点轮廓在自身旋转坐标系中的包围盒中心。
- 模型原点等于世界目标点减去经过 CAD 旋转和水平/垂直翻转后的人工盒底面中心。
- `1408` 不增加额外旋转角；保留模板 `XMirror` 与 CAD 翻转的统一合成规则。
- 使用 `model-origin` 锚点，避免再以下载模型的真实包围盒中心重复偏移。

如果缺少有效 8 点轮廓、正尺寸或外墙厚，返回现有通用放置逻辑，保留可见 fallback，不生成猜测位置。

## 合成 fixture

- 将 fixture 机制扩展为同时支持 `1313` 和 `1408`，二者互斥，由查询参数精确选择。
- `1408` 合成记录放在一段清晰外墙上，包含 8 个 U 型轮廓点、非对称左右宽和深度，以便肉眼识别镜像或左右颠倒。
- fixture 使用真实 `ResId 2406318`，不嵌入或伪造模型文件。
- 点击模型时沿用现有 `#debug` 输出，必须显示 `TypeId=1408` 和对应 `window_list` identity。

## 测试与验收

1. 参数测试精确断言 UE 的 8 点字段映射。
2. 放置测试使用非对称 U 型原型，断言人工盒中心、模型原点、旋转和翻转方向。
3. fixture 测试断言精确 URL 门控、输入不可变、仅追加一条 `window_list` 记录。
4. 全量 `npm.cmd test` 通过。
5. `npm.cmd run build:3d` 通过。
6. 浏览器打开 `?fixture=1408#debug` 后模型加载完成、竖直站立、三面形成 U 型并与墙体方向一致。
7. 点击目标模型输出 `TypeId=1408`，控制台无 ContentLoader failure。
