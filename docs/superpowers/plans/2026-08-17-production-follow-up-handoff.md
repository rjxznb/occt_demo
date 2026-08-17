# 3D 预览、全景看房与局部示意图后续上线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不回退现有模型渲染能力、不修改 2D 彩平图的前提下，补齐全景离线渲染、完整点位管理、AI 真实链路验收、结果相册与偏好记录、CAD WebView 安全传输及正式发布验证。

**Architecture:** `occt_demo` 继续作为 3D 鸟瞰图、全景看房和局部示意图三个 Web 页面唯一源码仓库；所有业务逻辑先在 OCCT 中以纯模块和测试实现，再构建并复制到 CAD。浏览器端不得保存 OpenAI 密钥；外部任务通过可替换 transport 接口接入，独立支持本地 Node 开发模式和 CAD 原生桥接模式。CAD 项目只作为集成目标，不在本计划中提交、合并或推送。

**Tech Stack:** JavaScript ES Modules、Three.js 0.178、Vite 6、Node.js `node:test`、Node HTTP 服务、OpenAI Images API、AutoCAD 2021 WebView2、C++ 原生桥接、Windows 本地资源缓存。

## Global Constraints

- OCCT 工作目录固定为 `D:/occt_demo/.worktrees/panorama-white-model-page`，当前分支为 `codex/panorama-white-model-page`。
- 不要在 `D:/occt_demo` 主检出目录直接开发本计划；该目录当前属于 `feat/parametric-3d-models`。
- 当前源码 HEAD 为 `1cede4c`；开始新任务前先确认工作树干净。
- 当前分支 upstream 错误地指向 `origin/codex/ue-typeid-rendering`。在任何 push 或 PR 前必须先显式设置正确 upstream，禁止直接执行无参数 `git push`。
- 不修改 CAD 的 `renderer/cartoon/**`、2D 彩平入口或 2D 业务逻辑。
- 不提交、暂存、合并或推送 `C:/Users/User/Desktop/cad_plugin`；CAD 中已有多人未提交改动，必须保留。
- OCCT 是源码真源；禁止直接在 CAD 构建产物中修业务逻辑。
- 每次迁移前运行完整测试和 `npm.cmd run build:3d`，只复制验证过的 `dist-3d`。
- CAD 源资源目标为 `C:/Users/User/Desktop/cad_plugin/build_resource/PluginResource/html/renderer`。
- CAD 运行缓存目标为 `C:/Users/User/AppData/Local/ke_arx_cache/2021/PluginResource/html/renderer`。
- 三个页面目录分别为 `preview3d`、`preview-panorama`、`preview-ai-concept`；旧 `preview-vr` 保留作回滚，不作为当前入口。
- 禁止将 `OPENAI_API_KEY`、Bearer Token、压缩包密码、用户隐私数据或绝对运行路径写入前端、构建产物、日志或 Git。
- 不允许把演示假流程当作正式功能；没有真实外部接口时必须显示明确的“未配置/不可提交”状态。
- 所有新功能必须先写失败测试，确认 RED，再写最小实现，确认 GREEN，最后运行完整回归。

---

## 1. 当前状态快照（接手 Agent 先读）

### 1.1 已完成，不要重复实现

- 所有 `*_list` 内容统一发现、静态/参数化资源分类、模板 ResId 解析及模型加载。
- 软装位置、旋转、水平/垂直翻转、BasePoint 与俯视坐标转换。
- UE 对应的特殊 TypeId 尺寸和摆放规则，包括角窗、U 型窗、弧窗、异形窗、特殊门窗与栏杆。
- Web 模型包、Zstd 解包、PT 材质路由、玻璃透明和白模材质切换。
- 3D 鸟瞰图相机控制、Liquid Glass 右侧 UI、模型点击 Debug 和房间信息切换。
- 白模全景页面：预设点位、右上角小地图、热点、平滑切换、WASD 点位导航、位置微调、高度调整、合法性校验、进入视角、吊顶与真实窗外小区背景。
- 局部示意图页面：全房间候选视角、缩略图、小地图、自动/自定义视角、微调、删除确认、生图条件、多风格参考图、环境组合和 24 张上限。
- AI 本地 Node 主链路：白模输入截图、任务 API、文件持久化、并发队列、重试、取消、恢复、OpenAI `gpt-image-2` 图片编辑客户端、进度卡片和同源静态服务。
- CAD 四页面入口：保留原 2D；`3D 鸟瞰图`、`全景看房`、`局部示意图` 已迁移；旧 VR 目录保留但不再作为入口。
- 真实 2:1 小区全景背景仅在固定全景点位启用，普通 3D 鸟瞰状态保持原背景；加载失败有程序化背景兜底。

