# AI 语音绘图工具 — 开发计划文档

## 开发哲学：关键路径优先

核心链路：**用户说话 → 语音识别 → 图谱上下文 + 文字 → Go 后端 → DeepSeek NLU → 绘图命令 → Canvas 绘制**

先让一句话能变成画面上的一个图形，再逐步丰富形状种类、修改能力、UI 打磨。每一步完成后都能看到可运行的结果。

---

## 阶段一：听见用户 — Web Speech API 语音识别

### 目标
浏览器能听懂中文，实时显示识别文字，拿到最终识别结果。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| S1 | SpeechRecognition 基础封装 | 创建 `SpeechRecognition` 实例，`lang='zh-CN'`，`continuous=true`，`interimResults=true`。封装 start/stop 方法 | `js/speech/recognizer.js` |
| S2 | interim 结果实时显示 | `onresult` 中 `isFinal=false` 时，把文字显示到页面上（灰色/斜体），让用户看到"正在听" | 页面能实时显示识别中的文字 |
| S3 | final 结果事件派发 | `isFinal=true` 时，派发自定义事件 `speech:final`，携带完整识别文本。这是后续串联的入口 | 说完一句话，控制台打印 `[speech:final] 画一个红色的圆` |
| S4 | 自动恢复监听 | `onend` 中自动重新 start（除非用户点了停止）。处理 `no-speech`、`aborted`、`network`、`not-allowed` 等错误 | 停止说话后仍能继续识别 |
| S5 | 麦克风按钮 | 页面放置一个麦克风按钮，点击切换开/关，带状态显示 | 可点击控制 |

### 验证标准
打开 Chrome，点击麦克风，说话 → 页面上出现识别文字，停止说话后再说话 → 仍然能识别。

---

## 阶段二：理解意图 — DeepSeek NLU + Prompt 设计

### 目标
Go 后端接收文字，带上场景上下文，调用 DeepSeek，返回结构化的绘图命令 JSON。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| D1 | Go 项目初始化 | `go mod init aidraw-server`，安装 `gorilla/websocket` | `server/go.mod` |
| D2 | DeepSeek API 客户端 | 封装 `POST https://api.deepseek.com/v1/chat/completions`，`model: deepseek-chat`，`response_format: {type: "json_object"}`，API Key 从环境变量读取 | `server/llm/client.go` |
| D3 | System Prompt 设计 | 定义角色、输出 JSON Schema、画布尺寸、空间推理规则、纠错规则（"云"→"圆"）。包含 few-shot 示例 | Prompt 模板字符串 |
| D4 | User Prompt 构建 | 拼接：画布尺寸 + 场景图谱上下文（首次为空）+ 用户原始语音文字 | 完整的 User Message |
| D5 | 响应解析 + 校验 | 解析 DeepSeek 返回的 JSON，提取 `commands[]`，校验 action 合法、坐标不越界。异常时返回 `unknown` | 函数 `CallDeepSeek(sceneContext, userText) -> []Command` |

### System Prompt 核心内容

```
你是语音绘图命令解析器。用户说中文，你输出 JSON。

画布尺寸：800×600 像素，坐标原点在左上角。

输出格式：
{
  "commands": [
    {
      "action": "drawCircle|drawRectangle|drawTriangle|drawLine|drawEllipse|drawStar|drawHeart|drawArrow|drawSun|drawHouse|drawTree|drawFlower|drawSmileFace|modifyObject|deleteObject|clearCanvas|unknown",
      "label": "中文简短描述",
      "x": 数字, "y": 数字,
      ...  // 不同 action 不同参数
    }
  ]
}

规则：
- 位置默认在画布中央(400,300)，除非用户指定或需要避开已有图形
- "在X右边"：新图形 x = X右边界 + 间距
- 颜色用十六进制：#FF0000红/#0000FF蓝/#008000绿/#FFFF00黄/#000000黑/#FFFFFF白
- 用户说"云"有可能是"圆"的口音，结合上下文判断
- 如果指令不包含绘图意图，用 action:"unknown"
```

### 验证标准
写一个简单 Go test，传入 `"画一个红色的圆"`，打印返回的 JSON，确认包含 `{"action":"drawCircle","x":400,"y":300,"color":"#FF0000",...}`。

---

## 阶段三：前后端连线 — WebSocket 通信

### 目标
前端把 `(场景图谱上下文 + 用户语音文字)` 发给后端，后端返回绘图命令，前端收到。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| N1 | Go WebSocket 服务 | `main.go` 启动 HTTP 服务，`/ws` 路由升级为 WebSocket。Hub 管理连接 | `server/main.go`, `server/handler/ws.go` |
| N2 | 消息处理循环 | 接收前端 `nlu_request` JSON → 调用 DeepSeek → 包装为 `nlu_result` JSON → 返回前端。超时 15s 返回 `nlu_error` | 完整的消息收发逻辑 |
| N3 | 前端 WebSocket 客户端 | 连接 `ws://localhost:8080/ws`，`send(msg)` / `onmessage` 事件派发。断线自动重连（指数退避） | `js/network.js` |

