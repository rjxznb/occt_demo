# CAD 3D/VR 全量内容模型加载设计

日期：2026-07-28

## 1. 背景与问题

当前 CAD 3D/VR 前端只从 `soft_list` 中提取对象，并在模板中固定使用 `ResList[0]`。随后仅查找 `parameterizedJsonUrl`，只有参数化资源能够进入 `modelUrlToObj -> OBJLoader` 管线。静态资源没有该字段，因此被静默跳过。

对 `Drawing2.json` 的审计结果是：`soft_list` 共 62 个实例、38 个唯一 TypeId，其中只有 10 个实例属于参数化资源；46 个实例对应静态资源，另有 6 个实例在当前模板中没有可用资源。现状必然造成大部分软装不显示。此外，至少 17 个软装实例按照 UE 的尺寸匹配规则不应选择 `ResList[0]`。

UE 参考实现位于 `D:\view3d`，主要依据如下：

- `FTemplateManager::CreateCadOfferMarkDatas` 确定需要加载商品模型的 CAD 内容类型。
- `MatchSizeWithStyleItemInfo` 和 `MatchSizeByRangeSize` 决定 TypeId 下具体使用哪个 ResId。
- `FContentItemManager` 的商品详情解析区分静态资源和参数化资源。
- `DownloadResourceByIDListInternal` 处理参数化模型依赖的 MX/PT 资源。Web 端不复刻 UE 本地 PAK/MX/PT 组装，而使用现有远程参数化转换服务生成 OBJ。

静态商品详情中的 `webV2Url` 虽然后缀为 `.kb`，文件内容实际是标准 GLB（文件头为 `glTF`），可以由 Three.js `GLTFLoader` 直接加载。该 CDN 响应允许跨域，因此无需把 GLB 二进制转成 Base64 经过 C++/JavaScript 桥传递。

## 2. 目标

- 按 UE 的内容识别和模板选择语义，加载 CAD 户型中的静态与参数化商品模型。
- 修复固定选择 `ResList[0]` 导致的资源型号错误。
- 保持模型竖直、平面旋转、上下/左右翻转、离地高度和 BasePoint/footprint 定位正确。
- 将 CAD 运行时的商品详情请求放在 C++ 桥中，不依赖 Node 进程。
- 保留 `occt_demo` 的独立 Demo 与现有 Node 开发方式。
- 门窗仍参与墙体开洞；真实门窗模型成功加载后替代其简化可见几何，失败时保留简化几何。
- 单个资源失败不影响房间、墙体和其他模型渲染，并提供可核对的汇总日志与点击调试信息。
- OCCT 源码、测试和规范可以提交；CAD 仓库只保留未提交的 C++ 与构建产物修改。

## 3. 非目标

- 不在 Web 端复刻 UE 的 PAK 挂载器或 MX/PT 本地材质组装流程。
- 不把所有名称以 `*_list` 结尾的字段都当作商品模型。房间、墙、柱、梁、烟道、管井等仍由现有几何管线生成。
- 不修改远程服务的 CORS 配置，也不关闭 WebView2 的 Web 安全策略。
- 不把 npm/Vite 源码、`node_modules` 或构建脚本迁入 CAD 仓库。
- 不创建自动部署脚本。
- 不删除、替换或弱化 `occt_demo` 独立 Demo。
- 不暂存、提交或推送 CAD 仓库中的任何文件。

## 4. 总体方案

采用“UE 语义 + Web 原生资源格式”的实现：

```text
CAD JSON
  -> 内容对象注册表（soft / door / window / radiator）
  -> 规范化 ContentModelInstance
  -> UE TypeId 映射与模板解析
  -> 按尺寸选择 ResId
  -> 批量商品详情请求（CAD: C++ bridge；Demo: Node transport）
  -> resource type 分流
       type=1 静态资源 -> webV2Url -> GLTFLoader
       type=8 参数化   -> parameterizedJsonUrl -> modelUrlToObj -> OBJLoader
  -> 统一坐标轴、缩放、锚点、旋转、翻转和离地放置
  -> 场景实例、调试元数据、结果汇总
```

