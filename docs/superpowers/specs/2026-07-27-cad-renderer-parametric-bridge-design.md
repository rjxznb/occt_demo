# CAD 3D/VR 静态资源迁移与参数化 C++ 桥接设计

日期：2026-07-27

## 1. 背景

`D:\occt_demo` 是可独立运行的 3D/VR Demo。其参数化软装加载目前依赖 `C:\Users\User\Desktop\parametric-lab\backend` 中运行在 `localhost:3100` 的 Node/Express 进程。

CAD 插件通过 WebView2 加载 `build_resource\PluginResource\html\renderer` 下的静态页面。页面实际源为 `https://renderer.local`。参数化所需的两个远程接口没有返回允许该源跨域的 CORS 响应头，因此 WebView 内的 JavaScript 不能直接读取接口响应。

本设计将最新 3D/VR 构建产物迁入 CAD 插件，同时以 C++ 原生桥接取代 CAD 运行时对 Node 后端进程的依赖。

## 2. 目标

- 保留 `occt_demo` 作为完整、可独立运行和调试的 Demo。
- 沿用 CAD 项目既有发布方式，只在 CAD 仓库保存编译后的 3D/VR 静态资源，不引入 npm/Vite 工程。
- CAD WebView 运行时不再依赖 `localhost:3100`。
- 通过现有 `KWebBridge` 和 libcurl 调用参数化远程服务。
- 保持已实现的软装朝向、翻转、锚点、点击调试和房间信息切换行为。
- 规范隔离通用网络、参数化业务、WebView 桥接与 Three.js 模型加载职责。
- CAD 项目只修改和验证，不执行暂存、提交或推送。

## 3. 非目标

- 不删除或废弃 `occt_demo`。
- 不在 CAD 仓库引入前端源码、`package.json`、Vite 或 `node_modules`。
- 不创建自动同步或部署脚本；构建产物由本次实施人工替换。
- 不修改远程服务的 CORS 配置。
- 不关闭 WebView2 的同源或 Web 安全策略。
- 不迁移当前 OCCT 未使用的 Node `/api/fetchJson` 接口。
- 不重构 CAD 其他 WebView 页面或公共网络业务。

## 4. 已确认的现状

### 4.1 CAD 静态资源约定

CAD 的渲染预览历史实现只提交编译后的页面资源：

- `renderer/cartoon` 是编译后的 React 静态包。
- `renderer/preview3d` 和 `renderer/preview-vr` 是 Vite 构建产物。
- CAD 仓库没有对应的 npm/Vite 前端工程。

因此本次继续使用相同约定：源码和构建能力留在 `occt_demo`，CAD 只承载最终产物。

### 4.2 WebView 宿主通信

顶层 `render_preview.js` 已实现 `renderer-preview` 消息协议：

- iframe 使用 `postMessage` 发起带请求 ID 的 `invoke` 消息。
- 顶层页面通过 `NATIVE_METHODS` 白名单选择允许调用的原生方法。
- 顶层页面调用由 `KWebBridge` 注入的全局函数。
- 调用结果以 `result` 消息返回对应 iframe。

参数化调用应扩展这套协议，不创建第二套 iframe 通信机制。

### 4.3 Node 后端实际职责

Node 进程没有实现本地参数化算法，只负责：

1. 代理 `getGoodsDetailById`。
2. 代理 `modelUrlToObj`。
3. 检测 `modelUrlToObj` 响应是否为 zstd。
4. 解压、解析并把 JSON 返回前端。

## 5. 总体架构

### 5.1 独立 Demo

```text
ParametricModelLoader
  -> ParametricApiClient
  -> http://localhost:3100
  -> 远程参数化接口
```

独立 Demo 保持现有 Node 开发方式，便于浏览器调试和自动测试。

### 5.2 CAD WebView

```text
ParametricModelLoader
  -> ParametricApiClient
  -> RendererHostClient
  -> iframe postMessage
  -> render_preview.js / NATIVE_METHODS
  -> KWebBridge / BindAsync
  -> KParametricModelBridge
  -> KParametricApiClient / libcurl
  -> 固定远程参数化接口
```