### 1.2 最近一次验证基线

- `npm.cmd test`：492 tests，483 pass，0 fail，9 skip（跳过项依赖 CAD 路径环境变量）。
- `npm.cmd run build:3d`：成功。
- `CAD_PLUGIN_ROOT=... node --test tests/cad-render-preview-shell.test.js`：1 pass，0 fail。
- 当前 OCCT 工作树在 `1cede4c` 时为干净状态。
- 外景图片 SHA-256：`D63B4814B04663DD61185625409A421FFFC610BB78193D51ED1B45141B4436A3`。

### 1.3 明确未完成

| 优先级 | 能力 | 当前事实 | 完成定义 |
|---|---|---|---|
| P0 | 全景离线渲染任务 | “提交渲染”按钮没有 click handler、client、job store 或结果页 | 能提交真实任务、查看逐点状态、恢复、取消、失败点重试和查看结果 |
| P0 | CAD 中的 AI 安全传输 | AI 页面只调用同源 `/api/ai-concept`；复制到静态 WebView 后没有该 Node API | CAD 中通过受控原生桥或公司服务完成相同固定接口，密钥不进入浏览器 |
| P0 | AI 真实 API 验收 | 单元测试和假 client 齐全，但没有受环境变量保护的真实单图 smoke test | 使用一个真实白模输入生成一张图并人工确认结构、视角和风格 |
| P1 | 全景点位完整管理 UI | Store 已有 rename/delete/restorePoint，页面只接了新增、恢复全部、设为进入视角 | 能查看信息、重命名、确认删除、单点恢复及渲染状态 |
| P1 | AI 正式结果相册 | 当前是任务进度网格和并排输入/输出，不是完整相册 | 支持筛选、上一张/下一张、缩略图、方向示意标识和历史版本 |
| P1 | AI 偏好确认 | 没有保留/排除/客户偏好/备注的数据模型和 UI | 多图可形成偏好记录并稳定关联方案、房间、视角、风格、环境 |
| P1 | 项目级持久化与版本冲突 | 点位草稿和条件主要在 LocalStorage；任务在本地 runtime | 与 CAD 方案 ID/版本稳定关联，能识别过期结果和版本冲突 |
| P2 | CAD 正式构建与发布验收 | Web 资源已复制，尚需团队环境内 VS Debug/Release 与真实 CAD 流程验收 | VS 构建、缓存加载、三页面全链路、重启恢复和错误场景全部通过 |
| P2 | 构建产物清理策略 | CAD 目录累计多个 Vite 哈希 bundle；此前按要求未删除 | 有安全的 manifest 驱动替换流程，绝不波及 `cartoon` 和多人文件 |

### 1.4 外部阻塞项，不允许接手 Agent 猜测

1. 离线全景渲染服务的正式 endpoint、鉴权、任务 payload、轮询和结果 schema 未出现在仓库中。取得接口文档前只能完成 transport 抽象、校验、UI 和 fake transport 测试，不能伪造“已接通”。
2. CAD 最终如何获得 AI 调用凭据尚未定稿。产品级共享 OpenAI 密钥不能打包进客户端。可接受方向只有：公司受控服务；或用户自带密钥并存入 Windows Credential Manager，由 C++ 读取。需要产品/安全负责人选择。
3. 方案创建人、项目持久化和历史结果的正式宿主接口未提供。LocalStorage 只能继续作为草稿降级方案，不能宣称已满足多人/跨机器保存。

---

## Task 1: 补齐全景点位管理 UI

**Files:**
- Modify: `src/panorama/PanoramaMiniMap.js`
- Modify: `src/panorama/panorama.css`
- Modify: `src/PanoramaApp.js`
- Modify: `index-panorama.html`
- Test: `tests/panorama-minimap.test.js`
- Test: `tests/panorama-app-state.test.js`
- Test: `tests/panorama-page-contract.test.js`