实现由四个边界清晰的部分组成：

1. 内容解析：只把已注册的 CAD 列表转换成统一实例描述。
2. 模板解析：复现 UE 的 TypeId 映射和 ResId 尺寸选择。
3. 资源解析：批量取得商品详情并决定 GLB 或参数化 OBJ 管线。
4. 场景放置：对两种资源使用同一套 Z-up、平面变换和锚点规则。

## 5. 内容对象范围与规范化

### 5.1 显式注册表

首期与 UE `CreateCadOfferMarkDatas` 保持一致：

| CAD 字段 | 内容类别 | 商品模型 | 现有几何职责 |
| --- | --- | --- | --- |
| `soft_list` | `soft` | 是 | 无 |
| `door_list` | `door` | 是 | 门洞切割与失败占位 |
| `window_list` | `window` | 是 | 窗洞切割与失败占位 |
| `radiator_list` | `radiator` | 是 | 无 |

新增内容类型必须通过注册表明确加入解析函数和放置策略，不能仅凭字段名以 `_list` 结尾自动加载。这样可防止把结构、标注、房间轮廓等数据误发到商品接口。

### 5.2 `ContentModelInstance`

每个注册对象解析为不依赖 Three.js 的规范化描述：

```js
{
  instanceId,
  sourceList,
  sourceIndex,
  category,
  typeId,
  basePoint: { x, y, z },
  footprint: [{ x, y, z? }],
  size: { x, y, z },
  rotationDegrees,
  horizontalFlip,
  verticalFlip,
  outScale: { x, y, z },
  groundHeight,
  modelParams,
  rawBlockInnerInfo
}
```

解析规则：

- `BasePoint` 是块锚点，不假定它一定是模型中心。
- `Points` 保留世界坐标 footprint，用于尺寸、中心和锚点偏移计算。
- 旋转继续使用 `OutRotateRadian + BlockInnerInfo.旋转角度`；CAD 字段名虽为 Radian，当前数据实际为角度制。
- `BlockInnerInfo.左右翻转` 与 `BlockInnerInfo.上下翻转` 是俯视平面中的局部 X/Y 翻转；门窗历史字段只作为兼容回退。
- 参数值从 `BlockInnerInfo` 映射为现有远程转换服务所需的中文参数名。
- `离地高度` 与 BasePoint Z 分开保留，避免门窗、挂件和落地物体使用同一条错误的贴地规则。
- 无法解析 TypeId、BasePoint 或有效尺寸的对象记录为输入错误并跳过商品请求，但不终止整户渲染。

`json_parse.js` 继续生成现有 `door_list`/`window_list` 几何数据，同时新增统一的 `content_models`。旧 `SoftLists` 在过渡期保留给现有调用方，但模型加载器只消费 `content_models`，避免门窗对象因缺少 `kind`/`footprint` 再次被过滤掉。

## 6. 模板解析与 ResId 选择

### 6.1 模板条目

模板缓存不再保存单个 `resId`，而保存完整选择信息：

- `TypeId`、`TypeName`、`StyleItemType`
- `ResList`
- `SizeSampleModelMap`
- 每个资源的 `SizeRangeX`、`SizeRangeY`、`XMirror` 和 `Parameters`
- `ModelParamterMap`、`GroundDist`、`Height`、`IsTop`、`IsTable`

CAD 尺寸以毫米表示，模板模型尺寸按 UE 约定以厘米比较；只在选择层做明确的 mm -> cm 转换，场景坐标仍保持毫米。

### 6.2 TypeId 解析

将 UE 的以下逻辑移植为可单测的纯函数：