CAD 环境中的原生桥失败后不得自动回退到 `localhost:3100`，避免生产插件产生隐藏的本地进程依赖。

## 6. 前端组件设计

### 6.1 `src/core/RendererHostClient.js`

新增通用 iframe 宿主客户端，职责为：

- 使用现有 `renderer-preview` 协议发送 `invoke`。
- 生成并维护请求 ID。
- 根据方法配置超时。
- 处理 `result` 消息并清理 pending request。
- 将宿主错误转换为带 `code` 的 JavaScript `Error`。
- 页面卸载时拒绝未完成请求并移除监听器。

它不包含参数化业务、远程地址或 Three.js 逻辑。

### 6.2 `src/services/ParametricApiClient.js`

新增参数化 API 门面，对模型加载器仅暴露：

- `getGoodsDetail(resId)`
- `convertModel(url, parameters)`

运行环境策略：

- 页面独立运行时使用 Node HTTP transport。
- 页面处于渲染预览 iframe 时使用 host transport。
- transport 在初始化时确定，调用失败时不跨环境回退。

该模块还负责：

- 规范化 Node 与 CAD 两种通道的响应。
- 解码 C++ 返回的 Base64 数据。
- 使用 `fzstd` 解压 zstd 响应。
- 解析响应 JSON，并为格式错误产生统一错误码。

`fzstd` 被加入 Demo 的前端构建依赖并编译进最终静态 JS，CAD 运行环境不需要 npm。

### 6.3 `src/components/ParametricModelLoader.js`

保留以下职责：

- TypeId 到模板和 ResId 的匹配。
- 参数提取、缓存和 OBJ 解析。
- 软装模型变换、放置与调试元数据。

移除以下职责：

- `BACKEND_URL` 常量。
- HTTP URL 拼接。
- 直接调用 `fetch`。

单个参数化模型失败时继续处理其他模型和主体户型，并输出 `typeId`、`resId` 与错误码。

## 7. CAD C++ 组件设计

### 7.1 `common/net/k_parametric_api_client.h/.cpp`

该组件只负责参数化服务的网络通信：

- `GetGoodsDetail(res_id)` 请求固定的商品详情接口。
- `ConvertModel(request)` 请求固定的模型转换接口。
- 使用独立 libcurl easy handle，避免共享全局请求状态。
- HTTPS 开启证书链和主机名校验。
- 设置连接超时、总超时与最大响应大小。
- 捕获 HTTP 状态、响应正文和网络错误。
- 检测响应开头的 zstd 魔数 `28 B5 2F FD`。

该组件不依赖 WebView，也不调用 JavaScript。

不直接复用当前 `KeCurlWrapper`：其通用请求实现关闭了 HTTPS 证书与主机名校验，不符合本功能的安全要求。

### 7.2 `ui/window/bridge/k_parametric_model_bridge.h/.cpp`

该组件负责在一个指定的 `KWebBridge` 上注册：

- `getParametricGoodsDetail`
- `convertParametricModel`

两个方法都使用 `BindAsync`，网络请求不得运行在 CAD UI 线程。

桥接层负责：

- 校验 JavaScript 参数。
- 调用 `KParametricApiClient`。
- 将原生结果序列化为桥可接受的 JSON。
- 将错误映射为统一错误对象。
- 在宿主关闭后禁止向已销毁的 WebView 回调。

异步回调捕获共享生命周期状态，不直接捕获已经可能销毁的 browser `this`。关闭流程先将共享状态标记为 inactive 并清空 bridge 指针；工作线程完成后只有在状态仍 active 时才能回调。桥接函数内部捕获全部异常，避免 `KWebBridge` 的 detached wrapper 在线程异常路径访问已销毁状态。

### 7.3 `ui/window/browser/k_render_preview_browser.cpp`

