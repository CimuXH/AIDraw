# AI 语音绘图工具 — 设计文档

## 1. 项目概述

### 1.1 目标

开发一款纯语音控制的 Web 绘图工具。用户不能使用鼠标或键盘，仅通过中文语音指令完成绘图创作。

### 1.2 核心要求

- 仅语音交互，无键鼠操作
- 中文语音识别 + 语音合成反馈
- 使用 LLM 将自然语言指令解析为结构化绘图命令
- 维护场景图谱（Scene Graph），支持多图形之间的空间关联
- 单步撤销能力
- 低延迟：语音输入 → Canvas 渲染全程

### 1.3 一句话描述

用户说话 → 浏览器语音识别 → 文字 + 场景图谱上下文 → Go 后端 → DeepSeek NLU 推理 → 返回结构化绘图命令 → Canvas 渲染 → TTS 语音确认。

---

## 2. 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 渲染引擎 | HTML5 Canvas | 浏览器原生，所有现代浏览器支持 |
| 语音识别 (STT) | Web Speech API `SpeechRecognition` | 浏览器内置（Chrome/Edge），零部署，支持 `zh-CN` 连续识别，延迟 200-500ms |
| 自然语言理解 (NLU) | **DeepSeek Chat API** | 将自然语言解析为 JSON 绘图命令。DeepSeek API 兼容 OpenAI Chat Completions 格式，Go `net/http` 直接调用 |
| 语音合成 (TTS) | Web Speech API `SpeechSynthesis` | 浏览器内置 TTS，支持中文，用于操作确认反馈 |
| 后端 | **Go**（net/http + gorilla/websocket） | WebSocket 服务，中转浏览器 → DeepSeek 的 NLU 请求。Go 并发模型天然适合 WebSocket |
| 场景图谱 | 前端内存 + localStorage 备份 | 主副本在前端 JS 内存中，每次操作同步写 localStorage 防止刷新丢失 |
| 撤销 | 单层像素快照 `ImageData` | 只能撤销一步，800×600 约 1.8MB，存一份即可 |
| 通信 | WebSocket | 双工低延迟，一条连接贯穿会话 |

### 2.1 为什么选 Web Speech API 而不是 faster-whisper

| | Web Speech API | faster-whisper |
|---|---|---|
| 准确率 | ~85-90%（Chrome 云端） | ~95%+ |
| 延迟 | 200-500ms | 1-2s（CPU base） |
| 部署 | 零 | 需 Python 环境 + 模型下载 |
| 后端语言 | 纯 Go | Go + Python 双服务 |

选择 Web Speech API 的核心原因：**LLM 补偿了 STT 的不足**。即使语音识别有少量误差，DeepSeek 凭借 NLU 能力可以纠错（如"红色的云"→理解为"红色的圆"）。加上 2 天时间限制、纯 Go 后端的更简单部署方式，方案 A 是此时的最优解。

### 2.2 为什么不直接用多模态 LLM + Canvas 截图

- DeepSeek Chat 不支持图片输入
- 多模态调用延迟更高（图片编解码 + 传输）
- Token 成本更高
- 场景图谱方案用纯文本达到同等空间推理效果

---

## 3. 系统架构

### 3.1 架构图