1. `ConvertTypeIDFromCadJsonToTemplate`：根据 CAD 类型和模型类别执行固定 TypeId 映射。
2. `ResolveTypeIdForTemplate`：当模板没有直接条目时执行 UE 的兼容/降级映射。
3. 异型窗和栏杆的拆分是 UE 几何能力，本期不在 Web 中复刻；这类对象没有可直接选择的标准条目时，保留现有程序化几何并明确记录 `UNSUPPORTED_CUSTOM_GEOMETRY`。

映射表必须来自 UE 源码，不凭当前 `Drawing2.json` 样例猜测或硬编码单个案例。

### 6.3 选择算法

按 UE `StyleItemType` 分流：

- 可移动模型、组合、灯具和硬装使用 `MatchSizeWithStyleItemInfo`：遍历非零 X/Y 样本，计算
  `max(rawX, sampleX) * max(rawY, sampleY) - min(rawX, sampleX) * min(rawY, sampleY)`，选择差值最小的 ResId。
- 柜体、台面和窗等参数/范围型条目使用 `MatchSizeByRangeSize`：以 `0.01` 的容差测试 X/Y 四个邻近点是否落入 `SizeRangeX`/`SizeRangeY`；多个命中时按模板稳定顺序选择第一个。
- 范围型条目无命中时按 UE 行为回退到模板中的第一个有效资源。
- 普通条目没有可比较尺寸但存在唯一有效资源时使用该资源。
- 没有有效资源时不发网络请求，并输出 `TEMPLATE_RESOURCE_MISSING`。

选择结果按“规范化 TypeId + CAD 平面尺寸”缓存，而不是只按 TypeId 缓存。同一 TypeId 的不同尺寸可能选择不同 ResId。

## 7. 商品详情与 C++ 桥

### 7.1 批量接口

CAD C++ 新增固定端点请求：

```text
GET https://biz-gateway.home.ke.com/
    utopia-render-platform/bim/pc/render/getResGoodsDetail
    ?resGoodsIdList=<comma-separated-res-ids>
```

桥方法命名为 `getContentGoodsDetails`，请求和结果格式为：

```json
{ "resIds": ["1961100", "2406734"] }
```

```json
{ "items": [/* upstream goods detail items */] }
```

约束：

- JavaScript 侧先去重；C++ 侧再次校验每个 ResId 只含允许字符。
- 每批最多 50 个 ResId，超过时由 JavaScript 客户端分批；C++ 对超限请求直接拒绝。
- 沿用现有异步、生命周期安全的 bridge 调度，网络请求不阻塞 CAD UI 线程。
- 继续启用 HTTPS 证书链和主机名校验，并使用 Windows native CA。
- 不允许调用方传入主机、路径或任意 URL。
- 响应设置合理的连接/总超时和最大正文限制。
- 日志只记录方法、批次大小、HTTP 状态、业务码、耗时和字节数；不记录签名资源 URL、Cookie 或响应正文。

现有 `getParametricGoodsDetail` 暂时保留，避免破坏已发布页面；新加载器统一使用批量方法。

### 7.2 Demo transport

统一 API 客户端新增 `getGoodsDetails(resIds)`：

- CAD 环境调用 `getContentGoodsDetails`。
- 独立 Demo 环境复用现有 Node `getGoodsDetail` 路由并受控并发请求，归一化为相同的 `items` 结构。

因此不要求改造或删除外部 Node Demo 后端，CAD 运行时仍完全不依赖 Node。

## 8. 资源类型解析

商品详情解析器为每个 ResId 生成统一的 `ResolvedModelResource`：

```js
{
  resId,
  kind: 'static-glb' | 'parametric-obj',
  sourceUrl,
  contentHash,
  modelType,
  resourceType,
  rawSummary
}
```

解析规则：