### 消息协议

**前端 → 后端：**
```json
{
  "type": "nlu_request",
  "id": "req_001",
  "text": "在正方形右边画一个三角形",
  "sceneContext": "画布尺寸:800×600\n已绘制1个图形:\n1. 矩形'正方形' bbox(x:350,y:250,w:100,h:100)..."
}
```

**后端 → 前端：**
```json
{
  "type": "nlu_result",
  "id": "req_001",
  "commands": [{"action":"drawTriangle", "label":"三角形", "x":520, "y":300, "size":80, ...}]
}
```

### 验证标准
前端发送测试文字 → 后端返回命令 → 前端控制台打印收到的命令。断线 → 重启后端 → 自动重连。

---

## 阶段四：画出来 — Canvas 绘图引擎

### 目标
收到绘图命令后，在 Canvas 上画出对应的图形。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| C1 | Canvas 初始化 | 800×600 Canvas 居中显示，获取 2D 上下文。自适应缩放 | `js/drawing/canvas.js` |
| C2 | 命令分发器 | `action → drawXxx()` 映射表。每个 action 从 commands JSON 提取参数，调用对应绘制函数 | `js/app.js` 核心逻辑 |
| C3 | 8 种基本形状绘制 | 圆、矩形、三角形、直线、椭圆、五角星、心形、箭头。每个函数接收 `(ctx, params)` | `js/drawing/shapes.js` |
| C4 | 5 种复合图形绘制 | 太阳、房子、树、花、笑脸。每个由多个基本形状组合 | `js/drawing/shapes.js` |

### 命令执行流程
```
收到 nlu_result
  → 遍历 commands[]
    → action 映射到 drawXxx(ctx, params)
    → 图形出现在 Canvas 上
```

### 验证标准
收到 `{"action":"drawCircle","x":400,"y":300,"radius":50,"color":"#FF0000","fill":true}` → Canvas 正中央出现红色实心圆。

---

## 阶段五：记住画了什么 — 场景图谱 (Scene Graph)

### 目标
图形绘制后注册到图谱，为后续空间推理提供上下文。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| G1 | SceneGraph 数据结构 | `objects[]` 数组，每个对象含 id/type/label/bbox/center/color/fill/strokeWidth/zIndex/params | `js/state/state.js` |
| G2 | addObject | 绘制完成后调用，自动生成 id、计算 bbox/center、分配 zIndex | 图谱累积记录 |
| G3 | toLLMContext | 序列化为发给 DeepSeek 的文本：列出每个图形的类型、label、位置、颜色、大小 | 文本描述字符串 |
| G4 | removeObject + 级联删除 | 按 id 删除，parentId 关联的子图形一并删除 | 删除房子时屋顶和门也删 |
| G5 | localStorage 持久化 | load() 恢复 + sync() 同步，try-catch 包裹防止隐私模式报错 | 刷新页面图形不丢失 |

### toLLMContext 输出格式
```
画布尺寸:800×600
已绘制2个图形:
1. 矩形'蓝色正方形'(obj_001) bbox(x:350,y:250,w:100,h:100) 中心(400,300) 颜色:#0000FF 空心 线宽3
2. 圆形'红色太阳'(obj_002) bbox(x:340,y:200,w:120,h:120) 中心(400,260) 半径60 颜色:#FF0000 实心
```

### 验证标准
画两个图形 → 调用 toLLMContext() → 输出包含两个图形的完整信息 → 发送给 DeepSeek → LLM 能根据上下文正确推理"在正方形右边"。

---

## 阶段六：撤销 — 像素快照

### 目标
用户说"撤销"，画面回到上一步。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| U1 | saveSnapshot | 每次执行命令前，`ctx.getImageData(0,0,w,h)` 保存完整像素快照 | `js/drawing/history.js` |
| U2 | undo | `ctx.putImageData(snapshot,0,0)` 恢复画面 + `SceneGraph.objects.pop()` 移除最后对象 | undo 一个操作 |
| U3 | 与语音串联 | "撤销"/"撤回"作为本地快捷命令，不经过 LLM，直接调用 undo() | 说"撤销"→瞬间还原 |

### 验证标准
画一个圆 → 画一个矩形 → 说"撤销" → 矩形消失 → 再说"撤销" → 提示"无法撤销"（因为快照已消耗）。

---

## 阶段七：端到端串联 — 完整闭环

### 目标
把 S1→D5→N3→C4→G5→U3 全部串起来，一句话从麦克风到 Canvas。

### 任务清单

