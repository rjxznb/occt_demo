import * as THREE from 'three';

/**
 * SVGLoader - 从KeMagic项目移植的SVG加载器
 * 用于将SVG转换为Three.js的ShapePath
 */
export class SVGLoader {
    constructor() {
        this.defaultDPI = 90;
        this.defaultUnit = 'px';
    }

    parse(svgText) {
        console.log('=== SVGLoader 解析开始 ===');
        console.log('- SVG内容长度:', svgText.length);
        
        // 创建DOM解析器
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svg = doc.querySelector('svg');

        if (!svg) {
            console.error('❌ 无效的SVG内容');
            throw new Error('Invalid SVG content');
        }

        const paths = [];
        const xml = svg;

        // 解析SVG路径
        const pathElements = svg.querySelectorAll('path');
        const lineElements = svg.querySelectorAll('line');
        const polylineElements = svg.querySelectorAll('polyline');
        const polygonElements = svg.querySelectorAll('polygon');
        const circleElements = svg.querySelectorAll('circle');
        const ellipseElements = svg.querySelectorAll('ellipse');
        const rectElements = svg.querySelectorAll('rect');
        
        console.log('- SVG元素统计:');
        console.log(`  path: ${pathElements.length}`);
        console.log(`  line: ${lineElements.length}`);
        console.log(`  polyline: ${polylineElements.length}`);
        console.log(`  polygon: ${polygonElements.length}`);
        console.log(`  circle: ${circleElements.length}`);
        console.log(`  ellipse: ${ellipseElements.length}`);
        console.log(`  rect: ${rectElements.length}`);

        let successCount = 0;
        let failCount = 0;

        // 处理path元素
        pathElements.forEach((pathElement, index) => {
            try {
                const shapePath = this.parsePath(pathElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`path元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`path元素${index}解析出错:`, error.message);
            }
        });

        // 处理line元素
        lineElements.forEach((lineElement, index) => {
            try {
                const shapePath = this.parseLine(lineElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`line元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`line元素${index}解析出错:`, error.message);
            }
        });

        // 处理polyline元素
        polylineElements.forEach((polylineElement, index) => {
            try {
                const shapePath = this.parsePolyline(polylineElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`polyline元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`polyline元素${index}解析出错:`, error.message);
            }
        });

        // 处理polygon元素
        polygonElements.forEach((polygonElement, index) => {
            try {
                const shapePath = this.parsePolygon(polygonElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`polygon元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`polygon元素${index}解析出错:`, error.message);
            }
        });

        // 处理circle元素
        circleElements.forEach((circleElement, index) => {
            try {
                const shapePath = this.parseCircle(circleElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`circle元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`circle元素${index}解析出错:`, error.message);
            }
        });

        // 处理ellipse元素
        ellipseElements.forEach((ellipseElement, index) => {
            try {
                const shapePath = this.parseEllipse(ellipseElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`ellipse元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`ellipse元素${index}解析出错:`, error.message);
            }
        });

        // 处理rect元素
        rectElements.forEach((rectElement, index) => {
            try {
                const shapePath = this.parseRect(rectElement);
                if (shapePath) {
                    paths.push(shapePath);
                    successCount++;
                } else {
                    failCount++;
                    console.warn(`rect元素${index}解析失败`);
                }
            } catch (error) {
                failCount++;
                console.warn(`rect元素${index}解析出错:`, error.message);
            }
        });

        console.log('- SVG解析结果:');
        console.log(`  成功: ${successCount} 个路径`);
        console.log(`  失败: ${failCount} 个路径`);
        console.log('========================');

        return { paths, xml };
    }