- `resourceList[].type === 1`：静态模型。优先选非空 `webV2Url`，使用对应 MD5 作为版本键；不使用 UE 的 `url427`、`pcLow532Url` 或 ZIP/Pak URL。
- `resourceList[].type === 8`：参数化模型。提取 `parameterizedJsonUrl`，继续调用现有 `modelUrlToObj`。
- 同一详情含多个资源时，先按明确的资源 type 选择；同类多个候选按响应稳定顺序选择第一个字段完整的条目，并记录候选数量。
- 缺少可用 URL 时产生 `RESOURCE_URL_MISSING`，不把静态 URL错误地发送给参数化转换接口。
- 未知 resource type 产生 `UNSUPPORTED_RESOURCE_TYPE`，不尝试猜测格式。

## 9. Three.js 加载与缓存

### 9.1 静态模型

- 使用 `GLTFLoader` 直接请求 `webV2Url` 指向的 `.kb`/GLB。
- 对 GLTF scene 做深克隆后再用于实例放置，避免多个实例共享可变变换。
- 保留 GLB 自带材质和纹理，设置阴影属性；只有材质缺失时才使用统一回退材质。
- 缓存键为 `static:<resId>:<webV2Md5>`。
- 下载中请求按缓存键去重。

### 9.2 参数化模型

- 使用 `parameterizedJsonUrl -> modelUrlToObj -> OBJLoader` 的现有流程。
- 缓存键为 `parametric:<resId>:<contentHash>:<normalizedParameters>`。
- 参数排序和数值规范化后再生成键，避免仅因属性顺序不同导致重复转换。
- 继续支持普通 JSON 与 zstd-base64 响应。

模型原型缓存只保存未放置的资源根节点；场景中的每个 CAD 对象都使用独立克隆和独立调试信息。

## 10. 统一坐标、缩放与放置

两种模型都经过同一放置阶段，顺序固定为：

1. 将 GLTF/OBJ 的 Y-up 转换为户型场景的 Z-up。
2. 在轴转换后计算模型包围盒。
3. 将资源单位归一化到场景毫米。
4. 根据所选模板资源的参考 X/Y/Z 与 CAD 实例尺寸计算目标缩放；静态模型至少匹配 CAD footprint 的平面尺寸，参数化模型以转换结果为主，仅做明确的单位归一化。
5. 计算模型包围盒底面和 footprint 中心相对于 `BasePoint` 的局部偏移。
6. 在模型局部 XY 平面执行左右/上下翻转。
7. 绕世界 Z 轴应用 CAD 平面旋转。
8. 平移到 BasePoint，并应用 BasePoint Z、`离地高度`/模板 `GroundDist` 的类别策略。

矩阵语义为 `T * Rz * Sflip * Ssize * YupToZup`。翻转发生在旋转之前的模型局部平面，因此在俯视图中与 CAD 表现一致。

定位不直接把模型中心强制设为 BasePoint。目标中心来自 footprint；通过逆平面变换求出目标在块局部坐标中的位置，再减去轴转换和缩放后的模型包围盒中心。Z 方向使用模型底面贴合目标离地平面。此规则延续已修复的 BasePoint/footprint 锚点语义。

对缩放或包围盒做以下防护：

- 包围盒为空、含非有限值或任一关键尺寸接近零时拒绝放置。
- 不再使用“最大尺寸小于 100 就乘 1000”作为唯一判断；优先使用模板参考尺寸推导单位比例。
- 目标尺寸缺失时采用模板参考尺寸；二者都缺失时记录 `MODEL_SIZE_UNRESOLVED`。
- 负缩放模型使用 DoubleSide 或等价材质处理，避免翻转后消失。

## 11. 门窗几何兼容

门窗有两类职责，必须解耦：

- 开洞数据始终保留，用于墙体布尔切割和边界计算。
- 简化门窗网格作为异步加载期间和加载失败时的可见回退。

每个简化网格通过 `sourceList + sourceIndex` 与 `ContentModelInstance` 对应。真实商品模型成功放置后，只隐藏对应简化可见网格，不删除开洞数据；加载失败或资源不支持时继续显示简化网格。这样不会出现双重门窗，也不会因商品服务失败导致墙洞消失。

## 12. 调试信息与日志

