# 1313 L 型推拉门合成验证实施计划

> 工作目录：`D:\occt_demo\.worktrees\cad-renderer-parametric-bridge`
>
> 分支：`codex/ue-typeid-rendering`

## Task 1：参数化参数解析

**文件：**

- 修改：`tests/parametric-parameter-resolver.test.js`
- 修改：`src/core/ParametricParameterResolver.js`

1. 新增 `1313` 非对称左右边用例，断言 `左宽/右宽/高度/左墙厚/右墙厚`。
2. 运行单测，确认先失败。
3. 将现有拐角边解析整理为可供 `1407`、`1313` 复用的函数，并注册 `1313` 适配器。
4. 重跑相关测试和全量测试。
5. 提交本 checkpoint。

## Task 2：UE 放置与旋转规则

**文件：**

- 修改：`tests/content-model-placement.test.js`
- 修改：`src/core/ContentModelRegistry.js`

1. 新增非对称 Y-up 原型和 `1313` 实例用例。
2. 断言最终角度为 CAD 角度减 90°，并断言模型原点使人工局部盒中心对齐 CAD 轮廓包围盒中心。
3. 运行单测，确认先失败。
4. 增加 `1313` placement adapter，保留统一翻转处理。
5. 重跑相关测试和全量测试。
6. 提交本 checkpoint。

## Task 3：只在调试 URL 注入合成对象

**文件：**

- 新增：`src/dev/SceneFixtures.js`
- 新增：`tests/scene-fixtures.test.js`
- 修改：`src/core/DataSource.js`
- 修改：`src/App3D.js`

1. 先测试查询参数门控、输入不可变、只向 `door_list` 追加一条 `1313`。
2. 运行单测，确认先失败。
3. 实现纯 fixture 工厂和数据源 overlay。
4. 仅在 `App3D` 启动时识别 `fixture=1313` 并包装 bundled data source。
5. 重跑相关测试和全量测试。
6. 提交本 checkpoint。

## Task 4：构建与浏览器验证

1. 运行 `npm.cmd test`。
2. 运行 `npm.cmd run build:3d`。
3. 打开 `index-3d.html?fixture=1313&codex=1313-ue-placement#debug`。
4. 检查控制台资源识别、参数化请求、加载结果和模型调试信息。
5. 截图核对竖直方向、两翼朝向与轮廓位置。
6. 如视觉结果与 UE 公式不符，只在本 checkpoint 内调整 fixture 或 placement，并用回归测试固定结果。