该文件只增加桥接控制器的持有、初始化和关闭调用，不放置 HTTP 或参数化解析代码。

公共 `ui/window/bridge/k_web_bridge.cpp` 保持不变。

### 7.4 Visual Studio 工程

新增 C++ 文件需要登记到：

- `KeCADPlugin.vcxproj`
- `KeCADPlugin.vcxproj.filters`

不修改 CAD 项目中已有的用户 `README.md` 工作区改动。

## 8. 接口与数据格式

### 8.1 商品详情

JavaScript 请求：

```json
{
  "resId": "12345"
}
```

成功结果为商品详情 JSON。

### 8.2 模型转换

JavaScript 请求：

```json
{
  "url": "https://example/model.json",
  "parameters": [
    { "name": "宽度", "value": 1200 }
  ]
}
```

普通 JSON 响应直接作为 JSON 返回。zstd 响应返回：

```json
{
  "encoding": "zstd-base64",
  "body": "BASE64_DATA"
}
```

Base64 保证二进制数据能够安全通过仅支持 JSON 字符串结果的桥接接口。解压在前端完成，避免为 CAD 工程增加新的 zstd 原生链接依赖。

## 9. 输入、安全与资源限制

C++ 端实施以下约束：

- 商品详情请求只允许固定主机和固定接口路径，仅将编码后的 `resId` 放入查询参数。
- 模型转换只向固定主机和固定接口路径发起 POST。
- 请求中的模型 URL 只作为固定接口的 JSON 参数，不作为本地代理目标。
- 拒绝空、超长或非法协议的模型 URL。
- 限制参数数量、参数名长度和整个请求体大小。
- 参数数值必须为有限数值。
- 限制响应体最大字节数，超过限制立即终止请求。
- 日志只记录请求类别、状态、耗时、响应大小和业务标识，不打印完整 URL 查询、Cookie、模型正文或完整 Base64。

## 10. 错误模型

统一错误对象：

```json
{
  "code": "HTTP_ERROR",
  "message": "参数化服务返回异常",
  "status": 500
}
```

错误码集合：

- `INVALID_ARGUMENT`
- `NETWORK_ERROR`
- `HTTP_ERROR`
- `RESPONSE_TOO_LARGE`
- `INVALID_RESPONSE`
- `DECOMPRESSION_ERROR`
- `BRIDGE_UNAVAILABLE`
- `TIMEOUT`
- `CANCELLED`

错误处理原则：

- 单个模型失败不终止房间、墙体和其他模型的渲染。
- 不弹出阻断整个预览的错误对话框。
- CAD 桥失败不访问 Node 后端。
- WebView 关闭期间未完成的调用静默取消，并可在调试日志中看到 `CANCELLED`。

## 11. 静态资源迁移

在 `occt_demo` 完成测试和 `npm run build:3d` 后，人工用最新产物替换：

```text
C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview3d
C:\Users\User\Desktop\cad_plugin\build_resource\PluginResource\html\renderer\preview-vr
```

CAD 中只保留：

- 各入口 `index.html`
- 构建生成的 `assets`
- 运行必需的示例/模板数据

不复制 `src`、`node_modules`、Vite 配置、测试或 npm 元数据。

## 12. 测试设计

### 12.1 OCCT 自动测试

新增测试覆盖：

- 独立页面选择 Node transport。
- CAD iframe 选择 host transport。
- CAD transport 失败时不回退 Node。
- iframe 请求 ID、结果配对、超时和 dispose。
- 商品详情参数与响应规范化。
- 模型转换普通 JSON 响应。
- 模型转换 zstd Base64 解码、解压和 JSON 解析。
- 原生拒绝、格式错误和超时错误映射。

继续运行既有软装朝向、锚点、调试信息和场景点击交互测试。

必要验证命令：

```text
npm test
npm run build:3d
```

### 12.2 CAD 编译与运行验证

CAD 当前没有独立的 C++ 单元测试框架，本次不引入新的测试框架。执行：

