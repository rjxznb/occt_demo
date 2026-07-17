import { Shape } from "three";
import * as Render from "./colorplane.js";
import { freestyle } from "../config/freestyle.js";

// 解析json字符串为对象，并且返回所有解析后的数据；
export default function ParseJson(json){
    const Room_Points = []; // 每一个元素都是一个房间（每一个元素还是一个数组），之后每个房间数组里面有无数个坐标对象；
    const Room_Names = [];  // 与 Room_Points 一一对应的房间名（主卧/客厅…），供模板按房间上色用；
    const Dim_Points = []; // 标注线；
    const SoftList = []; // 软装在dwg里面的变换数据，包括：旋转和缩放 [ {id: , basepoint: {x, y, z}, scale: {x: , y: , z: }, OutRotateRadian: 0}, { ... }]；
    const parse_data = {}; // 最终返回的解析数据对象；
    const Doors_Points = [];
    const Windows_Points = [];


    let final_room_list = json.final_room_list;
    let soft_list = json.soft_list;
    let final_space_dim_list = json.final_space_dim_list; // bottom/left/right/top_first/second/third_level_dim；
    let door_list = json.door_list;
    let window_list = json.window_list;
    
    let dxf_num = 0; // 记录当前到第几个需要dxf解析的数据了，因为在cpp里面就是按照这个顺序进行文件名存储的；

    if(final_room_list && Array.isArray(final_room_list))
        final_room_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points)) {
                const Room_pointsArray = [];
                
                item.Points.forEach(pointStr => {
                    // 提取X，Y，Z 坐标和 bulge凸度值
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        Room_pointsArray.push({x, y, z, bulge});
                    }
                });
                Room_Points.push(Room_pointsArray);
                Room_Names.push(item.RoomName || item.DisplayName || '');
            }
        });

    
    // 提取出每一个软装图例的二维坐标数组 以及 中心点坐标 和 变换系数
    if(soft_list && Array.isArray(soft_list))
        soft_list.forEach((item, index) => {
            // 对应一个图例对象；
            const ShapeDXF = {};

            // 解析出id：
            ShapeDXF.id = item.TypeId;
            ShapeDXF.id += `_${dxf_num++}`;
            
            ShapeDXF.points = [];

            // 如果是自由绘制则需要他们的点数据；
            if(item.TypeId in freestyle){
                if(item.Points && Array.isArray(item.Points)){
                    item.Points.forEach(pointStr => {
                        // 提取X，Y，Z 坐标和 bulge凸度值
                        const xMatch = pointStr.match(/X=([\d.-]+)/);
                        const yMatch = pointStr.match(/Y=([\d.-]+)/);
                        const zMatch = pointStr.match(/Z=([\d.-]+)/);
                        const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                        
                        if (xMatch && yMatch && zMatch) {
                            const x = parseFloat(xMatch[1]);
                            const y = parseFloat(yMatch[1]);
                            const z = parseFloat(zMatch[1]);
                            const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                            ShapeDXF.points.push({x, y, z, bulge});
                        }
                    });
                }
                // 这里ShapeDXF.points是一个点数组，不是房间数组，直接处理弧形采样
                // let newPointsArray = [];
                // let startPoint = ShapeDXF.points[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < ShapeDXF.points.length + 1; i++){
                //     let endPoint = ShapeDXF.points[i % ShapeDXF.points.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                ShapeDXF.points = sampleAllArcs(ShapeDXF.points);
            }
            
            // 解析出中心点：
            const basepoint = {};
            const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
            const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
            const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
            basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
            ShapeDXF.basepoint = basepoint;
            
            // 解析出放缩矩阵：
            ShapeDXF.scale = {};
            ShapeDXF.scale.x = item.OutXScale;
            ShapeDXF.scale.y = item.OutYScale;
            ShapeDXF.scale.z = item.OutZScale;

            // 解析出旋转系数；
            ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

            // TypeId 与方块外接轮廓（世界坐标），供 3D 用 box 占位、模板按类别上色。
            // item.Points 是该图例方块的角点（已是绝对世界坐标，中心即 BasePoint），
            // 直接当 footprint 挤出即可，无需再变换。
            ShapeDXF.kind = 'softlist';   // 区别于同存于 SoftLists 里的门/窗
            ShapeDXF.typeId = item.TypeId;
            ShapeDXF.footprint = [];
            if (item.Points && Array.isArray(item.Points)) {
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    if (xMatch && yMatch) {
                        ShapeDXF.footprint.push({ x: parseFloat(xMatch[1]), y: parseFloat(yMatch[1]) });
                    }
                });
            }

            // 添加此图例对象到户型图例数组；
            SoftList.push(ShapeDXF);

        });


    // 解析出长度标注线段：每一个行可能包含多个线段；
    if(final_space_dim_list)
        for (let key in final_space_dim_list){
            let dim = final_space_dim_list[key];
            const Dim_pointsArray = [];
            dim.forEach(pointStr => {
                    // 提取X和Y坐标
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    if (xMatch && yMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        Dim_pointsArray.push({x, y, z});
                    }
                }
            );
            Dim_Points.push(Dim_pointsArray);
        }



    // 解析门数据
    if(door_list && Array.isArray(door_list))
        door_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points) && item.Size && item.TypeId) {
                let doorPointsArray = [];
                
                // 解析Points字段
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        doorPointsArray.push({x, y, z, bulge});
                    }
                });
                
                // 处理门的弧形采样
                // let newDoorPointsArray = [];
                // let startPoint = doorPointsArray[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < doorPointsArray.length + 1; i++){
                //     let endPoint = doorPointsArray[i % doorPointsArray.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newDoorPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newDoorPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                doorPointsArray = sampleAllArcs(doorPointsArray);


                // 解析Size字段 (格式: "X=800.000000 Y=140.000000")
                const sizeXMatch = item.Size.match(/X=([\d.-]+)/);
                const sizeYMatch = item.Size.match(/Y=([\d.-]+)/);
                const sizeX = sizeXMatch ? parseFloat(sizeXMatch[1]) : 0;
                const sizeY = sizeYMatch ? parseFloat(sizeYMatch[1]) : 0;
                
                // 解析BlockInnerInfo中的高度字段
                let height = 0;
                if (item.BlockInnerInfo && item.BlockInnerInfo.高度) {
                    height = parseFloat(item.BlockInnerInfo.高度);
                }

                // 存储门数据
                Doors_Points.push({
                    points: doorPointsArray,
                    size: { x: sizeX, y: sizeY },
                    typeid: item.TypeId,
                    height: height,
                });

                // 对应一个图例对象；
                const ShapeDXF = {};
                // 解析出id：
                ShapeDXF.id = item.TypeId;
                ShapeDXF.id += `_${dxf_num++}`;

                // 异形门；
                if(item.TypeId in freestyle){
                    ShapeDXF.points = doorPointsArray;
                }

                // 解析出中心点：
                const basepoint = {};
                const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
                const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
                const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
                basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
                ShapeDXF.basepoint = basepoint;

                
                // 解析出放缩矩阵：
                ShapeDXF.scale = {};
                ShapeDXF.scale.x = item.OutXScale;
                ShapeDXF.scale.y = item.OutYScale;
                ShapeDXF.scale.z = item.OutZScale;

                // 解析出旋转系数；
                ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

                // 添加此图例对象到户型图例数组；
                SoftList.push(ShapeDXF);
            }
        });
    
    // 解析窗数据
    if (window_list && Array.isArray(window_list))
        window_list.forEach((item, index) => {
            if (item.Points && Array.isArray(item.Points) && item.Size && item.TypeId) {
                let windowPointsArray = [];
                
                // 解析Points字段
                item.Points.forEach(pointStr => {
                    const xMatch = pointStr.match(/X=([\d.-]+)/);
                    const yMatch = pointStr.match(/Y=([\d.-]+)/);
                    const zMatch = pointStr.match(/Z=([\d.-]+)/);
                    const bulgeMatch = pointStr.match(/B=([\d.-]+)/);
                    
                    if (xMatch && yMatch && zMatch) {
                        const x = parseFloat(xMatch[1]);
                        const y = parseFloat(yMatch[1]);
                        const z = parseFloat(zMatch[1]);
                        const bulge = bulgeMatch ? parseFloat(bulgeMatch[1]) : 0;
                        windowPointsArray.push({x, y, z, bulge});
                    }
                });

                // 处理窗的弧形采样
                // let newWindowPointsArray = [];
                // let startPoint = windowPointsArray[0];
                // // 之所以停止条件为+1就是因为要要整个空间闭合；
                // for (let i = 1; i < windowPointsArray.length + 1; i++){
                //     let endPoint = windowPointsArray[i % windowPointsArray.length];
                //     if(startPoint.bulge != 0){
                //         let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                //         newWindowPointsArray.push(...arcpoints);
                //         startPoint = endPoint;
                //     }else{
                //         newWindowPointsArray.push(startPoint);
                //         startPoint = endPoint;
                //     }
                // }
                windowPointsArray = sampleAllArcs(windowPointsArray);
                
                // 解析Size字段
                const sizeXMatch = item.Size.match(/X=([\d.-]+)/);
                const sizeYMatch = item.Size.match(/Y=([\d.-]+)/);
                const sizeX = sizeXMatch ? parseFloat(sizeXMatch[1]) : 0;
                const sizeY = sizeYMatch ? parseFloat(sizeYMatch[1]) : 0;
                
                // 解析BlockInnerInfo中的离地高度和高度字段
                let groundHeight = 0;  // 离地高度
                let height = 0;        // 高度
                if (item.BlockInnerInfo) {
                    if (item.BlockInnerInfo.离地高度) {
                        groundHeight = parseFloat(item.BlockInnerInfo.离地高度);
                    }
                    if (item.BlockInnerInfo.高度) {
                        height = parseFloat(item.BlockInnerInfo.高度);
                    }
                }

                // 存储窗数据
                Windows_Points.push({
                    points: windowPointsArray,
                    size: { x: sizeX, y: sizeY },
                    typeid: item.TypeId,
                    groundHeight: groundHeight,
                    height: height,
                });

                // 对应一个图例对象；
                const ShapeDXF = {};
                // 解析出id：
                ShapeDXF.id = item.TypeId;
                ShapeDXF.id += `_${dxf_num++}`;

                // 异形窗；
                if(item.TypeId in freestyle){
                    ShapeDXF.points = windowPointsArray;
                }

                // 解析出中心点：
                const basepoint = {};
                const basepoint_x = parseFloat(item.BasePoint.match(/X=([\d.-]+)/)[1]);
                const basepoint_y = parseFloat(item.BasePoint.match(/Y=([\d.-]+)/)[1]);
                const basepoint_z = parseFloat(item.BasePoint.match(/Z=([\d.-]+)/)[1]);
                basepoint.x = basepoint_x, basepoint.y = basepoint_y, basepoint.z = basepoint_z; // 中心点坐标对象；       
                ShapeDXF.basepoint = basepoint;
                
                // 解析出放缩矩阵：
                ShapeDXF.scale = {};
                ShapeDXF.scale.x = item.OutXScale;
                ShapeDXF.scale.y = item.OutYScale;
                ShapeDXF.scale.z = item.OutZScale;

                // 解析是否翻转；
                ShapeDXF.verticalFlip = item.VerticalFlip;
                ShapeDXF.horizontalFlip = item.HorizontalFlip;

                // 解析出旋转系数；
                ShapeDXF.rotate = item.OutRotateRadian+item.BlockInnerInfo.旋转角度;

                // 添加此图例对象到户型图例数组；
                SoftList.push(ShapeDXF);
            }
        });

    parse_data.Room_Points = Room_Points;
    parse_data.Room_Names = Room_Names;
    parse_data.SoftLists = SoftList;
    parse_data.Dim_Points = Dim_Points;
    parse_data.door_list = Doors_Points;
    parse_data.window_list = Windows_Points;

    // 处理弧形，进行采样；
    parse_data.Room_Points.forEach((item, index)=> { // 每一个item都是一个数组（表示房间），每一个数组里面有N个对象元素{x, y, z, b}（表示坐标点），从右上角逆时针到右下角；
        let newitem = [];
        let startPoint = item[0];
        // 之所以停止条件为+1就是因为要要整个空间闭合；
        for (let i =1; i < item.length+1; i++){
            let endPoint = item[i%item.length];
            if(startPoint.bulge !=0){
                let arcpoints = Render.SampleArc(startPoint, endPoint, startPoint.bulge);
                newitem.push(...arcpoints);
                startPoint = endPoint;
            }else{
                newitem.push(startPoint);
                startPoint = endPoint;
            }
        }
        parse_data.Room_Points[index] = newitem; // 替换掉原来的数组；不能通过item直接修改，因为item是一个局部变量引用，改变他不会改变原数组的对象；
    });

    return parse_data;
}

