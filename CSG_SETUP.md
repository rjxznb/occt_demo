# Three.js CSG 布尔运算设置指南

## 当前状态
目前HTML文件中使用的是`SimpleCSG`类，这只是一个演示版本，会显示重叠的几何体而不是真正的布尔运算。

## 安装真正的CSG库

### 方案1：使用 three-bvh-csg (推荐)

1. **安装库**
```bash
npm install three-bvh-csg
```

2. **在HTML中替换导入**
```javascript
// 替换这行：
// import { ADDITION, SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg';

import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
```

3. **替换SimpleCSG类**
```javascript
// 删除SimpleCSG类，替换为：
class RealCSG {
    static subtract(meshA, meshB) {
        const evaluator = new Evaluator();
        const brushA = new Brush(meshA.geometry);
        const brushB = new Brush(meshB.geometry);
        
        evaluator.evaluate(brushA, brushB, SUBTRACTION);
        
        const resultGeometry = brushA.geometry;
        const material = meshA.material.clone();
        
        return new THREE.Mesh(resultGeometry, material);
    }
}

// 然后在main函数中使用RealCSG.subtract()
```

### 方案2：使用 CSG.js

1. **下载库文件**
```bash
# 下载CSG.js到项目目录
wget https://raw.githubusercontent.com/jscad/csg.js/master/csg.js
```

2. **在HTML中引入**
```html
<script src="./csg.js"></script>
```

3. **实现CSG操作**
```javascript
class CSGHelper {
    static subtract(meshA, meshB) {
        // 将Three.js几何体转换为CSG格式
        const csgA = CSG.fromGeometry(meshA.geometry, meshA.matrix);
        const csgB = CSG.fromGeometry(meshB.geometry, meshB.matrix);
        
        // 执行减法运算
        const result = csgA.subtract(csgB);
        
        // 转换回Three.js几何体
        const resultGeometry = CSG.toGeometry(result, meshA.matrix);
        const material = meshA.material.clone();
        
        return new THREE.Mesh(resultGeometry, material);
    }
}
```

## 修改后的使用方式

### 在visiualize.html中的更改

1. **导入真正的CSG库** (替换第39-40行)
2. **替换SimpleCSG类** (替换第43-72行)
3. **在主函数中使用** (第298行)：
```javascript
// 将这行：
const finalMesh = SimpleCSG.subtract(outlineMesh, combinedRooms);

// 替换为：
const finalMesh = RealCSG.subtract(outlineMesh, combinedRooms);
// 或者：
const finalMesh = CSGHelper.subtract(outlineMesh, combinedRooms);
```

## 注意事项

1. **性能考虑**：CSG运算很耗时，复杂几何体可能需要几秒钟
2. **几何体要求**：确保几何体是闭合的、manifold的
3. **材质处理**：布尔运算后可能需要重新设置材质
4. **错误处理**：添加try-catch处理CSG运算失败的情况

## 测试

安装并配置CSG库后：
1. 重启Node.js服务器：`node main.js`
2. 在浏览器中打开`visiualize.html`
3. 检查控制台是否有CSG相关错误
4. 观察是否显示正确的挖洞效果（绿色外轮廓，内部挖去红色房间区域）

## 故障排除

- **导入错误**：确保库文件路径正确
- **几何体为空**：检查输入几何体是否有效
- **运算失败**：尝试简化几何体或调整容差参数
- **显示异常**：检查材质设置和光照