    parsePath(pathElement) {
        const d = pathElement.getAttribute('d');
        if (!d) return null;

        const shapePath = new THREE.ShapePath();
        
        // 简化的路径解析 - 处理基本的M, L, Z命令
        const commands = d.match(/[MLZmlz][^MLZmlz]*/gi);
        if (!commands) return null;

        let currentPoint = new THREE.Vector2(0, 0);

        commands.forEach(command => {
            const type = command[0];
            const coords = command.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));

            switch (type.toLowerCase()) {
                case 'm': // moveTo
                    if (coords.length >= 2) {
                        if (type === 'M') {
                            // 绝对坐标
                            currentPoint.set(coords[0], coords[1]);
                        } else {
                            // 相对坐标
                            currentPoint.add(new THREE.Vector2(coords[0], coords[1]));
                        }
                        shapePath.moveTo(currentPoint.x, currentPoint.y);
                    }
                    break;

                case 'l': // lineTo
                    for (let i = 0; i < coords.length; i += 2) {
                        if (i + 1 < coords.length) {
                            if (type === 'L') {
                                // 绝对坐标
                                currentPoint.set(coords[i], coords[i + 1]);
                            } else {
                                // 相对坐标
                                currentPoint.add(new THREE.Vector2(coords[i], coords[i + 1]));
                            }
                            shapePath.lineTo(currentPoint.x, currentPoint.y);
                        }
                    }
                    break;

                case 'z': // closePath
                    shapePath.closePath();
                    break;
            }
        });

        return shapePath;
    }

    parseLine(lineElement) {
        const x1 = parseFloat(lineElement.getAttribute('x1') || '0');
        const y1 = parseFloat(lineElement.getAttribute('y1') || '0');
        const x2 = parseFloat(lineElement.getAttribute('x2') || '0');
        const y2 = parseFloat(lineElement.getAttribute('y2') || '0');

        const shapePath = new THREE.ShapePath();
        shapePath.moveTo(x1, y1);
        shapePath.lineTo(x2, y2);

        return shapePath;
    }

    parsePolyline(polylineElement) {
        const points = polylineElement.getAttribute('points');
        if (!points) return null;

        const coords = points.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        if (coords.length < 4) return null;

        const shapePath = new THREE.ShapePath();
        shapePath.moveTo(coords[0], coords[1]);

        for (let i = 2; i < coords.length; i += 2) {
            if (i + 1 < coords.length) {
                shapePath.lineTo(coords[i], coords[i + 1]);
            }
        }

        return shapePath;
    }

    parsePolygon(polygonElement) {
        const points = polygonElement.getAttribute('points');
        if (!points) return null;

        const coords = points.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        if (coords.length < 6) return null;

        const shapePath = new THREE.ShapePath();
        shapePath.moveTo(coords[0], coords[1]);

        for (let i = 2; i < coords.length; i += 2) {
            if (i + 1 < coords.length) {
                shapePath.lineTo(coords[i], coords[i + 1]);
            }
        }

        shapePath.closePath();
        return shapePath;
    }

    parseCircle(circleElement) {
        const cx = parseFloat(circleElement.getAttribute('cx') || '0');
        const cy = parseFloat(circleElement.getAttribute('cy') || '0');
        const r = parseFloat(circleElement.getAttribute('r') || '0');

        if (r <= 0) return null;

        const shapePath = new THREE.ShapePath();
        shapePath.absarc(cx, cy, r, 0, Math.PI * 2, false);

        return shapePath;
    }

    parseEllipse(ellipseElement) {
        const cx = parseFloat(ellipseElement.getAttribute('cx') || '0');
        const cy = parseFloat(ellipseElement.getAttribute('cy') || '0');
        const rx = parseFloat(ellipseElement.getAttribute('rx') || '0');
        const ry = parseFloat(ellipseElement.getAttribute('ry') || '0');

        if (rx <= 0 || ry <= 0) return null;

        const shapePath = new THREE.ShapePath();
        shapePath.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0);

        return shapePath;
    }

    parseRect(rectElement) {
        const x = parseFloat(rectElement.getAttribute('x') || '0');
        const y = parseFloat(rectElement.getAttribute('y') || '0');
        const width = parseFloat(rectElement.getAttribute('width') || '0');
        const height = parseFloat(rectElement.getAttribute('height') || '0');

        if (width <= 0 || height <= 0) return null;

        const shapePath = new THREE.ShapePath();
        shapePath.moveTo(x, y);
        shapePath.lineTo(x + width, y);
        shapePath.lineTo(x + width, y + height);
        shapePath.lineTo(x, y + height);
        shapePath.closePath();

        return shapePath;
    }
}