/**
 * 使用SampleArc函数处理所有点，包括弧形段
 * @param {Array} points - 原始点数组，格式: [{x, y, z, bulge}, ...]
 * @returns {Array} 采样后的点数组
 */
function sampleAllArcs(points) {
    let sampledPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const currentPoint = points[i];
        const nextPoint = points[(i + 1) % points.length];
        
        // 检查当前点是否有bulge值
        if (currentPoint.bulge && Math.abs(currentPoint.bulge) > 0.001) {
            try {
                // 使用专门的门窗弧形采样函数
                const arcPoints = sampleDoorWindowArc(currentPoint, nextPoint, currentPoint.bulge);
                
                // 添加弧形采样点（排除最后一个点，避免重复）
                for (let j = 0; j < arcPoints.length - 1; j++) {
                    sampledPoints.push(arcPoints[j]);
                }
            } catch (error) {
                console.warn('弧形采样失败，使用直线替代:', error);
                sampledPoints.push(currentPoint);
            }
        } else {
            // 直接添加当前点
            sampledPoints.push(currentPoint);
        }
    }
    
    return sampledPoints;
}

/**
 * 门窗专用弧形采样函数 - 适配顺时针坐标系（去除THREE.js依赖）
 * @param {Object} startPoint - 起点 {x, y, z, bulge}
 * @param {Object} endPoint - 终点 {x, y, z, bulge}
 * @param {number} bulge - 凸度值
 * @returns {Array} 采样点数组
 */
function sampleDoorWindowArc(startPoint, endPoint, bulge) {
    // 1. 计算弦长和方向向量
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const chordLength = Math.sqrt(dx * dx + dy * dy);

    if (chordLength === 0) {
        console.warn("起点和终点重合，无法绘制圆弧");
        return [startPoint];
    }

    // 2. 根据 bulge 值计算圆弧对应的夹角（弧度）
    const theta = 2 * Math.atan(Math.abs(bulge));
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

    // 6. 确定圆弧方向（门窗坐标系：bulge < 0 表示顺时针）
    const clockwise = bulge < 0;
    
    // 7. 计算角度差
    let angleDiff = endAngle - startAngle;
    if (clockwise) {
        if (angleDiff > 0) {
            angleDiff -= 2 * Math.PI;
        }
    } else {
        if (angleDiff < 0) {
            angleDiff += 2 * Math.PI;
        }
    }

    // 8. 采样（降低采样密度以减少复杂度）
    const sampleCount = 50; // 采样点数量
    let points = [];
    
    for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount;
        const angle = startAngle + angleDiff * t;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        points.push({x: x, y: y, z: 0, bulge: 0});
    }
    
    return points;
}