**Interfaces:**
- Consumes: `PanoramaPointStore.renamePoint(id, name)`, `deletePoint(id)`, `restorePoint(id)`, `restoreAll()`。
- Produces: `PanoramaMiniMap` callbacks `onRename(id, name)`, `onDelete(id)`, `onRestore(id)`；`PanoramaApp.renamePoint`, `deletePoint`, `restorePoint`。

- [ ] **Step 1: 写失败测试，锁定点位菜单和确认行为**

```js
test('active panorama point exposes rename delete and single restore actions', () => {
  const actions = [];
  const map = new PanoramaMiniMap(container, {
    documentRef,
    onRename: (id, name) => actions.push(['rename', id, name]),
    onDelete: id => actions.push(['delete', id]),
    onRestore: id => actions.push(['restore', id]),
  });
  map.render({ roomPoints: ROOM_POINTS, points: POINTS, activePointId: 'camera:a' });
  assert.ok(findByDataset(container, 'action', 'rename-point'));
  assert.ok(findByDataset(container, 'action', 'delete-point'));
});
```

同时添加 App 测试：取消确认不能调用 Store；确认删除后 active point 回退到剩余合法点；重命名为空或超过 40 字符时不保存。

- [ ] **Step 2: 运行并确认 RED**

Run:

```powershell
node --test tests/panorama-minimap.test.js tests/panorama-app-state.test.js tests/panorama-page-contract.test.js
```

Expected: FAIL，原因是 callbacks、菜单与 App 方法尚不存在。

- [ ] **Step 3: 实现最小点位管理面板**

要求：

- 小地图中选中点位后显示名称、房间、XYZ、高度、是否初始视角、是否已修改。
- 重命名使用受控输入框，trim 后长度为 1–40；禁止用 `innerHTML`。
- 删除必须使用现有 UI 风格的确认对话框；禁止直接使用无上下文的 `window.confirm` 作为最终产品 UI。
- 原始 CAD 点位删除后可“恢复该点”；自定义点位删除后从草稿移除。
- 删除当前进入视角时，Store 选择剩余第一个合法点作为 entry point。
- 正在编辑点位时禁用删除、恢复和提交渲染。

- [ ] **Step 4: 运行 focused tests 并确认 GREEN**

Run: 与 Step 2 相同。Expected: PASS。

- [ ] **Step 5: 运行完整回归并提交 OCCT**

```powershell
npm.cmd test
git add src/panorama/PanoramaMiniMap.js src/panorama/panorama.css src/PanoramaApp.js index-panorama.html tests/panorama-minimap.test.js tests/panorama-app-state.test.js tests/panorama-page-contract.test.js
git commit -m "feat: complete panorama point management"
```

---

## Task 2: 建立全景离线渲染领域模型和固定 Transport

**Files:**
- Create: `src/panorama/PanoramaRenderJobModel.js`
- Create: `src/panorama/PanoramaRenderClient.js`
- Create: `src/panorama/PanoramaRenderJobStore.js`
- Create: `tests/panorama-render-job-model.test.js`
- Create: `tests/panorama-render-client.test.js`
- Create: `tests/panorama-render-job-store.test.js`

**Interfaces:**
- Produces: `validatePanoramaRenderRequest(input)`, `PanoramaRenderClient`, `PanoramaRenderJobStore`。
- Status enum: `queued | rendering | completed | partial | failed | cancelled`。
- Point status enum: `queued | rendering | completed | failed | cancelled`。

- [ ] **Step 1: 写领域模型失败测试**

请求必须只包含：

```js
{
  requestId: 'stable-idempotency-id',
  planId: 'plan-1',
  version: 'version-1',
  sceneFingerprint: 'sha256-or-stable-fingerprint',
  entryPointId: 'camera:a',
  points: [{
    id: 'camera:a', roomId: 'room:living', roomName: '客厅',
    x: 1000, y: 2000, z: 1500, yaw: 0, pitch: 0, horizontalFov: 78,
  }],
}
```

测试必须拒绝空点位、重复 ID、非法数值、非法房间、缺少 entry point、超过 64 个点位和未知字段。幂等键必须由 plan/version/sceneFingerprint/全部标准化点位稳定生成。

- [ ] **Step 2: 写 client 和 store 失败测试**

`PanoramaRenderClient` 只能调用以下固定相对路径，禁止任意 URL：

