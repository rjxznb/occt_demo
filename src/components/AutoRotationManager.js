import * as THREE from 'three';

/**
 * 自动旋转管理器 - 处理用户无操作时的自动旋转功能
 */
export class AutoRotationManager {
    constructor(sceneManager, orbitControls) {
        this.sceneManager = sceneManager;
        this.orbitControls = orbitControls;
        
        // 配置参数
        this.idleTimeout = 5 * 60 * 1000; // 5分钟无操作时间（毫秒）
        this.rotationSpeed = 0.5; // 旋转速度（度/秒）
        
        // 状态管理
        this.isIdle = false;
        this.isRotating = false;
        this.lastActivityTime = Date.now();
        this.idleTimer = null;
        this.rotationAnimationId = null;
        
        // 旋转参数
        this.currentRotationAngle = 0;
        this.rotationRadius = null;
        this.rotationCenter = new THREE.Vector3();
        this.originalCameraPosition = new THREE.Vector3();
        this.originalTargetPosition = new THREE.Vector3();
        
        // 启动状态
        this.enabled = true;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.startIdleTimer();
        
        console.log('自动旋转管理器已初始化');
        console.log(`无操作超时时间: ${this.idleTimeout / 1000 / 60} 分钟`);
        console.log(`旋转速度: ${this.rotationSpeed} 度/秒`);
    }

    /**
     * 设置事件监听器监控用户活动
     */
    setupEventListeners() {
        // 需要监听的事件类型
        const events = [
            'mousedown', 'mousemove', 'mouseup', 'mousewheel', 'wheel',
            'keydown', 'keyup', 'keypress',
            'touchstart', 'touchmove', 'touchend',
            'pointerdown', 'pointermove', 'pointerup'
        ];

        // 绑定事件处理器
        this.activityHandler = this.onUserActivity.bind(this);
        this.interactionHandler = this.onUserInteraction.bind(this);
        
        // 用户交互事件（会停止自动旋转）
        events.forEach(eventType => {
            document.addEventListener(eventType, this.interactionHandler, { passive: true });
        });

        // OrbitControls开始事件（会停止自动旋转）
        if (this.orbitControls) {
            this.orbitControls.addEventListener('start', this.interactionHandler);
            // change事件仅用于重置空闲计时器，不停止旋转
            this.orbitControls.addEventListener('change', this.activityHandler);
        }

        console.log('用户活动监听器已设置');
    }

    /**
     * 处理用户活动（不停止自动旋转，仅重置计时器）
     */
    onUserActivity() {
        // 如果正在自动旋转，忽略由自动旋转导致的相机变化事件
        if (this.isRotating) {
            return;
        }
        
        const now = Date.now();
        this.lastActivityTime = now;
        
        // 重新设置为非空闲状态
        if (this.isIdle) {
            this.isIdle = false;
            console.log('用户重新活跃');
        }
        
        // 重新启动空闲计时器
        this.restartIdleTimer();
    }

    /**
     * 处理用户交互（会停止自动旋转）
     */
    onUserInteraction() {
        const now = Date.now();
        this.lastActivityTime = now;
        
        // 如果正在自动旋转，停止旋转
        if (this.isRotating) {
            console.log('检测到用户交互，停止自动旋转');
            this.stopAutoRotation();
        }
        
        // 重新设置为非空闲状态
        if (this.isIdle) {
            this.isIdle = false;
            console.log('用户重新活跃');
        }
        
        // 重新启动空闲计时器
        this.restartIdleTimer();
    }

    /**
     * 启动空闲计时器
     */
    startIdleTimer() {
        this.clearIdleTimer();
        
        this.idleTimer = setTimeout(() => {
            this.onIdleTimeout();
        }, this.idleTimeout);
    }

    /**
     * 重新启动空闲计时器
     */
    restartIdleTimer() {
        if (this.enabled) {
            this.startIdleTimer();
        }
    }

    /**
     * 清除空闲计时器
     */
    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * 空闲超时处理
     */
    onIdleTimeout() {
        if (!this.enabled) return;
        
        // 检查当前是否为2D视图，如果是则不启动自动旋转
        if (this.sceneManager && this.sceneManager.currentViewMode === '2d') {
            console.log('当前为2D视图，跳过自动旋转');
            this.isIdle = true;
            // 重新启动计时器，继续监控
            this.restartIdleTimer();
            return;
        }
        
        this.isIdle = true;
        console.log('用户空闲超时，开始自动旋转');
        this.startAutoRotation();
    }

    /**
     * 开始自动旋转
     */
    startAutoRotation() {
        if (this.isRotating || !this.enabled) return;
        
        console.log('开始自动旋转动画');
        this.isRotating = true;
        
        // 保存当前相机状态
        this.originalCameraPosition.copy(this.sceneManager.camera.position);
        this.originalTargetPosition.copy(this.orbitControls.target);
        
        // 计算旋转中心和半径
        this.rotationCenter.copy(this.orbitControls.target);
        this.rotationRadius = this.originalCameraPosition.distanceTo(this.rotationCenter);
        
        // 计算初始角度（绕Z轴旋转，在XY平面）
        const direction = new THREE.Vector3()
            .subVectors(this.originalCameraPosition, this.rotationCenter);
        // 使用XY平面的投影计算角度，确保绕Z轴旋转
        this.currentRotationAngle = Math.atan2(direction.y, direction.x);
        
        // 禁用OrbitControls避免冲突
        this.orbitControls.enabled = false;
        
        // 开始旋转动画
        this.rotationAnimationId = requestAnimationFrame(() => this.updateRotation());
        
        console.log('自动旋转已开始', {
            center: this.rotationCenter,
            radius: this.rotationRadius,
            initialAngle: this.currentRotationAngle * 180 / Math.PI
        });
    }