所有成功放置的模型根节点与子 Mesh 都携带统一 `userData`：

- `contentModelRoot`
- `instanceId`、`sourceList`、`sourceIndex`、`category`
- 原始 TypeId、映射后 TypeId、TypeName
- 选中的 ResId、选择算法和参与比较的 CAD/模板尺寸
- `resourceKind`、`resourceType`、`modelType`、内容哈希
- BasePoint、footprint、参数、旋转、翻转、缩放、离地高度
- 原始/归一化/世界包围盒与最终世界位置

`#debug` 模式下点击任一模型输出这一份结构化快照。日志不得输出完整 `webV2Url`、`parameterizedJsonUrl` 或其他签名 URL。

每次加载结束输出一条统一汇总：

```text
instances / selected / detailsResolved / staticLoaded / parametricLoaded /
fallbackVisible / skipped / failed
```

跳过和失败按错误码聚合，并可展开到 TypeId、ResId、sourceList、sourceIndex，便于核对“哪些模型没有渲染”。

## 13. 错误处理

新增或复用以下错误码：

- `CONTENT_INPUT_INVALID`
- `TEMPLATE_TYPE_NOT_FOUND`
- `TEMPLATE_RESOURCE_MISSING`
- `UNSUPPORTED_CUSTOM_GEOMETRY`
- `RESOURCE_DETAIL_MISSING`
- `RESOURCE_URL_MISSING`
- `UNSUPPORTED_RESOURCE_TYPE`
- `STATIC_MODEL_LOAD_FAILED`
- `PARAMETRIC_CONVERSION_FAILED`
- `MODEL_PARSE_FAILED`
- `MODEL_SIZE_UNRESOLVED`
- 现有 `INVALID_ARGUMENT`、`NETWORK_ERROR`、`HTTP_ERROR`、`RESPONSE_TOO_LARGE`、`INVALID_RESPONSE`、`TIMEOUT`、`CANCELLED`

错误隔离粒度为单个 ResId 或实例。批次请求失败时，可对该批执行有限次数的受控重试；仍失败则标记该批资源失败，不中断其余批次和主体户型。页面关闭后继续沿用现有 bridge cancellation/dispatch drain 规则，禁止回调已销毁 WebView。

## 14. 代码组织

建议的前端边界：

- `src/utils/json_parse.js`：生成现有几何数据与新增 `content_models`。
- `src/components/ContentModelRegistry.js`：内容字段注册和规范化。
- `src/components/ContentTemplateResolver.js`：TypeId 映射、模板解析、尺寸选择。
- `src/services/ContentResourceApiClient.js`：批量商品详情与参数转换传输门面。
- `src/components/ContentModelLoader.js`：资源分流、GLTF/OBJ 原型缓存、实例放置和汇总。
- `src/components/ParametricModelLoader.js`：过渡期只保留兼容导出或复用的纯变换函数，避免现有测试和调用方一次性断裂。
- `src/components/RoomRenderer.js`：调用统一加载器并管理门窗回退可见性。

建议的 CAD C++ 边界：

- 扩展 `common/Net/k_parametric_api_client.h/.cpp`：增加固定批量商品详情方法；网络、安全和大小限制仍集中在该层。
- 扩展 `ui/window/bridge/k_parametric_model_bridge.h/.cpp`：注册 `getContentGoodsDetails`、校验参数并映射统一响应。
- 扩展 renderer 顶层 `render_preview.js` 的原生方法白名单。
- 必要的新 C++ 文件必须登记到 `KeCADPlugin.vcxproj` 与 `.filters`；若只扩展现有文件则不新增项目条目。

命名中的 `Parametric` 可在后续独立重构中统一为 `ContentResource`；本次优先保持 C++ 既有生命周期实现稳定，不做与功能无关的大范围重命名。

## 15. 测试与验证

### 15.1 自动测试

先写失败测试，再实现功能。至少覆盖：