```text
POST /api/panorama-render/jobs
GET  /api/panorama-render/jobs/:jobId
POST /api/panorama-render/jobs/:jobId/cancel
POST /api/panorama-render/jobs/:jobId/retry
```

`PanoramaRenderJobStore` 每 2 秒轮询；切换 job 时丢弃旧响应；页面销毁时 abort；部分完成立即暴露结果；网络错误保留上次稳定 job。

- [ ] **Step 3: 运行并确认 RED**

```powershell
node --test tests/panorama-render-job-model.test.js tests/panorama-render-client.test.js tests/panorama-render-job-store.test.js
```

- [ ] **Step 4: 实现纯模块，错误只返回安全 code**

允许的前端错误 code：`INVALID_REQUEST`、`NO_VALID_POINTS`、`VERSION_CONFLICT`、`NETWORK_ERROR`、`INVALID_RESPONSE`、`RENDER_NOT_CONFIGURED`、`REQUEST_FAILED`。不得把服务端响应正文、URL、Token 或绝对路径拼入 Error message。

- [ ] **Step 5: 运行 focused tests、完整测试并提交**

```powershell
node --test tests/panorama-render-job-model.test.js tests/panorama-render-client.test.js tests/panorama-render-job-store.test.js
npm.cmd test
git add src/panorama/PanoramaRenderJobModel.js src/panorama/PanoramaRenderClient.js src/panorama/PanoramaRenderJobStore.js tests/panorama-render-job-model.test.js tests/panorama-render-client.test.js tests/panorama-render-job-store.test.js
git commit -m "feat: define panorama render jobs"
```

---

## Task 3: 接入全景提交、进度、结果和恢复 UI

**Files:**
- Create: `src/panorama/PanoramaRenderProgress.js`
- Modify: `src/PanoramaApp.js`
- Modify: `src/panorama/panorama.css`
- Modify: `index-panorama.html`
- Test: `tests/panorama-render-progress.test.js`
- Test: `tests/panorama-app-state.test.js`
- Test: `tests/panorama-page-contract.test.js`

**Interfaces:**
- Consumes: Task 2 的 client/store/model。
- Produces: `PanoramaApp.submitRender()`, `cancelRender()`, `retryRenderPoint(pointId)`。

- [ ] **Step 1: 写失败测试，证明当前按钮确实没有业务处理**

断言：点击 `panorama-submit-render` 后会先重新校验全部点位、确认当前预览未过期、弹出摘要确认，然后只创建一次任务；编辑模式、无合法点位、场景未完成或 preview dirty 时禁止提交。

- [ ] **Step 2: 写进度和恢复失败测试**

要求：

- 总体状态和每个点位状态都显示。
- 完成点位可立刻打开全景结果，不等待其他点位。
- 单个失败点位可重试，取消只影响未完成点位。
- active job ID 按 plan/version 隔离保存；刷新后恢复轮询。
- 方案版本变化时旧任务标记“历史版本”，不得覆盖当前结果。

- [ ] **Step 3: 运行并确认 RED**

```powershell
node --test tests/panorama-render-progress.test.js tests/panorama-app-state.test.js tests/panorama-page-contract.test.js
```

- [ ] **Step 4: 实现 UI 状态机**

新增 phase 不要复用编辑 phase：`ready | confirming-render | rendering | render-results | error`。结果 URL 只能来自 transport 返回的受控 asset URL；前端不得接收绝对文件路径。

- [ ] **Step 5: 使用 fake transport 完成离线端到端测试**

创建 `tests/panorama-render-flow.test.js`，使用真实 `PanoramaApp` harness + fake transport，覆盖 queued → rendering → partial → completed、单点失败重试、取消、刷新恢复和版本冲突。

- [ ] **Step 6: focused/full 验证并提交**

```powershell
node --test tests/panorama-render-progress.test.js tests/panorama-render-flow.test.js tests/panorama-app-state.test.js tests/panorama-page-contract.test.js
npm.cmd test
npm.cmd run build:3d
git add src/panorama/PanoramaRenderProgress.js src/PanoramaApp.js src/panorama/panorama.css index-panorama.html tests/panorama-render-progress.test.js tests/panorama-render-flow.test.js tests/panorama-app-state.test.js tests/panorama-page-contract.test.js
git commit -m "feat: submit and track panorama rendering"
```

