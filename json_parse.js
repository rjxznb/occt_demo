import * as Render from "./colorplane.js";



// 解析json字符串为对象，并且返回所有解析后的数据；
export default function ParseJson(json){
    const Room_Points = []; // 每一个元素都是一个房间（每一个元素还是一个数组），之后每个房间数组里面有无数个对象{x, y}表示的表示坐标点；
    const SoftList_Points = []; // 每一个元素都是一个数组对应一个软装，数组里面存储了无数个坐标点对象，每个对象里面有x, y, z三个属性；
    const Dim_Points = []; // 标注线；
    const SoftList_Trainsitions = []; // 软装在dwg里面的变换数据，包括：旋转和缩放 [ {id: , basepoint: {x, y, z}, scale: {x: , y: , z: }, OutRotateRadian: 0}, { ... }]；
    const parse_data = {}; // 最终返回的解析数据对象；

    let final_room_list = json.final_room_list;
    let soft_list = json.soft_list;
    let final_space_dim_list = json.final_space_dim_list; // bottom/left/right/top_first/second/third_level_dim；
    

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
        }
    });


    // 提取出每一个软装图例的二维坐标数组 以及 中心点坐标 和 变换系数
    soft_list.forEach((item, index) => {
        if (item.Points && Array.isArray(item.Points)) {
            const pointsArray = [];
            
            item.Points.forEach(pointStr => {
                // 提取X和Y坐标
                const xMatch = pointStr.match(/X=([\d.-]+)/);
                const yMatch = pointStr.match(/Y=([\d.-]+)/);
                const zMatch = pointStr.match(/Z=([\d.-]+)/);
                
                if (xMatch && yMatch && zMatch) {
                    const x = parseFloat(xMatch[1]);
                    const y = parseFloat(yMatch[1]);
                    const z = parseFloat(zMatch[1]);
                    pointsArray.push({x, y, z});
                }
            });
            SoftList_Points.push(pointsArray);
        }


        // 对应一个图例对象；
        const ShapeDXF = {};


        // 解析出id：
        ShapeDXF.id = item.TypeId;

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
        ShapeDXF.rotate = item.OutRotateRadian;

        // 添加此图例对象到户型图例数组；
        SoftList_Trainsitions.push(ShapeDXF);
        // console.log(ShapeDXF);
    });


    // 解析出长度标注线段：每一个行可能包含多个线段；
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

    parse_data.Room_Points = Room_Points;
    parse_data.SoftList_Points = SoftList_Points;
    parse_data.Dim_Points = Dim_Points;

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