```
┌─ 浏览器 (Chrome/Edge) ──────────────────────────────────────────┐
│                                                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │ Web Speech   │   │ Web Speech   │   │ Canvas               │ │
│  │ Recognition  │   │ Synthesis    │   │                      │ │
│  │ (STT 输入)   │   │ (TTS 输出)    │   │ ┌──────┐ ┌──────┐   │ │
│  │              │   │              │   │ │ 圆   │ │ 三角形│   │ │
│  │ 连续监听中文  │   │ 中文确认反馈  │   │ │      │ │      │   │ │
│  └──────┬───────┘   └──────▲───────┘   │ └──────┘ └──────┘   │ │
│         │                  │           └──────────┬───────────┘ │
│         │  识别文字         │  TTS播放               │ 绘制      │
│         ▼                  │                       ▼            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    app.js (主控制器)                       │   │
│  │                                                           │   │
│  │  1. 收到识别文字                                           │   │
│  │  2. 获取 SceneGraph.toLLMContext()                         │   │
│  │  3. 图谱上下文 + 用户指令 → WebSocket → Go 后端            │   │
│  │  4. 收到绘图命令 JSON → 执行绘制                           │   │
│  │  5. 执行前: history.saveSnapshot() (像素快照)              │   │
│  │  6. 执行后: SceneGraph.addObject() (图谱注册)              │   │
│  │  7. TTS 反馈                                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────┐ ┌───────────────────────────┐  │
│  │ Scene Graph (内存)            │ │ History (单层像素快照)     │  │
│  │ objects[] + add/remove/find   │ │ snapshot: ImageData|null   │  │
│  │ toLLMContext() 序列化         │ │ undo() / saveSnapshot()    │  │
│  │ sync() → localStorage 备份    │ │                            │  │
│  └──────────────────────────────┘ └───────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                                    │ WebSocket
                                    │ ws://localhost:8080/ws
                                    ▼
┌─ Go 后端 (localhost:8080) ────────────────────────────────────────┐
│                                                                   │
│  main.go                                                          │
│  ├── WebSocket Hub (连接管理，单用户)                               │
│  ├── wsHandler: 收消息 → 调 DeepSeek → 返回结果                     │
│  └── llm.go: 构建 Prompt + 调用 DeepSeek Chat API                  │
│                                                                   │
│  Prompt 构建:                                                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ System: 你是语音绘图命令解析器，将自然语言指令转为JSON命令     │  │
│  │                                                              │  │
│  │ User:                                                        │  │
│  │   画布尺寸: 800×600                                           │  │
│  │   已绘制图形:                                                 │  │
│  │   1. 矩形 "正方形" - bbox(x:350,y:250,w:100,h:100)           │  │
│  │   用户指令: "在正方形右边画一个三角形"                         │  │
│  │                                                              │  │
│  │ Assistant (DeepSeek):                                        │  │
│  │   {"commands":[{...}]}                                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  DeepSeek Chat API                                                │
│  POST https://api.deepseek.com/v1/chat/completions                │
│  model: deepseek-chat                                             │
│  response_format: { type: "json_object" }                         │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 模块职责

#### 前端（JavaScript）

| 文件 | 职责 |
|------|------|
| `index.html` | 入口 HTML，定义三区布局，加载所有 JS 脚本 |
| `css/style.css` | 深色主题样式，响应式布局，动画 |
| `js/state.js` | **场景图谱 + 工具状态管理。** SceneGraph CRUD、toLLMContext()、localStorage 同步、当前颜色/粗细/填充等全局状态 |
| `js/speech/recognizer.js` | Web Speech API 封装：启动、停止、连续监听、自动恢复、事件派发 |
| `js/speech/synthesizer.js` | TTS 封装：中文语音选择、队列管理 |
| `js/drawing/canvas.js` | Canvas 初始化、尺寸自适应、清空、坐标工具函数 |
| `js/drawing/shapes.js` | 所有形状绘制函数（圆/矩形/三角/线/椭圆/星/心形/箭头）+ 复合图形（太阳/房子/树/花/笑脸） |
| `js/drawing/history.js` | 单层像素快照：`saveSnapshot(ctx)` / `undo(ctx)` |
| `js/network.js` | WebSocket 客户端：连接、发送、接收、重连 |
| `js/app.js` | **主控制器。** 串联所有模块：识别结果 → 构建请求 → WebSocket → 收到命令 → 执行绘制 → 图谱更新 → TTS 反馈 |

#### 后端（Go）

| 文件 | 职责 |
|------|------|
| `main.go` | 入口：启动 HTTP/WebSocket 服务，路由注册 |
| `handler/ws.go` | WebSocket 连接处理：接收前端消息、调用 NLU、返回结果 |
| `llm/client.go` | DeepSeek API 客户端：构建 Prompt、发送请求、解析响应 |

---

## 4. 场景图谱（Scene Graph）数据结构

### 4.1 图谱对象定义

场景图谱是一个 JSON 对象数组，存储画布上**每一个已绘制图形**的结构化元数据。

```json
{
  "objects": [
    {
      "id": "obj_1718000000000_0",
      "type": "circle",
      "label": "红色太阳",
      "bbox": { "x": 340, "y": 200, "width": 120, "height": 120 },
      "center": { "x": 400, "y": 260 },
      "color": "#FF0000",
      "fill": true,
      "strokeWidth": 3,
      "parentId": null,
      "zIndex": 0,
      "params": { "radius": 60 }
    }
  ],
  "canvasSize": { "width": 800, "height": 600 },
  "version": 7
}
```

### 4.2 字段说明

| 字段 | 类型 | 含义 | 示例 |
|------|------|------|------|
| `id` | string | 全局唯一标识，时间戳+序号生成 | `"obj_1718000000000_0"` |
| `type` | string | 图形类型枚举 | `"circle"`, `"rectangle"`, `"triangle"`, `"line"`, `"ellipse"`, `"star"`, `"heart"`, `"arrow"`, `"path"` |
| `label` | string | **LLM 生成的自然语言描述**，用于后续指令中引用（"那个红色太阳"）。这个字段是图谱的核心——用户说"把太阳删掉"时，LLM 通过 label 匹配目标 | `"红色太阳"`, `"蓝色正方形"`, `"房子主体"` |
| `bbox` | object | **包围盒**。`{x, y, width, height}`，`x,y` 是左上角坐标。**这是 LLM 做空间推理的关键字段。** 例如：`x:350,w:100` → 右边界=450 → "在右边画" → 新图形 x≈470 | `{x:340, y:200, width:120, height:120}` |
| `center` | object | 几何中心点。圆形用此定位，矩形用 `(x+width/2, y+height/2)` 计算 | `{x:400, y:260}` |
| `color` | string | 十六进制颜色 | `"#FF0000"` |
| `fill` | bool | `true`=实心填充，`false`=空心描边 | `true` |
| `strokeWidth` | int | 线条粗细（px），默认 3 | `3` |
| `parentId` | string\|null | 复合图形的父子关系。如 `"屋顶"` 的 parentId 指向 `"房子主体"`。删除父图形时级联删除子图形 | `null` |
| `zIndex` | int | 图层顺序。值越大越靠上。new Object → `objects.length` | `0` |
| `params` | object | **图形特有的几何参数**（不同 type 存储不同字段），用于精确重绘： | |
| | | - circle: `{radius}` | `{radius:60}` |
| | | - rectangle: `{rotation?}` | `{}` |
| | | - triangle: `{size, rotation?}` | `{size:80}` |
| | | - line: `{x1, y1, x2, y2}` | `{x1:100,y1:100,x2:300,y2:200}` |
| | | - ellipse: `{radiusX, radiusY}` | `{radiusX:50,radiusY:30}` |
| | | - star: `{points, outerRadius, innerRadius}` | `{points:5,outerRadius:40,innerRadius:20}` |
| | | - path: `{points:[{x,y},...]}` (自由绘制路径) | `{points:[{x:100,y:100},{x:120,y:105},...]}` |
| `createdAt` | number | 创建时间戳 (ms)，用于排序和调试 | `1718000000000` |

### 4.3 图谱操作

```javascript
const SceneGraph = {

  // ── 生命周期 ──
  load()           // 页面加载时从 localStorage 恢复图谱。失败则空图谱
  sync()           // 每次变更后同步到 localStorage（防刷新丢失）

  // ── 增删改 ──
  addObject(obj)   // 新图形注册到图谱。自动生成 id、填充 bbox/center、分配 zIndex
  updateObject(id, changes) // 修改图形属性（改颜色、大小等），然后全量重绘
  removeObject(id)          // 删除图形。若 parentId 关联，级联删除子图形

  // ── 查询 ──
  findById(id)              // 按 id 精确查找
  findByLabel(keyword)      // 按 label 模糊查找，返回匹配数组
  findByType(type)          // 按类型查找

  // ── LLM 上下文 ──
  toLLMContext()            // 将图谱序列化为发给 DeepSeek 的文本描述：
                            // "画布尺寸:800×600\n已绘制2个图形:\n
                            //  1. 矩形'正方形' bbox(x:350,y:250,w:100,h:100)...\n
                            //  2. 圆形'红色太阳' 中心(400,260) 半径60..."

  // ── 其他 ──
  clear()         // 清空图谱
  getAll()        // 返回 objects 数组（重绘用）
}
```

### 4.4 图谱存储位置

```
┌─ 运行时主副本 ── JavaScript 内存变量 SceneGraph.objects[]
│   速度: 纳秒级读写
│   用途: 所有常规操作
│
└─ 持久备份 ── localStorage["sceneGraph"]
    速度: 毫秒级读写
    用途: 页面刷新后恢复
    数据: JSON.stringify({objects, canvasSize, version})
    大小: 100个图形 ≈ 20KB
