# OCCT 户型图可视化系统

一个基于OpenCascade.js和Three.js的强大户型图可视化系统，支持3D立体显示和2D彩平图显示，提供完整的材质编辑、模型拖拽和CSG几何运算功能。

## 📋 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [安装运行](#安装运行)
- [使用说明](#使用说明)
- [API文档](#api文档)
- [开发指南](#开发指南)

## ✨ 功能特性

### 🏠 3D可视化
- **立体户型显示**: 基于OpenCascade.js的精确几何建模
- **实时渲染**: 高性能的Three.js渲染引擎
- **CSG几何运算**: 支持布尔运算（并集、差集、交集）
- **门窗开洞**: 自动化的门窗洞口处理
- **材质系统**: 丰富的材质库和实时材质编辑

### 📋 2D彩平图
- **平面视图**: 清晰的户型平面图显示
- **房间选择**: 交互式房间选择和编辑
- **软装管理**: DXF软装模型的导入和材质编辑
- **视图切换**: 3D/2D视图无缝切换

### 🎯 交互功能
- **双模式操作**: 查看模式和编辑模式
- **拖拽操作**: 材质和模型的拖拽应用
- **快捷键支持**: 完整的键盘快捷键系统
- **右键菜单**: 上下文相关的操作菜单

### 🎨 材质编辑
- **材质库**: 预置丰富的材质资源
- **自定义材质**: 支持创建和导入自定义材质
- **实时预览**: 材质应用的实时预览效果
- **属性调节**: 粗糙度、金属度、透明度等属性调节

## 🛠 技术栈

### 前端核心
- **Three.js** (0.178.0) - 3D渲染引擎
- **OpenCascade.js** (2.0.0-beta) - CAD几何内核
- **React** (18.3.1) - UI框架
- **Vite** (6.0.5) - 构建工具

### 后端技术
- **Node.js** - 运行时环境
- **Express** (5.1.0) - Web框架
- **CAD解析器** - 自定义DXF/JSON解析工具

### 几何库
- **three-bvh-csg** (0.0.17) - CSG运算库
- **three-mesh-bvh** (0.8.0) - 空间索引加速
- **@ke/kedxf** (0.0.7) - DXF文件处理

## 📁 项目结构

```
occt/
├── src/                          # 源代码目录
│   ├── App.js                   # 主应用入口
│   ├── components/              # 组件目录
│   │   ├── MaterialSidebar.js   # 材质侧边栏
│   │   ├── DragDropManager.js   # 拖拽管理器
│   │   ├── SelectionManager.js  # 选择管理器
│   │   ├── RoomRenderer.js      # 房间渲染器
│   │   ├── PlanRenderer.js      # 平面渲染器
│   │   ├── WallSelector.js      # 墙面选择器
│   │   ├── Room2DSelector.js    # 2D房间选择器
│   │   ├── SoftlistRenderer.js  # 软装渲染器
│   │   └── DXFMaterialSidebar.js # DXF材质编辑器
│   ├── core/                    # 核心模块
│   │   ├── SceneManager.js      # 3D场景管理器
│   │   └── Scene2DManager.js    # 2D场景管理器
│   ├── utils/                   # 工具库
│   │   ├── CSGEngineManager.js  # CSG引擎管理
│   │   ├── CSGMeshOperations.js # CSG网格操作
│   │   └── SVGLoader.js         # SVG加载器
│   └── config/                  # 配置文件
│       └── freestyle.js         # 自由风格配置
├── server.js                    # 后端服务器
├── json_parse.js                # JSON解析器
├── index.html                   # 主页面
├── vite.config.js              # Vite配置
├── package.json                # 项目依赖
└── DxfConfig.json              # DXF配置文件
```

## 🚀 安装运行

### 环境要求
- Node.js >= 16.0.0
- npm >= 8.0.0

### 安装步骤

1. **克隆项目**
```bash
git clone [项目地址]
cd occt
```

2. **安装依赖**
```bash
npm install
```

3. **启动开发服务器**
```bash
# 启动后端服务器（端口4001）
npm run dev

# 或启动前端开发服务器（端口3000）
npm run dev-react
```

4. **访问应用**
- 后端服务器: http://localhost:4001
- 前端开发服务器: http://localhost:3000
- 主应用页面: http://localhost:4001/index.html

### 生产构建
```bash
npm run build
```

## 📖 使用说明

### 启动应用
1. 访问 http://localhost:4001/index.html
2. 等待数据加载完成
3. 系统将显示默认的3D户型图

### 基本操作

#### 视图切换
- **3D视图**: 点击"🏠 3D视图"按钮
- **2D彩平图**: 点击"📋 2D彩平图"按钮

#### 操作模式
- **查看模式**: 🔍 仅允许查看和导航
- **编辑模式**: ✏️ 允许编辑和修改操作

#### 快捷键
- **G** - 移动模式
- **R** - 旋转模式
- **S** - 缩放模式
- **Del** - 删除选中对象
- **Esc** - 取消选择

#### 材质操作
1. 点击"📚 资源库"打开材质侧边栏
2. 拖拽材质到3D模型上应用
3. 右键点击对象调整材质属性

#### 软装编辑（2D模式）
1. 切换到2D彩平图视图
2. 点击软装模型选中
3. 在弹出的材质编辑器中调整属性

### 高级功能

#### CSG运算
- 系统支持两种CSG引擎：
  - `three-csgmesh`: 默认引擎，性能优秀
  - `three-bvh-csg`: 高精度引擎，适合复杂几何

#### 自定义材质
1. 在材质侧边栏点击"➕ 添加材质"
2. 上传材质贴图（漫反射、法线、粗糙度等）
3. 设置材质参数
4. 保存并应用

## 🔌 API文档

### 后端API端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/status` | GET | 服务器状态检查 |
| `/outline` | GET | 获取户型外轮廓数据 |
| `/rooms` | GET | 获取房间数据 |
| `/doors_and_windows` | GET | 获取门窗数据 |
| `/softlists` | GET | 获取软装列表 |
| `/softlists_points?id={id}` | GET | 获取指定软装的点数据 |

### 数据格式

#### 房间数据格式
```javascript
{
  "success": true,
  "roomPoints": [
    [
      [x1, y1, z1, bulge1],
      [x2, y2, z2, bulge2],
      // ...更多点
    ]
    // ...更多房间
  ]
}
```

#### 门窗数据格式
```javascript
{
  "success": true,
  "processed_doors": [...],  // 处理后的门数据（用于挖洞）
  "doors": [...],           // 原始门数据（用于显示）
  "processed_windows": [...], // 处理后的窗数据
  "windows": [...]          // 原始窗数据
}
```

## 👨‍💻 开发指南

### 组件架构

#### SceneManager（场景管理器）
- 管理Three.js场景、相机、渲染器
- 处理用户交互（鼠标、键盘）
- 提供场景生命周期管理

#### RoomRenderer（房间渲染器）
- 负责3D房间几何体的创建和渲染
- 处理CSG运算和门窗开洞
- 支持渐进式渲染

#### MaterialSidebar（材质侧边栏）
- 材质库的UI展示
- 拖拽交互处理
- 材质预览和管理

### 扩展开发

#### 添加新材质
1. 在材质配置中添加材质定义
2. 更新材质侧边栏UI
3. 实现材质应用逻辑

#### 自定义CSG操作
1. 继承CSGMeshOperations类
2. 实现自定义运算方法
3. 在RoomRenderer中注册

#### 添加新的交互模式
1. 创建新的Manager类
2. 实现事件处理逻辑
3. 在App.js中集成

### 性能优化建议

1. **几何体优化**: 使用LOD（细节层次）减少复杂几何体的渲染开销
2. **材质批处理**: 合并相同材质的几何体减少绘制调用
3. **异步加载**: 大型模型使用Web Worker异步处理
4. **内存管理**: 及时释放不需要的几何体和材质

## 🐛 故障排除

### 常见问题

#### 1. 服务器启动失败
```bash
# 检查端口占用
netstat -ano | findstr :4001

# 更换端口
PORT=4002 npm run dev
```

#### 2. OpenCascade.js加载失败
- 检查网络连接
- 确认OpenCascade.js版本兼容性
- 查看浏览器控制台错误信息

#### 3. 3D模型显示异常
- 检查几何数据格式
- 验证坐标系设置
- 确认材质路径正确

#### 4. CSG运算失败
- 检查几何体的拓扑有效性
- 尝试不同的精度参数
- 切换CSG引擎

### 调试技巧

1. **启用调试模式**: 在控制台设置 `window.DEBUG = true`
2. **查看性能指标**: FPS计数器和渲染统计
3. **几何体检查**: 使用THREE.js的geometry.isBufferGeometry()验证
4. **内存监控**: 通过Chrome DevTools监控内存使用

## 📄 许可证

[根据项目实际情况填写许可证信息]

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📞 联系方式

- 项目维护者: [维护者信息]
- 问题反馈: [Issues链接]
- 技术讨论: [讨论区链接]

---

**注意**: 本项目仍在积极开发中，API和功能可能会发生变化。建议定期查看更新日志和文档。