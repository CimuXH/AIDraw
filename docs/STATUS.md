# 项目当前状态

> 最后更新：2026-06-13

---

## 已实现功能

### 语音交互
- [x] Web Speech API 中文连续语音识别（`lang='zh-CN'`, `continuous=true`, `interimResults=true`）
- [x] interim 结果实时显示（灰色斜体），final 结果触发 `speech:final` 事件
- [x] 麦克风按钮：点击开/关，脉冲动画，状态指示（聆听中/处理中/就绪/未连接/重连中）
- [x] 监听超时/静默后自动恢复（300ms 后 restart）
- [x] 语音错误分类处理（no-speech / network / not-allowed / audio-capture）
- [x] TTS 中文语音合成，自动选择最佳中文语音，队列顺序播放不打断
- [x] 每次绘图操作后 TTS 播报确认（"已画好红色圆"）
- [x] 浏览器不支持时优雅降级提示

### NLU & 后端
- [x] Go + Gin 框架 WebSocket 服务（`/ws`）
- [x] DeepSeek v4-flash API 集成，使用官方 SDK（`go-deepseek/deepseek`）的 request/response 类型
- [x] System Prompt 完整设计：11 种图形参数定义、空间推理规则、14 种颜色映射、纠错规则、Few-shot 示例
- [x] User Prompt 自动拼接：画布尺寸 + 场景图谱上下文 + 用户指令
- [x] LLM 输出校验：action 名称规范化（`normalizeAction`），兼容 LLM 返回的各种变体（大小写/下划线/中文/别名）
- [x] Go 后端同时托管前端静态文件（`NoRoute` 兜底）
- [x] 配置从 `.env` 文件加载（API Key / Base URL / Model / Port）

### 前端通信
- [x] WebSocket 客户端：自动连接，断线指数退避重连（1s→2s→4s→...→30s）
- [x] NLU 请求发送 + 结果接收 + 事件派发
- [x] 并发保护：处理中来的新指令排队（最多存 1 条最新），处理完自动发排队指令

### 图形绘制
- [x] Canvas 1100×700，白色背景
- [x] 7 种基本形状：圆、矩形、三角形、直线、椭圆、五角星、心形
- [x] 4 种复合图形：太阳（圆+线）、房子（矩形+三角+矩形）、树（矩形+圆×3）、花（椭圆×5+圆+线）
- [x] 清空画布（本地命令 + LLM clearCanvas 两种方式）
- [x] **删除指定图形**：语音说"删除红色的圆" → LLM 返回 targetLabel → findByLabel → removeObject → 重绘
- [x] 全量重绘管线：清空 Canvas → 按 zIndex 遍历 SceneGraph → 逐个绘制
- [x] 填充/空心切换（"实心"、"空心"本地命令）
- [x] 颜色通过 LLM 指定（"画一个红色的圆"），默认黑色

### 场景图谱 + 持久化
- [x] SceneGraph 数据结构：id/type/label/bbox/center/color/fill/strokeWidth/parentId/zIndex/params/createdAt
- [x] addObject / removeObject（含级联）/ findByLabel / findByType / getAll / clear
- [x] toLLMContext() 序列化为 LLM 可读文本
- [x] **localStorage 持久化**：每次变更自动 save()，页面加载自动 load()
- [x] 刷新页面后自动重绘全部图形 + 恢复工具栏状态（颜色/粗细/填充）
- [x] localStorage 容错：存储满/隐私模式/数据损坏 均静默降级

### UI
- [x] 深色主题，三区布局（头栏 + Canvas + 识别日志）
- [x] 左侧 160px 功能面板：列出基本形状(7)、复合图形(4)、操作指令(4)
- [x] 空画布引导文字、识别日志滚动显示（最多 50 条）
- [x] 工具栏：麦克风按钮、状态指示灯、颜色色块、粗细值、填充状态、清空按钮
- [x] 响应式布局：小屏隐藏侧边栏

### 容错 & 鲁棒性
- [x] action 名称容错：精确表 → 关键词模糊 → unknown 兜底
- [x] LLM 返回空命令/unknown → TTS 播报"抱歉没听懂"
- [x] API Key 未配置 → 启动警告 + 请求时提示
- [x] 网络断开 → 自动重连 + 日志提示
- [x] DeepSeek API 超时/错误 → 返回 `nlu_error` + TTS 播报

### 代码结构
```
frontend/
├── index.html          # 入口
├── css/style.css       # 全部样式
└── js/
    ├── app.js          # 主控制器（命令分发、重绘、TTS反馈、并发控制、action规范化）
    ├── network.js      # WebSocket 客户端（连接/重连/收发）
    ├── speech/
    │   ├── recognizer.js   # STT
    │   └── synthesizer.js  # TTS
    ├── drawing/
    │   ├── canvas.js       # Canvas 初始化/清空
    │   ├── shapes.js       # 占位（绘制函数在 app.js 中）
    │   └── history.js      # 占位（撤销功能已删除）
    └── state/
        └── state.js        # SceneGraph + 工具状态 + localStorage 持久化

backend/
├── .env                # 配置
├── main.go             # 入口（Gin 路由）
├── config/config.go    # .env 加载
├── handler/ws.go       # WebSocket 处理
└── llm/client.go       # DeepSeek API 客户端 + Prompt
```

---

## 阶段六待实现

### 代码整理
- [ ] 将 app.js 中的 11 个 `drawXxxImpl` 绘制函数提取到 `js/drawing/shapes.js`
- [ ] app.js 中的 `drawObject()` 改为调用 `ShapeDrawer.draw(ctx, obj)`

### UI 打磨
- [ ] 头栏加颜色选择器（预设色板），让用户可通过语音切换颜色
- [ ] 头栏加线条粗细滑块或预设值按钮
- [ ] 识别日志增加时间戳
- [ ] 操作执行时 Canvas 区域加过渡动画或闪烁提示

### 可能的增强
- [ ] copy 指令：复制一个已有图形到新位置（需恢复 modifyObject 的部分逻辑）
- [ ] 画布导出 PNG（`canvas.toDataURL()`）

---

## 已删除/不实现的功能

| 功能 | 原因 |
|------|------|
| 撤销 | 用户要求删除 |
| modifyObject（改颜色/大小） | 用户要求删除 |
| 箭头（drawArrow） | 用户要求删除 |
| 笑脸（drawSmileFace） | 用户要求删除 |
| 示例指令面板 | 用户要求删除 |

---

## 启动方式

```bash
cd backend
go run main.go
# 浏览器打开 http://localhost:8080
```

## 关键代码位置速查

| 要找什么 | 在哪里 |
|----------|--------|
| DeepSeek Prompt | `backend/llm/client.go:buildSystemPrompt()` |
| NLU 请求处理 | `backend/handler/ws.go:handleNLURequest()` |
| 语音识别逻辑 | `frontend/js/speech/recognizer.js` |
| 命令分发 + 绘图执行 | `frontend/js/app.js:executeCommand()` |
| 画布全量重绘 | `frontend/js/app.js:redrawCanvas()` |
| 绘制函数实现 | `frontend/js/app.js:drawXxxImpl()` ×11 |
| SceneGraph 持久化 | `frontend/js/state/state.js:save()/load()` |
| toLLMContext 序列化 | `frontend/js/state/state.js:toLLMContext()` |
| WebSocket 客户端 | `frontend/js/network.js` |
| action 名称容错 | `frontend/js/app.js:normalizeAction()` |
| 并发排队逻辑 | `frontend/js/app.js:sendToNLU()/processPending()` |