```

**不需要后端存储图谱。** 图谱是前端 Canvas 的元数据描述，与渲染强绑定，放在前端保证单一真相源。

---

## 5. 撤销（Undo）设计

### 5.1 单步撤销

系统只支持撤销**上一步**操作，不支持连续撤销，不支持重做（Redo）。

### 5.2 实现：像素快照

```
每次执行新绘图命令前:
  1. snapshot = ctx.getImageData(0, 0, w, h)  // 保存当前画面
  2. 存储到 history.snapshot

用户说 "撤销":
  1. ctx.putImageData(history.snapshot, 0, 0)  // 瞬间还原
  2. SceneGraph.pop()                           // 同步移除最后一个图形
  3. history.snapshot = null                    // 撤销已消耗
```

### 5.3 History 结构

```javascript
const History = {
  snapshot: null,        // ImageData | null，仅存一份
  lastLabel: "",         // 上一步操作的描述，用于 TTS："已撤销'画了一个三角形'"

  saveSnapshot(ctx)      // 在 execute() 前调用
  undo(ctx, sceneGraph)  // 恢复快照 + 移除图谱最后一个对象
  clear()                // 清除快照（新操作后上一份快照失效）
}
```

---

## 6. 前后端通信协议

### 6.1 WebSocket 消息格式

**前端 → 后端（请求 NLU）：**

```json
{
  "type": "nlu_request",
  "id": "req_001",
  "text": "在正方形右边画一个三角形",
  "sceneContext": "画布尺寸:800×600\n已绘制1个图形:\n1. 矩形'正方形' bbox(x:350,y:250,w:100,h:100) 颜色:#000000 空心 线宽3",
  "timestamp": 1718000000000
}
```

**后端 → 前端（NLU 结果）：**

```json
{
  "type": "nlu_result",
  "id": "req_001",
  "commands": [
    {
      "action": "drawTriangle",
      "label": "三角形(正方形右边)",
      "x": 520,
      "y": 300,
      "size": 80,
      "color": "#000000",
      "fill": false,
      "strokeWidth": 3
    }
  ],
  "rawResponse": "..."
}
```

**后端 → 前端（错误）：**

```json
{
  "type": "nlu_error",
  "id": "req_001",
  "error": "DeepSeek API 超时",
  "fallback": "抱歉，我没听懂，请再说一遍"
}
```

### 6.2 LLM 输出指令格式（由 DeepSeek 生成）

DeepSeek 被要求输出的 JSON schema：

```json
{
  "commands": [
    {
      "action": "drawCircle | drawRectangle | drawTriangle | drawLine | drawEllipse | drawStar | drawHeart | drawArrow | modifyObject | deleteObject | clearCanvas | unknown",
      "label": "简短的中文描述（如'红色实心圆'），用于后续引用和TTS",
      "x": "数字，中心或左上角x坐标（像素）",
      "y": "数字，中心或左上角y坐标（像素）",
      "width": "数字，仅矩形/椭圆等需要",
      "height": "数字，仅矩形/椭圆等需要",
      "radius": "数字，仅圆形",
      "size": "数字，三角形/星形的尺寸",
      "color": "十六进制颜色如#FF0000（如用户未指定则用当前工具颜色）",
      "fill": "布尔，是否填充",
      "strokeWidth": "数字，线条粗细（如用户未指定则用当前设置）",
      "targetLabel": "字符串，仅modifyObject/deleteObject需要，用于匹配现有图形",
      "changes": "对象，仅modifyObject需要，如{color:'#008000',fill:true}"
    }
  ]
}
```

---

## 7. 支持的功能

### 7.1 需要实现（Phase 1 — 必做）

#### 语音交互
- [ ] 麦克风按钮：点击开始/停止监听
- [ ] 连续语音识别（`continuous=true`）
- [ ] 识别中状态显示（UI 文字实时更新）
- [ ] TTS 语音确认：每次操作后播报执行结果
- [ ] 识别为空/超时时自动恢复监听
- [ ] 隐私提示：音频仅在浏览器云端处理（Web Speech API）

#### 画布操作
- [ ] 综合语音指令（如 `"画一个红色的圆"`）：通过 LLM 解析并执行
- [ ] 根据已有对象位置绘图（如 `"在正方形右边画一个三角形"`）
- [ ] 切换画笔颜色（如 `"用蓝色"/"换成绿色"`）
- [ ] 调整线条粗细（如 `"粗一点"/"细一点"`）
- [ ] 切换填充/空心（如 `"实心"/"填充"/"空心"`）
- [ ] 清除画布（`"清除"/"清空"`）
- [ ] 撤销（`"撤销"/"撤回"`）
- [ ] 视觉反馈：显示识别文字 → 显示解析的命令 → 画布更新

#### 基本形状绘制
- [ ] 圆形
- [ ] 矩形/正方形
- [ ] 三角形
- [ ] 直线
- [ ] 椭圆
- [ ] 五角星
- [ ] 心形
- [ ] 箭头

#### 复合图形绘制
- [ ] 太阳
- [ ] 房子
- [ ] 树
- [ ] 花
- [ ] 笑脸

#### 图形修改
- [ ] 修改颜色
- [ ] 修改大小
- [ ] 删除指定图形
- [ ] 修改填充状态

#### 后端
- [ ] WebSocket 服务
- [ ] DeepSeek API 集成
- [ ] Prompt 构建（包含场景图谱上下文）
- [ ] 错误处理 + 优雅降级

### 7.2 暂不实现（Phase 2 — 后续改进）

- [ ] 连续撤销/重做（Redo）
- [ ] 自由绘制模式（海龟图：`"开始画"/"向前十步"/"向左转"`）
- [ ] 多用户协作
- [ ] 画布导出（PNG/SVG）
- [ ] 语音唤醒词
- [ ] 离线模式（Web Speech API 需要在 Chrome 云端走 STT）
- [ ] 多模态截图识别（成本/延迟/模型能力限制）

### 7.3 不实现的原因

| 功能 | 原因 |
|------|------|
| 连续撤销/重做 | 用户明确要求仅单步撤销，简化实现 |
| 自由绘制（海龟图） | 控制粒度太细，语音控制体验差；LLM 对路径推理准确度有限；2天时间限制 |
| 多模态截图 | DeepSeek 不支持图片输入；延迟和成本更高；场景图谱已覆盖需求 |
| 离线模式 | Web Speech API 依赖 Chrome 云端 |
| 画布导出 | 非核心需求，后续可加 |

---

## 8. 开发步骤计划（2天）

### Day 1 上午：项目骨架 + 前端核心（4h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 创建项目目录结构和文件骨架（14个文件） | 所有空文件就位 |
| 1.2 | `index.html` — 三区布局（头栏/画布/识别显示），加载所有脚本 | 页面可打开 |
| 1.3 | `css/style.css` — 深色主题，响应式，动画 | 视觉效果就位 |
| 1.4 | `js/state.js` — Scene Graph 完整实现（CRUD、toLLMContext、localStorage 同步） | 图谱可用 |
| 1.5 | `js/drawing/canvas.js` — Canvas 初始化、自适应、清空、坐标工具 | Canvas 可渲染 |
| 1.6 | `js/drawing/shapes.js` — 全部 8 种形状 + 5 种复合图形 | 所有绘制函数可用 |
| 1.7 | `js/drawing/history.js` — 单层快照 undo | 撤销可用 |

### Day 1 下午：前端语音 + 后端（4h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | `js/speech/recognizer.js` — STT 封装，连续监听，自动恢复 | 可以说中文获得识别文字 |
| 2.2 | `js/speech/synthesizer.js` — TTS 封装，中文语音选择 | 可以播放中文语音反馈 |
| 2.3 | `js/network.js` — WebSocket 客户端（连接/收发/重连） | WebSocket 通信就位 |
| 2.4 | Go 项目初始化 — `go mod init`，安装 gorilla/websocket | Go 项目可编译 |
| 2.5 | `llm/client.go` — DeepSeek API 客户端，Prompt 构建 | 可调用 DeepSeek 并返回 JSON |
| 2.6 | `handler/ws.go` — WebSocket 处理，连接管理 | WebSocket 服务可运行 |
| 2.7 | `main.go` — 入口，启动服务，路由 | `go run main.go` 启动 |

### Day 2 上午：端到端打通（4h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | `js/app.js` — 主控流程：识别→图谱上下文→请求→执行→反馈 | 端到端链通 |
| 3.2 | 调通"画一个红色的圆"全程 | 第一个语音绘制的圆！ |
| 3.3 | 调通图谱上下文："画一个正方形"→"在正方形右边画三角形" | 空间关联验证 |
| 3.4 | 调通修改/删除："把那个三角形涂成蓝色"/"删掉太阳" | 修改操作验证 |
| 3.5 | 调通撤销 | 撤销验证 |
| 3.6 | 异常处理：网络断开、API 超时、识别为空 | 错误优雅降级 |

### Day 2 下午：打磨 + 文档（4h）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 4.1 | UI 打磨：过渡动画、状态指示、提示文字 | 视觉完成度提升 |
| 4.2 | TTS 反馈完善：每个操作都有恰当的中文确认 | 语音体验完整 |
| 4.3 | 边缘情况处理：重复绘制、空画布、极速说话 | 鲁棒性提升 |
| 4.4 | 完整测试：用所有支持的命令测试 | 功能验证通过 |
| 4.5 | 编写 README.md（使用说明 + 命令参考） | 用户文档 |
| 4.6 | 最终检查，修复发现的问题 | 可交付 |

---

## 9. UI 布局设计

```
┌──────────────────────────────────────────────────────────────────┐
│  头栏 (48px)                                                      │
│  [🎤 开始聆听]  ●录音中  状态:正常  ■红 粗细:3  填充:否  [清空]  │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                     Canvas 画布区域                               │
│                    (白色背景, 800×600)                            │
│                                                                  │
│                [绘制的图形显示在此区域]                            │
│                                                                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  识别显示 (80px, 自动滚动)                                        │
│  🎤 听到: "画一个红色的圆"                                       │
│  ✅ 执行: 画圆形(中心, 红色, 半径50)                              │
│  🔊 播报: "已画好一个红色的圆"                                    │
└──────────────────────────────────────────────────────────────────┘
```

**头栏元素：**
- 麦克风按钮（左侧）：点击切换开/关，听的时候脉冲动画
- 状态指示：聆听中（绿色） / 已暂停（黄色） / 正在处理（橙色旋转）
- 当前工具状态：颜色色块 + 文字、粗细值、填充开关指示
- 清空按钮（仅看不用，语音操作）

**Canvas：**
- 白色背景，居中
- 空画布时显示浅灰提示文字："点击麦克风，开始说话绘画"

**识别显示：**
- 实时显示 Web Speech API 的 `interim` 结果
- `final` 结果固定显示 + 命令解析结果
- TTS 播报文字同步显示

---

## 10. 目录结构

```
D:\code\aidraw3\
│
├── index.html                      # 单页应用入口
├── README.md                       # 使用说明 + 命令速查表
│
├── css/
│   └── style.css                   # 全部样式（深色主题）
│
├── js/
│   ├── app.js                      # 主控制器
│   ├── network.js                  # WebSocket 客户端
│   ├── speech/
│   │   ├── recognizer.js           # STT 封装
│   │   └── synthesizer.js          # TTS 封装
│   ├── drawing/
│   │   ├── canvas.js               # Canvas 引擎
│   │   ├── shapes.js               # 形状 + 复合图形绘制
│   │   └── history.js              # 单步撤销
│   └── state/
│       └── state.js                # Scene Graph + 全局状态
│
├── server/                         # Go 后端
│   ├── go.mod
│   ├── main.go                     # 入口
│   ├── handler/
│   │   └── ws.go                   # WebSocket 处理
│   └── llm/
│       └── client.go               # DeepSeek API 客户端
│
└── docs/
    └── design.md                   # 本设计文档
```
