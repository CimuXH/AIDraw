package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-deepseek/deepseek/request"
	"github.com/go-deepseek/deepseek/response"
)

// ============================================================
// DeepSeek API 客户端
// 使用官方 SDK 的 request/response 类型，自行控制 HTTP 调用
// 以支持 deepseek-v4-flash 等自定义模型
// ============================================================

// Client DeepSeek API 客户端
type Client struct {
	apiKey     string
	baseURL    string
	model      string
	httpClient *http.Client
}

// NLURequest 前端发来的 NLU 请求
type NLURequest struct {
	Text         string `json:"text"`
	SceneContext string `json:"sceneContext"`
}

// DrawCommand DeepSeek 返回的单条绘图命令
type DrawCommand struct {
	Action      string                 `json:"action"`
	Label       string                 `json:"label,omitempty"`
	X           float64                `json:"x,omitempty"`
	Y           float64                `json:"y,omitempty"`
	Width       float64                `json:"width,omitempty"`
	Height      float64                `json:"height,omitempty"`
	Radius      float64                `json:"radius,omitempty"`
	RadiusX     float64                `json:"radiusX,omitempty"`
	RadiusY     float64                `json:"radiusY,omitempty"`
	Size        float64                `json:"size,omitempty"`
	OuterRadius float64                `json:"outerRadius,omitempty"`
	InnerRadius float64                `json:"innerRadius,omitempty"`
	Points      int                    `json:"points,omitempty"`
	X1          float64                `json:"x1,omitempty"`
	Y1          float64                `json:"y1,omitempty"`
	X2          float64                `json:"x2,omitempty"`
	Y2          float64                `json:"y2,omitempty"`
	Color       string                 `json:"color,omitempty"`
	Fill        *bool                  `json:"fill,omitempty"`
	StrokeWidth int                    `json:"strokeWidth,omitempty"`
	TargetLabel string                 `json:"targetLabel,omitempty"`
	Changes     map[string]interface{} `json:"changes,omitempty"`
}

// NLUResult NLU 返回结果
type NLUResult struct {
	Commands []DrawCommand `json:"commands"`
}

// NewClient 创建 DeepSeek 客户端
func NewClient(apiKey, baseURL, model string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		model:   model,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

// Parse 将用户语音文字 + 场景上下文发送给 DeepSeek，返回绘图命令
func (c *Client) Parse(nluReq *NLURequest) (*NLUResult, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("DeepSeek API Key 未配置，请在 .env 文件中设置 DEEPSEEK_API_KEY")
	}

	// 使用官方 SDK 的 request 类型构建请求
	temperature := float32(0.1) // 低温度，提高输出确定性
	chatReq := &request.ChatCompletionsRequest{
		Model: c.model,
		Messages: []*request.Message{
			{Role: request.RoleSystem, Content: c.buildSystemPrompt()},
			{Role: request.RoleUser, Content: c.buildUserPrompt(nluReq)},
		},
		ResponseFormat: &request.ResponseFormat{Type: request.ResponseFormatJsonObject},
		Temperature:    &temperature,
		MaxTokens:      1024,
		Stream:         false,
	}

	// 序列化请求
	body, err := json.Marshal(chatReq)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	// 构建 HTTP 请求
	url := c.baseURL + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建 HTTP 请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	// 发送请求
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("请求 DeepSeek API 失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("DeepSeek API 返回 HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	// 使用官方 SDK 的 response 类型解析响应
	var chatResp response.ChatCompletionsResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, fmt.Errorf("解析 DeepSeek 响应失败: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("DeepSeek 返回空的 choices")
	}

	choice := chatResp.Choices[0]
	if choice.Message == nil {
		return nil, fmt.Errorf("DeepSeek 返回空的 message")
	}

	content := choice.Message.Content
	// 去除可能的 markdown 代码块包裹
	content = stripMarkdownCodeBlock(content)

	var result NLUResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("解析绘图命令失败: %w\n原始内容: %s", err, content)
	}

	return &result, nil
}