---

## Task 4: 接真实离线全景渲染服务（取得接口文档后执行）

**Files:**
- Create or Modify: 服务适配器文件，优先放在 `src/panorama/transports/`。
- Create: 对应 adapter contract test。
- Modify: `src/PanoramaApp.js` 的 transport factory 注入点。

**Interfaces:**
- Adapter 必须实现 Task 2 的四个固定操作，不得把上游任意 URL 暴露给页面。

- [ ] **Step 1: 把正式接口文档逐字段映射到内部模型**

形成一张明确映射表：内部字段、上游字段、单位、是否必填、枚举、错误 code、幂等策略、结果资源获取方式。任何未定义字段都必须在编码前向接口提供方确认。

- [ ] **Step 2: 用录制后脱敏的 fixture 写失败 contract tests**

fixture 不得包含 Token、Cookie、真实用户 ID、签名 URL query 或绝对路径。

- [ ] **Step 3: 实现 adapter 与安全错误归一化**

上游 auth/quota/timeout/version/not-found 错误分别归一化为固定 code。重试只允许幂等 GET 或明确可重试的失败点；POST 创建必须携带稳定 requestId。

- [ ] **Step 4: 测试环境完成一个点位真实 smoke**

必须取得任务 ID、状态变化、最终 360 结果，并验证结果与 point ID、plan/version 一致。无正式接口时本任务保持未完成，UI 显示 `RENDER_NOT_CONFIGURED`。

- [ ] **Step 5: 提交仅包含 OCCT adapter 和测试**

禁止在该提交中修改 CAD 源码或资源。

---

## Task 5: 完成 AI 真实单图 Smoke、运维文档和错误恢复