| 编号 | 任务 | 细节 | 产出 |
|------|------|------|------|
| E1 | 主流程串联 | speech:final → get toLLMContext() → network.send() → receive nlu_result → saveSnapshot() → command dispatcher → drawXxx() → addObject() → sync() → TTS 反馈 | `js/app.js` |
| E2 | TTS 语音反馈 | 每次操作后用 Web Speech Synthesis 播报中文确认 | `js/speech/synthesizer.js` |
| E3 | 并发请求保护 | 上一个 NLU 请求未返回时，新识别结果排队（最多 1 个） | 快速说话不混乱 |
| E4 | 本地快捷命令 | "撤销"/"撤回"、"清除"/"清空"、"实心"/"填充"、"空心"/"描边" 本地直接执行，不经过 LLM | 这些命令 <50ms 响应 |
| E5 | LLM 输出校验 | 坐标 clamp 到 0-800/0-600，颜色格式校验，action 名称校验 | 畸形返回不崩溃 |

### 完整数据流
```
[用户] "画一个红色的圆"
  → [STT] 识别文字
  → [SceneGraph] 获取当前画布上下文（可能为空）
  → [WebSocket] 发送 {text, sceneContext}
  → [Go 后端] 构建 Prompt
  → [DeepSeek] 返回 {commands: [{action:"drawCircle",...}]}
  → [Go 后端] 转发 nlu_result
  → [WebSocket] 收到命令
  → [History] saveSnapshot()
  → [Dispatcher] action="drawCircle" → drawCircle(ctx, 400, 300, 50, "#FF0000", true, 3)
  → [SceneGraph] addObject({type:"circle", label:"红色圆", color:"#FF0000", ...})
  → [TTS] 播报 "已画好一个红色圆"
```

---

## 阶段八：图形修改能力

### 目标
不只画新图，还能改已有的。

### 任务清单

| 编号 | 任务 | 细节 |
|------|------|------|
| M1 | modifyObject（改颜色） | "把三角形涂成蓝色" → LLM 返回 targetLabel + changes {color} → 前端按 label 模糊匹配找到对象 → 更新 color → 全量重绘 Canvas |
| M2 | modifyObject（改大小） | "把那个圆放大一倍" → LLM 返回新的 radius → 更新 params → 重绘 |
| M3 | modifyObject（改填充） | "太阳改成空心的" → 更新 fill → 重绘 |
| M4 | deleteObject | "把红色的圆删掉" → 按 label 匹配 → removeObject（含级联）→ 全量重绘 |
| M5 | clearCanvas | "清空画布" → 本地快捷命令，clear() + 重置图谱 + 清空快照 |

### 全量重绘策略
修改/删除后不局部更新，而是：清空 Canvas → 遍历 `SceneGraph.getAll()` → 逐个重绘。简单可靠。

---

## 阶段九：UI 打磨

### 任务清单

| 编号 | 任务 | 细节 |
|------|------|------|
| UI1 | 深色主题 | 全局暗色背景、面板样式、按钮样式 |
| UI2 | 状态指示器 | 🔴聆听中 / 🟡暂停 / 🟠处理中，三色+文字 |
| UI3 | 当前工具状态 | 头栏显示颜色色块、粗细值、填充开关状态 |
| UI4 | 识别/命令日志 | 底部面板滚动显示历史，每条 🎤→✅→🔊 |
| UI5 | 空画布引导文字 | "🎤 点击麦克风，开始说话绘画" |
| UI6 | 错误提示 Toast | 网络断开、API 超时、不支持浏览器 |

---

## 阶段十：集成测试 + 文档

### 任务清单

| 编号 | 任务 |
|------|------|
| T1 | 全形状测试：逐一测试 8+5 种图形的语音绘制 |
| T2 | 空间关联测试："在 X 右边/左边/上面/下面" |
| T3 | 修改/删除测试：改颜色、改大小、删除指定图形 |
| T4 | 异常测试：快速连续说话、断网、说无关内容 |
| T5 | 编写 README.md（使用说明 + 命令速查表） |
| T6 | 定稿 design.md（记录实现 vs 计划差异） |

---

## 阶段概览

```
阶段一 ████ 语音识别      ← 先能听到用户说什么
阶段二 ████ LLM 理解       ← 把文字变成结构化命令
阶段三 ████ WebSocket 连线 ← 打通前后端
阶段四 ████ Canvas 绘制    ← 命令变成画面
阶段五 ████ 场景图谱       ← 记住画了什么
阶段六 ████ 撤销           ← 能回退一步
阶段七 ████ 端到端串联     ← 全部连起来，一句话出图！ ← 里程碑
阶段八 ████ 图形修改       ← 不仅能画，还能改
阶段九 ████ UI 打磨        ← 好看好用
阶段十 ████ 测试 + 文档    ← 交付
```

阶段七完成时，核心闭环就通了——用户说一句话，Canvas 上出现对应的图形。这是最重要的里程碑。之后的阶段八~十是增量完善。
