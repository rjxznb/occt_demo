import * as THREE from 'three';


function Draw_Line(start_point, end_point, material=Line_Material){
    const path = new THREE.LineCurve(new THREE.Vector2(start_point.x, start_point.y), new THREE.Vector2(end_point.x, end_point.y));
    // console.log(path);
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(path.getPoints(5));
    const line = new THREE.Line(geometry, material);
    return line;
}


// 画四边形图例
function DrawRect(width, height, x, y, z, color){
    const rect = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshLambertMaterial({
            color: color,
            side: THREE.DoubleSide
        })
    );
    rect.position.set(x, y, z);
    scene.add(rect);
}

// 画房间：在这里仅支持矩形；
function DrawRoom(width, height){
    console.log(width, height);
    const room = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshLambertMaterial({
            color: 0x888888,
            side: THREE.DoubleSide
        })
    );
    scene.add(room);
}



// 画墙
function DrawWall(startPoint, endPoint, material=Wall_Material, borderWidth=80){
    // 计算墙体长度和方向
    const direction = new THREE.Vector3().subVectors(endPoint, startPoint); // 计算向量 endPoint 和 startPoint的差；
    console.log(direction);
    const length = direction.length(); // 获取向量的长度
    console.log(length);
    // 计算旋转角度（相对于X轴）
    const angle = Math.atan2(direction.y, direction.x);
    // 创建墙体几何体
    const wallThickness = borderWidth;
    const wallHeight = 1000;
    const geometry = new THREE.BoxGeometry(length, wallThickness, wallHeight);
    // 创建墙体网格
    const wall = new THREE.Mesh(geometry, material);
    // 计算墙体的中心点
    const center = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
    // 设置墙体位置
    wall.position.copy(center);
    // 设置墙体旋转
    wall.rotation.z = angle;
    // 添加到场景
    scene.add(wall);
}

// 画圆形墙（存在bulge凸度值的坐标）；
export function SampleArc(startPoint, endPoint, bulge) {
    // 1. 计算弦长和方向向量
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const chordLength = Math.sqrt(dx * dx + dy * dy);

    if (chordLength === 0) {
        console.warn("起点和终点重合，无法绘制圆弧墙");
        return;
    }

    // 2. 根据 bulge 值计算圆弧对应的夹角（弧度）
    const theta = 2 * Math.atan(bulge);
    const radius = chordLength / (2 * Math.sin(theta));

    // 3. 计算垂直于弦的方向（即指向圆心的方向）
    const perpDirX = -dy / chordLength;
    const perpDirY = dx / chordLength;

    // 4. 圆心位置
    const chordMidpointX = (startPoint.x + endPoint.x) / 2;
    const chordMidpointY = (startPoint.y + endPoint.y) / 2;

    const centerOffset = radius * Math.cos(theta); // 向圆心偏移的距离
    const centerX = chordMidpointX + perpDirX * centerOffset * (bulge > 0 ? 1 : -1);
    const centerY = chordMidpointY + perpDirY * centerOffset * (bulge > 0 ? 1 : -1);

    // 5. 起始角和终止角
    const startAngle = Math.atan2(startPoint.y - centerY, startPoint.x - centerX);
    const endAngle = Math.atan2(endPoint.y - centerY, endPoint.x - centerX);

    // 6. 创建 ArcCurve（注意：Three.js 中 bulge > 0 表示逆时针）
    const arcCurve = new THREE.ArcCurve(
        centerX,
        centerY,
        radius,
        startAngle,
        endAngle,
        bulge < 0 // 如果 bulge 是负值，则顺时针
    );

    // 7. 采样
    let points = [];

    const arcPoints = arcCurve.getPoints(50);
    for (let i = 0; i < arcPoints.length; i++) {
        const point = arcPoints[i];
        points.push({'x': point.x, 'y': point.y, 'z': 0, 'bulge':1});
    }
    return points;
}


// 渲染软装：思路就是先通过n条线画出线图，并且将他们都加入到一个group作为一个物体，
// 之后将这个group按照json文件的旋转角度和缩放进行旋转和缩放，最后将这个group加入场景中；
export function DrawSoft(dxf_points){
    let group = new THREE.Group();
    for (let i =0; i < dxf_points.length; i+=2){
        const line_object = Draw_Line(dxf_points[i], dxf_points[i+1]);
        group.add(line_object);
    }
    
    // 旋转和缩放group
    // group.rotation.set(0, json_data.rotation, 0);
    // group.scale.set(json_data.scale, json_data.scale, json)
    return group;
}












// 画四周的标注
function createLabel(text, x, y, z) {
    // 在实际项目中，这里应该使用CSS2DRenderer或CSS3DRenderer
    // 但为了简化，这里只创建一个3D文字对象
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;
    
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.fillStyle = '#333333';
    context.font = 'bold 48px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width/2, canvas.height/2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(80, 40, 1);
    
    return sprite;
}

function Animate() {
    requestAnimationFrame(Animate);
    controls.update();
    renderer.render(scene, camera);

    // 同步当前光源强度到GUI控件
    guiControls.intensity = currentLight ? currentLight.intensity : 0;
     // 同步光源当前位置到GUI控件
    lightPosition.x = currentLight.position.x;
    lightPosition.y = currentLight.position.y;
    lightPosition.z = currentLight.position.z;
}

function Render() { 
    renderer.render(scene, camera);
    document.body.appendChild(renderer.domElement);
    Animate();
}