**Files:**
- Create: `tests/ai-concept-generation-flow.test.js`
- Create: `tests/ai-concept-openai-smoke.test.js`
- Create: `docs/ai-concept-generation-operations.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `server/ai-concept-server.mjs`, `OpenAiImageClient`, `AiGenerationQueue`, `AiGenerationClient`。

- [ ] **Step 1: 写离线端到端测试**

真实 API handler + fake image client，提交 `1 view × 1 style × 1 environment`，断言任务从 queued 到 completed，输入/输出 asset 可读，plan/version/room/view/style/environment 全部可追踪。

- [ ] **Step 2: 写受双环境变量保护的真实 smoke test**

只有同时存在 `OPENAI_API_KEY` 和 `RUN_OPENAI_IMAGE_SMOKE=1` 才执行；否则必须 `SKIP`。测试只提交一张已存在白模图、`modern-minimalist` 和 `sunny-day`，避免批量消耗。

- [ ] **Step 3: 运行离线测试并确认 GREEN**

```powershell
node --test tests/ai-concept-generation-flow.test.js tests/ai-concept-openai-smoke.test.js
```

Expected: 离线测试 PASS，真实 smoke 默认 SKIP。

- [ ] **Step 4: 在用户本机显式授权后运行一次真实 smoke**

```powershell
$env:RUN_OPENAI_IMAGE_SMOKE='1'
node --test tests/ai-concept-openai-smoke.test.js
```

人工验收：相机透视和门窗/墙体主要结构不变；风格和光照生效；输出不是法线图、纯色图或损坏文件。

- [ ] **Step 5: 写运维文档**

必须覆盖密钥配置、端口、并发、任务目录、auth/quota/policy/timeout/interrupted 错误、重试/取消/重启恢复、安全清理，以及“方向示意图不是最终交付效果图”。

- [ ] **Step 6: 完整验证并提交**

```powershell
npm.cmd test
npm.cmd run build:3d
git add tests/ai-concept-generation-flow.test.js tests/ai-concept-openai-smoke.test.js docs/ai-concept-generation-operations.md README.md
git commit -m "test: verify real AI concept generation"
```

---

## Task 6: 将 AI 进度页升级为结果相册和白模对比

**Files:**
- Create: `src/ai-concept/AiResultGallery.js`
- Create: `src/ai-concept/AiResultModel.js`
- Modify: `src/ai-concept/AiGenerationProgress.js`
- Modify: `src/ai-concept/ai-concept.css`
- Modify: `src/AiConceptApp.js`
- Modify: `index-ai-concept.html`
- Test: `tests/ai-result-model.test.js`
- Test: `tests/ai-result-gallery.test.js`
- Test: `tests/ai-concept-app-state.test.js`

**Interfaces:**
- Produces: `normalizeAiResults(job)`, `AiResultGallery.render({ results, activeId, filters })`。

- [ ] **Step 1: 写结果模型失败测试**

每个结果必须包含稳定的 job/item/plan/version/room/view/style/environment/input/output 关联。旧版本结果保留但标记 `historical: true`；无法与白模对应的结果标记 `comparisonAvailable: false`。

- [ ] **Step 2: 写相册交互失败测试**

覆盖：房间/视角/风格/环境筛选、缩略图、上一张/下一张、AI 主图与对应白模切换、已完成结果即时出现、失败卡单独重试、明确“方向示意图”水印。

- [ ] **Step 3: 运行并确认 RED**

```powershell
node --test tests/ai-result-model.test.js tests/ai-result-gallery.test.js tests/ai-concept-app-state.test.js
```

- [ ] **Step 4: 实现相册，保留现有队列能力**

`AiGenerationProgress` 继续负责非终态进度；完成项交给 `AiResultGallery`。不能为了相册重写任务队列或丢失 retry/cancel/recovery。

- [ ] **Step 5: 验证、浏览器 QA、提交**

```powershell
node --test tests/ai-result-model.test.js tests/ai-result-gallery.test.js tests/ai-generation-progress.test.js tests/ai-concept-app-state.test.js
npm.cmd test
npm.cmd run build:3d
git add src/ai-concept/AiResultGallery.js src/ai-concept/AiResultModel.js src/ai-concept/AiGenerationProgress.js src/ai-concept/ai-concept.css src/AiConceptApp.js index-ai-concept.html tests/ai-result-model.test.js tests/ai-result-gallery.test.js tests/ai-concept-app-state.test.js
git commit -m "feat: add AI result gallery"
```

---

## Task 7: 添加客户偏好记录和历史版本关联

**Files:**
- Create: `src/ai-concept/AiPreferenceModel.js`
- Create: `src/ai-concept/AiPreferenceRepository.js`
- Create: `src/ai-concept/AiPreferencePanel.js`
- Modify: `src/ai-concept/AiResultGallery.js`
- Modify: `src/AiConceptApp.js`
- Test: `tests/ai-preference-model.test.js`
- Test: `tests/ai-preference-repository.test.js`
- Test: `tests/ai-preference-panel.test.js`

**Interfaces:**
- Result disposition: `unreviewed | kept | rejected | preferred`。
- Preference record contains `planId`, `version`, `resultIds[]`, `styleIds[]`, `environmentIds[]`, `roomIds[]`, `viewIds[]`, `colorNotes`, `comment`, `createdAt`, `updatedAt`。

- [ ] **Step 1: 写模型和仓储失败测试**

测试多结果形成一组偏好；不同 plan/version 严格隔离；版本变更后旧偏好只读；损坏存储备份并返回安全错误；备注 trim 后最大 1000 字符。

- [ ] **Step 2: 写 UI 失败测试**

结果可标记保留、排除或客户偏好；偏好面板允许多选结果、填写颜色倾向和备注；不能强制客户只选一张。

- [ ] **Step 3: 运行 RED、实现 LocalStorage 降级仓储并运行 GREEN**

LocalStorage schema 必须带版本号，key 同时包含 planId/version。该仓储只作为客户端降级，不宣称多人共享。

- [ ] **Step 4: 预留正式项目仓储接口**

定义 `load(context)`, `save(context, record)`, `listHistory(planId)` 三个方法；未来 CAD/服务 adapter 不修改 UI。

- [ ] **Step 5: 完整验证并提交**

```powershell
node --test tests/ai-preference-model.test.js tests/ai-preference-repository.test.js tests/ai-preference-panel.test.js
npm.cmd test
git add src/ai-concept/AiPreferenceModel.js src/ai-concept/AiPreferenceRepository.js src/ai-concept/AiPreferencePanel.js src/ai-concept/AiResultGallery.js src/AiConceptApp.js tests/ai-preference-model.test.js tests/ai-preference-repository.test.js tests/ai-preference-panel.test.js
git commit -m "feat: record AI design preferences"
```

---

## Task 8: 解决 CAD WebView 的 AI Transport 和密钥安全

**Files:**
- Modify: `src/ai-concept/AiGenerationClient.js`
- Create: `src/ai-concept/AiGenerationTransport.js`
- Modify: `src/AiConceptApp.js`
- Test: `tests/ai-generation-transport.test.js`
- After OCCT tests pass, potentially modify CAD bridge files under `ui/window/bridge/` and `ui/window/browser/`，但不得提交 CAD。

**Interfaces:**
- `HttpAiGenerationTransport`: standalone only, fixed `/api/ai-concept` routes。
- `HostAiGenerationTransport`: embedded only, fixed RPC methods `getAiCatalog`, `createAiJob`, `getAiJob`, `retryAiItem`, `cancelAiJob`。

- [ ] **Step 1: 先取得密钥方案的明确决策**

只能选择：

1. 公司服务端持有密钥，CAD C++ 调公司固定 endpoint；或
2. 用户自带密钥，写入 Windows Credential Manager，C++ 读取并直连 OpenAI。

禁止选择：前端输入后存 LocalStorage、写入 JS/JSON、编译进 DLL、明文注册表、日志或安装包。

- [ ] **Step 2: 写双 transport 失败测试**

Standalone 继续走 HTTP；embedded 必须只走 host RPC，host 失败时不得回退到浏览器 fetch。所有 payload 先经过现有请求模型校验。

- [ ] **Step 3: 在 OCCT 实现 transport 选择和安全诊断**

日志只允许固定 stage/code，不记录 prompt、图片 bytes、Token、签名 URL 或响应正文。

- [ ] **Step 4: 若选择 C++ bridge，沿用现有 RendererHostClient 请求-响应协议**

原生层必须限制固定方法、请求大小、并发、超时、响应大小和允许的 MIME。网络取消必须在 WebView/插件销毁时生效。不得新增任意 URL 代理。

- [ ] **Step 5: 跑 OCCT contract、VS Debug x64 和真实 CAD smoke**

至少验证：catalog、创建单图、轮询、结果显示、失败重试、取消、关闭页面无回调、AutoCAD 重启后恢复。

- [ ] **Step 6: 仅提交 OCCT 源码和测试**

CAD 修改保持未暂存、未提交；将准确 diff 和 VS 构建结果记录到交接备注。

---

## Task 9: 项目级保存、过期标记和版本冲突

**Files:**
- Create: `src/shared/ProjectVersionModel.js`
- Modify: `src/panorama/PanoramaPointRepository.js`
- Modify: `src/ai-concept/AiViewRepository.js`
- Modify: `src/ai-concept/AiGenerationConditionRepository.js`
- Modify: Task 7 的 preference repository。
- Test: corresponding repository and version tests。

**Interfaces:**
- Produces: `resolveProjectVersion({ planId, cadVersion, sceneFingerprint })` 和统一 repository adapter。

- [ ] **Step 1: 写版本语义失败测试**

CAD 结构或模型 fingerprint 改变后，本地预览、全景结果、AI 结果和偏好记录均保留历史，但标记非当前版本。只改变 UI 视角不得改变 CAD version。

- [ ] **Step 2: 写冲突测试**

保存时若远端 revision 与编辑开始时不同，返回 `VERSION_CONFLICT`，保留本地草稿并提示重新加载；禁止静默覆盖。

- [ ] **Step 3: 实现 repository adapter，不让 UI 依赖 LocalStorage**

LocalStorage 继续作为 offline adapter；正式 CAD adapter 通过固定 host RPC 保存到项目宿主。所有实体使用 plan/version/room/point 的稳定 ID。

- [ ] **Step 4: 测试异常关闭和恢复**

模拟页面关闭、插件关闭、CAD 重启、损坏草稿和旧 schema，确认恢复最后一次成功保存状态。

- [ ] **Step 5: 完整验证并提交 OCCT**

运行全部 repository tests、`npm.cmd test` 和 `npm.cmd run build:3d`。

---

## Task 10: 安全迁移、CAD 发布验收和清理

**Files:**
- Generated: `dist-3d/**`
- Copy target: CAD source/runtime `preview3d/**`, `preview-panorama/**`, `preview-ai-concept/**`
- Preserve: `cartoon/**`, `preview-vr/**`
- Test: `tests/cad-render-preview-shell.test.js`

- [ ] **Step 1: 完成源代码最终验证**

```powershell
npm.cmd test
npm.cmd run build:3d
```

必须记录 pass/fail/skip；任何 failure 都停止迁移。

- [ ] **Step 2: 检查构建秘密和本地引用**

搜索 `OPENAI_API_KEY`、`Bearer `、`C:\Users\`、`D:\`、`localhost`、开发端口和 runtime 绝对路径。除文档说明外，生产 bundle 不得命中敏感值。

- [ ] **Step 3: 用 manifest 做精确资源替换**

在删除旧哈希 bundle 前，先生成源目录和目标目录 manifest，精确限定三个 preview 目录；目标解析后必须仍位于对应 preview 目录内。不得对 `renderer` 根目录、`cartoon` 或变量未解析路径执行递归删除。

- [ ] **Step 4: 同步 CAD 源树和运行缓存**

三个页面所有文件的相对路径、大小和 SHA-256 必须一致。旧 `preview-vr` 保留。

- [ ] **Step 5: 运行 CAD shell contract 两次**

一次指向 CAD source root，一次指向 `ke_arx_cache` runtime root。必须证明第一个 2D tab 未改变，后三个 tab 指向正确入口。

- [ ] **Step 6: Visual Studio 构建与 AutoCAD 验收**

关闭 acad.exe 避免 xcopy code 4；Debug x64 重新生成；确认实际加载 DLL 和资源缓存时间/hash；逐页验证：3D 模型与材质、全景点位/真实外景/提交渲染、局部示意图/AI transport/恢复。

- [ ] **Step 7: 检查 CAD Git 状态但不提交**

报告迁移前后差异；不执行 `git add`、`git commit`、`git merge` 或 `git push`。多人已有修改一律保留。

- [ ] **Step 8: 修正 OCCT upstream 后再由用户决定 push/PR**

先运行：

```powershell
git branch -vv
git remote -v
```

不要直接推送到当前错误 upstream。目标分支和 PR base 必须由用户明确确认。

---

## 推荐执行顺序

1. Task 1：点位管理 UI，独立且风险低。
2. Task 2–3：先补齐全景任务内部模型和页面，不依赖真实服务。
3. Task 5：完成 AI 离线 E2E 和单图真实验收。
4. Task 6–7：结果相册和客户偏好。
5. Task 4、Task 8、Task 9：需要外部接口/安全决策，信息齐全后实施。
6. Task 10：所有能力稳定后一次性做正式 CAD 发布验收。

不同 Agent 可以并行负责 Task 1、Task 5、Task 6 的测试设计，但不要同时修改 `src/AiConceptApp.js` 或 `src/PanoramaApp.js`。涉及这两个入口文件时必须串行合并并在每次合并后运行完整测试。

## 每个 Agent 的交付格式

接手者完成一个 Task 后必须报告：

1. 修改的绝对路径和职责。
2. RED 测试命令及失败原因。
3. GREEN 测试命令、pass/fail/skip 数量。
4. `npm.cmd test` 与 `npm.cmd run build:3d` 结果。
5. 浏览器或 CAD 实测截图/现象。
6. OCCT commit SHA。
7. CAD 是否被修改；若修改，明确声明未暂存、未提交、未推送。
8. 剩余阻塞，不得用“应该可以”代替证据。

## 最终验收清单

- [ ] 普通 3D 鸟瞰图不显示全景外景；进入全景点位后窗外显示真实小区背景。
- [ ] 全景点位可新增、选择、重命名、删除、单点恢复、恢复全部、微调和设为进入视角。
- [ ] 全景渲染能真实提交、恢复、取消、逐点重试和查看历史版本结果。
- [ ] AI 条件组合、任务创建、真实图片生成、刷新恢复、单项重试和取消均通过。
- [ ] AI 结果相册、对应白模比较、方向示意标识和客户偏好记录完整。
- [ ] 方案版本变化后旧任务与结果保留但明确标记为历史版本。
- [ ] CAD WebView 不包含 OpenAI 密钥，embedded mode 不直接依赖不存在的同源 Node API。
- [ ] 2D 彩平图及 `cartoon/**` 未修改。
- [ ] `preview-vr/**` 保留作回滚。
- [ ] OCCT 全测和生产构建通过；CAD source/runtime hash 一致；VS Debug x64 和真实 AutoCAD smoke 通过。

