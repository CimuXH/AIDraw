package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"aidraw-server/llm"

	"github.com/gorilla/websocket"
)

// ============================================================
// WebSocket 处理器
// 管理连接、收发消息、调用 NLU
// ============================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 开发阶段允许所有来源
	},
}

// WSMessage 通用 WebSocket 消息
type WSMessage struct {
	Type         string          `json:"type"`
	ID           string          `json:"id"`
	Text         string          `json:"text,omitempty"`
	SceneContext string          `json:"sceneContext,omitempty"`
	Commands     json.RawMessage `json:"commands,omitempty"`
	Error        string          `json:"error,omitempty"`
	Fallback     string          `json:"fallback,omitempty"`
}

// Hub 管理所有 WebSocket 连接
type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]bool
}

// NewHub 创建 Hub
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
	}
}

// WSHandler 返回 WebSocket 处理函数
func (h *Hub) WSHandler(llmClient *llm.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[WS] 升级连接失败: %v", err)
			return
		}
		defer conn.Close()

		h.mu.Lock()
		h.clients[conn] = true
		h.mu.Unlock()
		log.Printf("[WS] 客户端已连接 (当前 %d 个连接)", len(h.clients))

		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			h.mu.Unlock()
			log.Printf("[WS] 客户端已断开 (剩余 %d 个连接)", len(h.clients))
		}()

		// 设置读取超时
		conn.SetReadDeadline(time.Now().Add(30 * time.Minute))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(30 * time.Minute))
			return nil
		})

		for {
			_, msgBytes, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Printf("[WS] 读取消息错误: %v", err)
				}
				return
			}

			var msg WSMessage
			if err := json.Unmarshal(msgBytes, &msg); err != nil {
				log.Printf("[WS] 消息解析失败: %v", err)
				sendError(conn, msg.ID, "消息格式错误")
				continue
			}

			log.Printf("[WS] 收到消息 type=%s id=%s text=%s", msg.Type, msg.ID, truncate(msg.Text, 50))

			switch msg.Type {
			case "nlu_request":
				h.handleNLURequest(conn, &msg, llmClient)
			default:
				sendError(conn, msg.ID, "未知的消息类型: "+msg.Type)
			}
		}
	}
}

// handleNLURequest 处理 NLU 请求
func (h *Hub) handleNLURequest(conn *websocket.Conn, msg *WSMessage, llmClient *llm.Client) {
	startTime := time.Now()

	req := &llm.NLURequest{
		Text:         msg.Text,
		SceneContext: msg.SceneContext,
	}

	result, err := llmClient.Parse(req)
	if err != nil {
		log.Printf("[NLU] 处理失败 (%.2fs): %v", time.Since(startTime).Seconds(), err)
		sendError(conn, msg.ID, err.Error())
		return
	}

	commandsJSON, err := json.Marshal(result.Commands)
	if err != nil {
		log.Printf("[NLU] 序列化命令失败: %v", err)
		sendError(conn, msg.ID, "序列化命令失败")
		return
	}

	response := WSMessage{
		Type:     "nlu_result",
		ID:       msg.ID,
		Commands: commandsJSON,
	}

	respBytes, err := json.Marshal(response)
	if err != nil {
		log.Printf("[NLU] 序列化响应失败: %v", err)
		sendError(conn, msg.ID, "序列化响应失败")
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, respBytes); err != nil {
		log.Printf("[WS] 发送响应失败: %v", err)
		return
	}

	latency := time.Since(startTime).Milliseconds()
	log.Printf("[NLU] ✅ 处理完成 (%.2fs)，返回 %d 条命令: %s",
		time.Since(startTime).Seconds(), len(result.Commands),
		truncate(string(commandsJSON), 200))

	// 如果延迟超3000ms，提示一下
	if latency > 3000 {
		log.Printf("[NLU] ⚠️ 延迟较高: %dms", latency)
	}
}

// sendError 发送错误消息给客户端
func sendError(conn *websocket.Conn, id string, errMsg string) {
	response := WSMessage{
		Type:     "nlu_error",
		ID:       id,
		Error:    errMsg,
		Fallback: "抱歉，我没听懂，请再说一遍",
	}
	respBytes, _ := json.Marshal(response)
	conn.WriteMessage(websocket.TextMessage, respBytes)
}

// truncate 截断字符串
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}