- 注册表只收集 soft、door、window、radiator，不自动收集任意 `*_list`。
- 四类对象都生成完整 `ContentModelInstance`，门窗仍保留开洞数据。
- UE TypeId 映射的代表性分支。
- 最近尺寸算法、范围算法、容差、稳定回退和 mm/cm 转换。
- 同一 TypeId 不同尺寸可选择不同 ResId；`Drawing2.json` 的已知多候选案例不再固定选第一项。
- CAD 批量请求分批、去重、最大 50 项、响应归一化和错误传播。
- Demo transport 复用逐项 Node 请求并返回相同结构。
- type 1 只选择 `webV2Url` 并进入 GLTF 管线。
- type 8 只选择 `parameterizedJsonUrl` 并进入参数化 OBJ 管线。
- 静态 URL 不会被发送到 `modelUrlToObj`。
- Y-up -> Z-up、T/R/flip 顺序、BasePoint/footprint 锚点和离地高度。
- 静态/参数原型缓存键、飞行请求去重和实例独立克隆。
- 真实门窗成功时隐藏对应回退，失败时保留回退。
- 点击调试信息包含 source、TypeId、ResId、resourceKind 与最终世界包围盒，且不含签名 URL。
- C++ 源码契约：固定 HTTPS 端点、native CA、证书校验、50 项限制、异步 bridge 和日志脱敏。

### 15.2 构建验证

- `npm test`
- `npm run build:3d`
- 如 VR 入口共享相关代码，执行对应 VR 构建。
- CAD Debug x64 和 Release x64 重新生成。
- 确认 PostBuild 后实际加载的 ARX 与生成文件哈希一致。

### 15.3 实际户型验收

使用 `Drawing2.json` 在 CAD WebView 中检查：

1. Node 后端未启动时，静态与参数化资源都能加载。
2. 软装数量明显高于当前只有 10 个参数化实例的结果；汇总能解释每一个未加载实例。
3. 所有模型竖直，不倒在地面。
4. 模型平面位置与 CAD footprint、BasePoint 对齐，旋转和上下/左右翻转正确。
5. 门窗模型与洞口对应，不出现简化模型和真实模型重叠。
6. 点击模型输出完整但不泄露签名 URL 的调试信息。
7. 商品服务断网、超时或部分资源无效时，房间和墙体仍显示，门窗回退仍可见，CAD UI 保持可操作。
8. 关闭并重新打开预览无崩溃、悬空回调或残留网络结果。

## 16. 构建产物与版本控制

规范源、前端源和测试只在：

```text
D:\occt_demo\.worktrees\cad-renderer-parametric-bridge
```

完成构建后手工替换 CAD 仓库中的 3D/VR 静态产物，并按 CAD 既有发布方式复制到实际读取缓存：

```text
C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer
C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer
```

不创建同步脚本。CAD 仓库开始和结束时都记录 `git status --short`；保留用户原有 `README.md` 修改，不执行 `git add`、`git commit`、`git push` 或 PR 操作。

## 17. 完成标准

同时满足以下条件才算完成：

1. 内容范围、TypeId 映射和 ResId 选择与上述 UE 语义一致。
2. 静态 type 1 资源通过 `webV2Url`/GLTFLoader 显示，参数化 type 8 资源继续通过 OBJ 管线显示。
3. `Drawing2.json` 中所有可解析、模板存在且上游资源有效的注册内容实例都被放置；其余实例有明确错误码。
4. 模型方向、位置、尺寸、旋转、翻转和离地高度通过实际 CAD WebView 验收。
5. 门窗真实模型与程序化开洞/回退协同正确。
6. CAD 不依赖 Node；独立 Demo 仍可沿用 Node 后端。
7. 自动测试、前端构建、CAD Debug/Release x64 构建通过。
8. 最新产物已手工同步到 CAD renderer 和实际运行缓存。
9. CAD 项目未产生任何新提交、暂存或推送，用户原有改动未被覆盖。