- Debug x64 编译。
- Release x64 编译。
- WebView 加载实际 `Drawing2.json`。
- 未启动 `localhost:3100` 时参数化模型仍能加载。
- 所有参数化软装保持竖直，锚点、旋转和翻转与 Demo 一致。
- 点击模型仍输出 TypeId 和相关调试信息。
- 同一房间重复点击关闭尺寸框，切换房间只保留一个尺寸框。
- 切换 3D/VR 标签时暂停和恢复正常。
- 关闭并重新打开预览时无崩溃、悬空回调或残留网络结果。
- 断网、超时和上游 500 时 CAD 主界面仍可操作，其他场景内容继续渲染。

## 13. 版本控制约束

- `occt_demo` 中的设计、实现和测试可以按正常流程提交。
- CAD 项目中的静态资源与 C++ 修改只保留在工作区。
- 不对 CAD 项目执行 `git add`、`git commit`、`git push` 或创建 PR。
- 开始和结束时分别记录 CAD `git status --short`，确认保留原有 `README.md` 修改并明确列出本次新增改动。

## 14. 完成标准

同时满足以下条件才视为完成：

1. `occt_demo` 仍可独立启动和使用 Node 后端加载参数化软装。
2. 最新 3D/VR 静态产物已人工迁移到 CAD renderer 目录。
3. CAD WebView 不启动 Node 后端也能加载参数化软装。
4. 参数化模型的朝向、位置、旋转和翻转正确。
5. CAD UI 在请求过程中保持响应。
6. 关闭预览、断网和上游错误不会造成崩溃或整体渲染中断。
7. OCCT 自动测试与 3D 构建通过，CAD Debug/Release x64 编译通过。
8. CAD 项目没有任何新增提交、暂存或推送。

## 15. 2026-07-28 HTTPS 根证书修正

### 15.1 现场证据与根因

- CAD 原生桥中的 `getParametricGoodsDetail` 使用 HTTP，请求持续返回 200。
- `convertParametricModel` 使用 HTTPS，请求在取得 HTTP 状态前返回 `status=0` 和 `NETWORK_ERROR`。
- 同一 HTTPS 端点通过 Windows 网络栈能够正常返回 HTTP 200。
- CAD 项目链接的 libcurl 7.87.0 使用 OpenSSL 静态后端；项目、运行缓存和环境中均没有 CA bundle。
- 当前客户端启用了 `CURLOPT_SSL_VERIFYPEER=1` 和 `CURLOPT_SSL_VERIFYHOST=2`，但没有为 OpenSSL 配置可信根来源。

因此，HTTPS 转换失败发生在 TLS 证书链校验阶段，而不是 WebView RPC、商品详情解析、模型参数、OBJ 解析或 Three.js 放置阶段。

### 15.2 修正设计

在 `KParametricApiClient` 的公共 curl 请求配置中增加：

```cpp
CURLOPT_SSL_OPTIONS = CURLSSLOPT_NATIVE_CA
```

该选项让 Windows 上的 OpenSSL/libcurl 导入系统原生根证书库，同时继续保留：

- `CURLOPT_SSL_VERIFYPEER=1`
- `CURLOPT_SSL_VERIFYHOST=2`
- 禁止重定向
- 仅允许 HTTP/HTTPS 协议
- 固定模型转换端点

不关闭 TLS 校验，不部署独立 PEM 文件，也不回退 Node 后端。

### 15.3 验证标准

1. 源码合约测试在实现前因缺少 `CURLSSLOPT_NATIVE_CA` 而失败，实现后通过。
2. CAD Debug x64 重新生成成功，并由现有 PostBuild 复制到 AutoCAD 2021 Support 目录；两份 ARX 哈希一致。
3. 实际 CAD 日志中 `convertParametricModel` 获得 HTTP 200，不再出现 `status=0 code=NETWORK_ERROR`。
4. 参数化软装重新显示，且不影响现有朝向、锚点、旋转、翻转与点击调试行为。