    /**
     * 更新旋转动画
     */
    updateRotation() {
        if (!this.isRotating || !this.enabled) {
            console.log('旋转停止:', { isRotating: this.isRotating, enabled: this.enabled });
            return;
        }
        
        // 计算旋转增量（度转弧度）
        const deltaTime = 1 / 60; // 假设60FPS
        const rotationDelta = (this.rotationSpeed * Math.PI / 180) * deltaTime;
        this.currentRotationAngle += rotationDelta;
        
        // 计算新的相机位置（在XY平面上绕Z轴旋转）
        // 使用当前相机到旋转中心的XY平面距离作为半径
        const xyDistance = Math.sqrt(
            Math.pow(this.originalCameraPosition.x - this.rotationCenter.x, 2) + 
            Math.pow(this.originalCameraPosition.y - this.rotationCenter.y, 2)
        );
        
        const newX = this.rotationCenter.x + Math.cos(this.currentRotationAngle) * xyDistance;
        const newY = this.rotationCenter.y + Math.sin(this.currentRotationAngle) * xyDistance;
        const newZ = this.originalCameraPosition.z; // 保持原有高度
        
        // 更新相机位置
        this.sceneManager.camera.position.set(newX, newY, newZ);
        this.sceneManager.camera.lookAt(this.rotationCenter);
        
        // 继续动画 - 确保持续调用
        if (this.isRotating) {
            this.rotationAnimationId = requestAnimationFrame(() => this.updateRotation());
        }
    }

    /**
     * 停止自动旋转
     */
    stopAutoRotation() {
        if (!this.isRotating) return;
        
        console.log('停止自动旋转');
        this.isRotating = false;
        
        // 取消动画帧
        if (this.rotationAnimationId) {
            cancelAnimationFrame(this.rotationAnimationId);
            this.rotationAnimationId = null;
        }
        
        // 重新启用OrbitControls
        this.orbitControls.enabled = true;
        
        // 清除空闲计时器并重新开始
        this.restartIdleTimer();
    }

    /**
     * 启用/禁用自动旋转功能
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (!enabled) {
            // 禁用时停止所有相关功能
            this.stopAutoRotation();
            this.clearIdleTimer();
            this.isIdle = false;
            console.log('自动旋转功能已禁用');
        } else {
            // 启用时重新开始监控
            this.onUserActivity(); // 重置活动时间
            console.log('自动旋转功能已启用');
        }
    }

    /**
     * 设置空闲超时时间
     * @param {number} minutes - 分钟数
     */
    setIdleTimeout(minutes) {
        this.idleTimeout = minutes * 60 * 1000;
        console.log(`空闲超时时间已设置为: ${minutes} 分钟`);
        
        // 如果当前有计时器在运行，重新启动
        if (this.idleTimer) {
            this.restartIdleTimer();
        }
    }

    /**
     * 设置旋转速度
     * @param {number} degreesPerSecond - 每秒旋转角度
     */
    setRotationSpeed(degreesPerSecond) {
        this.rotationSpeed = degreesPerSecond;
        console.log(`旋转速度已设置为: ${degreesPerSecond} 度/秒`);
    }

    /**
     * 获取当前状态信息
     * @returns {Object} 状态信息
     */
    getStatus() {
        const timeSinceLastActivity = Date.now() - this.lastActivityTime;
        const timeUntilIdle = Math.max(0, this.idleTimeout - timeSinceLastActivity);
        
        return {
            enabled: this.enabled,
            isIdle: this.isIdle,
            isRotating: this.isRotating,
            timeSinceLastActivity: Math.floor(timeSinceLastActivity / 1000),
            timeUntilIdle: Math.floor(timeUntilIdle / 1000),
            rotationSpeed: this.rotationSpeed,
            idleTimeoutMinutes: this.idleTimeout / 1000 / 60
        };
    }

    /**
     * 手动触发自动旋转（用于测试）
     */
    triggerAutoRotation() {
        console.log('手动触发自动旋转');
        this.onIdleTimeout();
    }

    /**
     * 销毁管理器，清理资源
     */
    destroy() {
        console.log('销毁自动旋转管理器');
        
        // 停止旋转
        this.stopAutoRotation();
        
        // 清除计时器
        this.clearIdleTimer();
        
        // 移除事件监听器
        const events = [
            'mousedown', 'mousemove', 'mouseup', 'mousewheel', 'wheel',
            'keydown', 'keyup', 'keypress',
            'touchstart', 'touchmove', 'touchend',
            'pointerdown', 'pointermove', 'pointerup'
        ];
        
        events.forEach(eventType => {
            document.removeEventListener(eventType, this.interactionHandler);
        });
        
        // 移除OrbitControls监听器
        if (this.orbitControls) {
            if (this.interactionHandler) {
                this.orbitControls.removeEventListener('start', this.interactionHandler);
            }
            if (this.activityHandler) {
                this.orbitControls.removeEventListener('change', this.activityHandler);
            }
        }
        
        // 清理引用
        this.sceneManager = null;
        this.orbitControls = null;
        this.activityHandler = null;
        this.interactionHandler = null;
    }
    
    /**
     * 兼容性方法，与其他管理器保持一致的命名
     */
    dispose() {
        this.destroy();
    }
}