// buildSystemPrompt 构建 System Prompt
func (c *Client) buildSystemPrompt() string {
	return `你是语音绘图命令解析器。用户说中文自然语言，你将其转换为结构化 JSON 绘图命令。

## 画布信息
- 尺寸：1100×700 像素
- 坐标系：原点(0,0)在左上角，x 向右增大，y 向下增大

## 输出格式
你必须只输出一个 JSON 对象，格式如下：
{
  "commands": [
    {
      "action": "动作名",
      "label": "简短的中文描述，用于后续引用和语音播报",
      // 不同 action 需要不同参数，见下方
    }
  ]
}

## 支持的 action 及参数

### 基本形状
- drawCircle: x(圆心x), y(圆心y), radius(半径), color, fill, strokeWidth
- drawRectangle: x(左上角x), y(左上角y), width(宽), height(高), color, fill, strokeWidth
- drawTriangle: x(中心x), y(中心y), size(边长), color, fill, strokeWidth
- drawLine: x1, y1, x2, y2, color, strokeWidth
- drawEllipse: x(中心x), y(中心y), radiusX(X半径), radiusY(Y半径), color, fill, strokeWidth
- drawStar: x(中心x), y(中心y), outerRadius(外径), innerRadius(内径), points(角数,默认5), color, fill, strokeWidth
- drawHeart: x(中心x), y(中心y), size(大小), color, fill, strokeWidth
- drawArrow: x1, y1, x2, y2, color, strokeWidth

### 复合图形（由多个基本形状组成，前端自动组装）
- drawSun: x(中心x), y(中心y), radius(半径), color
- drawHouse: x(左上角x), y(左上角y), width(宽), height(高), color
- drawTree: x(中心x), y(底部y), height(高), color
- drawFlower: x(中心x), y(中心y), size(大小), color
- drawSmileFace: x(中心x), y(中心y), radius(半径), color

### 修改操作
- modifyObject: targetLabel(要修改的图形描述), changes(对象,含要修改的字段如color/fill/size)
- deleteObject: targetLabel(要删除的图形描述)
- clearCanvas: 无额外参数

### 兜底
- unknown: 无法识别时使用

## 空间推理规则
- 默认位置：如用户未指定位置，放在画布中央偏上区域(550, 300)附近，并避开已有图形
- "在X的右边"：新图形 x = X的右边界 + 30~50 间距
- "在X的左边"：新图形右边界 = X的左边界 - 30~50 间距
- "在X的上面"：新图形下边界 = X的上边界 - 30~50 间距
- "在X的下面"：新图形 y = X的下边界 + 30~50 间距
- 如果场景中没有参考对象，随机放在画布空白区域

## 颜色映射
- 红/红色→#FF0000, 蓝/蓝色→#0000FF, 绿/绿色→#008000
- 黄/黄色→#FFFF00, 黑/黑色→#000000, 白/白色→#FFFFFF
- 橙/橙色→#FF8C00, 紫/紫色→#800080, 粉/粉色→#FFC0CB
- 灰/灰色→#808080, 棕/棕色→#8B4513, 青/青色→#00FFFF
- 用户未指定颜色时，color 字段留空字符串""，前端会用默认黑色
- 用户未指定 fill 时不要设置，前端用默认空心
- 用户未指定 strokeWidth 时不要设置，前端用默认值3

## 纠错规则
- "画一个云" → 大概率是"画一个圆"（口音），结合上下文判断
- "三角形"也可能是"三角形"，统一理解为三角形
- "巨星"可能是"矩形"、"五角形"可能是"五角星"
- "实现"可能是"实心"（填充）

## 示例
用户："画一个红色的圆"
输出：{"commands":[{"action":"drawCircle","label":"红色圆","x":550,"y":300,"radius":60,"color":"#FF0000","fill":true}]}

用户："在正方形右边画一个三角形"
（假设场景中有正方形在 x:350,y:250,w:100,h:100，右边界=450）
输出：{"commands":[{"action":"drawTriangle","label":"三角形(正方形右边)","x":520,"y":300,"size":80,"fill":false}]}

用户："把那个红色的圆涂成蓝色"
输出：{"commands":[{"action":"modifyObject","targetLabel":"红色圆","changes":{"color":"#0000FF"}}]}

用户："删掉那个三角形"
输出：{"commands":[{"action":"deleteObject","targetLabel":"三角形"}]}

用户："你好"
输出：{"commands":[{"action":"unknown"}]}`
}

// buildUserPrompt 构建 User Prompt
func (c *Client) buildUserPrompt(nluReq *NLURequest) string {
	var sb strings.Builder
	sb.WriteString("画布尺寸:1100×700\n")

	if nluReq.SceneContext != "" {
		sb.WriteString(nluReq.SceneContext)
		sb.WriteString("\n")
	}

	sb.WriteString("用户指令: ")
	sb.WriteString(nluReq.Text)

	return sb.String()
}

// stripMarkdownCodeBlock 去除可能的 ```json ... ``` 包裹
func stripMarkdownCodeBlock(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```json") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimSpace(s)
	} else if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSpace(s)
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
		s = strings.TrimSpace(s)
	}
	return s
}
