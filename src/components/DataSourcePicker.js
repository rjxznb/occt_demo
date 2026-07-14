import ParseJson from '../utils/json_parse.js';
import { freestyle } from '../config/freestyle.js';
import { BundledDataSource, LocalFileDataSource } from '../core/DataSource.js';

/**
 * 启动时的数据选择界面
 *
 * 户型 JSON 与 parsed_dxf 目录是配套的：软装几何文件名里的序号就是该软装在
 * soft_list 里的下标，所以两者必须来自同一次解析。选错了不会报错，只会大面积
 * 缺图。因此这里在渲染前先做一次配套校验，把缺失的文件当场列出来。
 */
export class DataSourcePicker {
    constructor() {
        this.overlay = null;
        this.resolve = null;

        this.drawingFile = null;
        this.softlistFiles = new Map();  // id → File
    }

    /**
     * 显示选择界面，返回用户选定的数据源
     * @returns {Promise<BundledDataSource|LocalFileDataSource>}
     */
    show() {
        this.injectStyles();
        this.render();

        return new Promise(resolve => {
            this.resolve = resolve;
        });
    }

    finish(dataSource) {
        this.overlay?.remove();
        this.overlay = null;
        this.resolve?.(dataSource);
    }

    render() {
        const overlay = document.createElement('div');
        overlay.className = 'dsp-overlay';
        overlay.innerHTML = `
            <div class="dsp-card">
                <h1>OCCT 户型图可视化</h1>
                <p class="dsp-sub">选择要渲染的户型数据</p>

                <div class="dsp-section">
                    <div class="dsp-row">
                        <div class="dsp-label">
                            <strong>户型 JSON</strong>
                            <span>房间、门窗与软装清单</span>
                        </div>
                        <button class="dsp-btn" id="dsp-pick-drawing">选择文件…</button>
                    </div>
                    <div class="dsp-status" id="dsp-drawing-status">未选择</div>

                    <div class="dsp-row">
                        <div class="dsp-label">
                            <strong>parsed_dxf 几何</strong>
                            <span>软装/门窗图例，须与上面的 JSON 配套产出</span>
                        </div>
                        <div class="dsp-btn-group">
                            <button class="dsp-btn" id="dsp-pick-dir">选择目录…</button>
                            <button class="dsp-btn" id="dsp-pick-files">选择文件…</button>
                        </div>
                    </div>
                    <div class="dsp-status" id="dsp-softlist-status">未选择</div>

                    <div class="dsp-check" id="dsp-check"></div>

                    <button class="dsp-btn dsp-primary" id="dsp-render" disabled>渲染</button>
                </div>

                <div class="dsp-or"><span>或</span></div>

                <button class="dsp-btn dsp-ghost" id="dsp-bundled">使用内置示例数据</button>

                <p class="dsp-note">
                    不需要原始 <code>.dxf</code>：软装几何是解析器按每个实例的宽/长
                    参数化拉伸后的产物，浏览器无法从 DXF 自行还原。
                </p>
            </div>

            <input type="file" id="dsp-drawing-input" accept=".json" hidden>
            <input type="file" id="dsp-dir-input" webkitdirectory directory multiple hidden>
            <input type="file" id="dsp-files-input" accept=".json" multiple hidden>
        `;

        document.body.appendChild(overlay);
        this.overlay = overlay;

        const $ = id => overlay.querySelector('#' + id);

        $('dsp-pick-drawing').onclick = () => $('dsp-drawing-input').click();
        $('dsp-pick-dir').onclick = () => $('dsp-dir-input').click();
        $('dsp-pick-files').onclick = () => $('dsp-files-input').click();

        $('dsp-drawing-input').onchange = e => {
            const file = e.target.files[0];
            if (file) {
                this.drawingFile = file;
                $('dsp-drawing-status').textContent = file.name;
                $('dsp-drawing-status').classList.add('ok');
                this.validate();
            }
        };

        const onSoftlistFiles = e => {
            this.softlistFiles = new Map();
            for (const file of e.target.files) {
                if (file.name.endsWith('.json')) {
                    this.softlistFiles.set(file.name.replace(/\.json$/, ''), file);
                }
            }
            $('dsp-softlist-status').textContent = `${this.softlistFiles.size} 个 JSON 文件`;
            $('dsp-softlist-status').classList.add('ok');
            this.validate();
        };

        $('dsp-dir-input').onchange = onSoftlistFiles;
        $('dsp-files-input').onchange = onSoftlistFiles;

        $('dsp-render').onclick = () => {
            this.finish(new LocalFileDataSource(this.drawingFile, this.softlistFiles));
        };

        $('dsp-bundled').onclick = () => {
            this.finish(new BundledDataSource());
        };
    }

    /**
     * 校验 JSON 与 parsed_dxf 是否配套：把 JSON 解析出的软装 id 逐个对到文件上，
     * 列出缺失项。freestyle（自由绘制）软装的几何来自 JSON 本身，不需要文件。
     */
    async validate() {
        const check = this.overlay.querySelector('#dsp-check');
        const renderBtn = this.overlay.querySelector('#dsp-render');

        if (!this.drawingFile) {
            check.innerHTML = '';
            renderBtn.disabled = true;
            return;
        }

        let parsed;
        try {
            parsed = ParseJson(JSON.parse(await this.drawingFile.text()));
        } catch (error) {
            check.className = 'dsp-check bad';
            check.innerHTML = `无法解析该 JSON：${error.message}`;
            renderBtn.disabled = true;
            return;
        }

        const rooms = parsed.Room_Points?.length ?? 0;
        const doors = parsed.door_list?.length ?? 0;
        const windows = parsed.window_list?.length ?? 0;
        const softlists = parsed.SoftLists ?? [];

        // 需要几何文件的软装（freestyle 的点数据在 JSON 里，不查文件）
        const needFile = softlists.filter(s => !(s.id.split('_')[0] in freestyle));
        const missing = needFile.filter(s => !this.softlistFiles.has(s.id));

        const summary = `户型：${rooms} 房间 · ${doors} 门 · ${windows} 窗 · ${softlists.length} 软装`;

        if (needFile.length === 0) {
            check.className = 'dsp-check ok';
            check.innerHTML = `${summary}<br>无需软装几何文件，可直接渲染。`;
            renderBtn.disabled = false;
            return;
        }

        if (this.softlistFiles.size === 0) {
            check.className = 'dsp-check warn';
            check.innerHTML = `${summary}<br>有 ${needFile.length} 个软装需要几何文件，请选择 parsed_dxf 目录。`;
            renderBtn.disabled = true;
            return;
        }

        if (missing.length === 0) {
            check.className = 'dsp-check ok';
            check.innerHTML = `${summary}<br>${needFile.length} 个软装几何全部匹配，数据配套。`;
            renderBtn.disabled = false;
        } else {
            const sample = missing.slice(0, 5).map(s => `${s.id}.json`).join('、');
            const more = missing.length > 5 ? ` 等 ${missing.length} 个` : '';
            check.className = 'dsp-check warn';
            check.innerHTML = `
                ${summary}<br>
                缺少 ${missing.length}/${needFile.length} 个软装几何：${sample}${more}<br>
                <span class="dsp-hint">这通常说明该目录与这份 JSON 不是同一次解析产出的。仍可渲染，缺失的软装会被跳过。</span>
            `;
            renderBtn.disabled = false;
        }
    }

    injectStyles() {
        if (document.getElementById('dsp-styles')) return;

        const style = document.createElement('style');
        style.id = 'dsp-styles';
        style.textContent = `
            .dsp-overlay {
                position: fixed; inset: 0; z-index: 9999;
                display: flex; align-items: center; justify-content: center;
                background: #1a1a1a;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #e8e8e8;
            }
            .dsp-card {
                width: 520px; max-width: 92vw;
                background: #242424;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px;
                padding: 32px;
            }
            .dsp-card h1 { font-size: 20px; font-weight: 600; margin: 0; }
            .dsp-sub { margin: 6px 0 24px; font-size: 13px; color: #9a9a9a; }

            .dsp-section {
                background: #1c1c1c;
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 8px;
                padding: 16px;
            }
            .dsp-row {
                display: flex; align-items: center; justify-content: space-between;
                gap: 16px; margin-bottom: 6px;
            }
            .dsp-label strong { display: block; font-size: 14px; font-weight: 500; }
            .dsp-label span { font-size: 12px; color: #8a8a8a; }

            .dsp-status {
                font-size: 12px; color: #6a6a6a; margin: 0 0 16px;
                padding-left: 2px;
            }
            .dsp-status.ok { color: #7ec699; }

            .dsp-check {
                font-size: 12px; line-height: 1.6;
                border-radius: 6px; padding: 10px 12px; margin-bottom: 14px;
            }
            .dsp-check:empty { display: none; }
            .dsp-check.ok   { background: rgba(126,198,153,0.1); color: #7ec699; }
            .dsp-check.warn { background: rgba(230,180,80,0.1);  color: #e6b450; }
            .dsp-check.bad  { background: rgba(230,100,100,0.1); color: #e66464; }
            .dsp-hint { color: #8a8a8a; }

            .dsp-btn {
                background: #333; color: #e8e8e8;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px;
                padding: 8px 16px; font-size: 13px; cursor: pointer;
                white-space: nowrap;
            }
            .dsp-btn:hover:not(:disabled) { background: #3d3d3d; }
            .dsp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
            .dsp-btn-group { display: flex; gap: 6px; }

            .dsp-primary {
                width: 100%; background: #e8672c; border-color: transparent;
                font-weight: 500; padding: 10px;
            }
            .dsp-primary:hover:not(:disabled) { background: #f2743a; }

            .dsp-ghost { width: 100%; padding: 10px; }

            .dsp-or {
                display: flex; align-items: center; gap: 12px;
                margin: 20px 0; font-size: 12px; color: #6a6a6a;
            }
            .dsp-or::before, .dsp-or::after {
                content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08);
            }

            .dsp-note {
                margin: 20px 0 0; font-size: 11px; line-height: 1.7; color: #7a7a7a;
            }
            .dsp-note code {
                background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px;
            }
        `;
        document.head.appendChild(style);
    }
}
