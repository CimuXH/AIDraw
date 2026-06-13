package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"aidraw-server/config"
	"aidraw-server/handler"
	"aidraw-server/llm"

	"github.com/gin-gonic/gin"
)

func main() {
	// 加载配置
	cfgPath := filepath.Join(".env")
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		cfgPath = filepath.Join("backend", ".env")
	}
	cfg := config.Load(cfgPath)

	if cfg.DeepSeekAPIKey == "" {
		log.Println("⚠️  DEEPSEEK_API_KEY 未配置，NLU 功能不可用")
		log.Println("   请在 backend/.env 文件中设置 DEEPSEEK_API_KEY")
	} else {
		log.Printf("✅ DeepSeek API Key 已配置 (model: %s)", cfg.DeepSeekModel)
	}

	// 创建 LLM 客户端
	llmClient := llm.NewClient(cfg.DeepSeekAPIKey, cfg.DeepSeekBaseURL, cfg.DeepSeekModel)

	// 创建 WebSocket Hub
	hub := handler.NewHub()

	// 创建 gin 路由
	router := gin.Default()

	// WebSocket 路由
	router.GET("/ws", hub.WSHandler(llmClient))

	// 静态文件服务 — 前端资源
	frontendPath := filepath.Join("..", "frontend")
	if _, err := os.Stat(frontendPath); os.IsNotExist(err) {
		frontendPath = filepath.Join("frontend")
	}
	if info, err := os.Stat(frontendPath); err == nil && info.IsDir() {
		// 用 NoRoute 避免通配符 /*filepath 与 /ws 冲突
		router.NoRoute(gin.WrapH(http.FileServer(http.Dir(frontendPath))))
		log.Printf("📁 静态文件服务: %s", frontendPath)
	} else {
		log.Printf("⚠️  未找到前端目录，仅提供 WebSocket 服务")
	}

	addr := ":" + cfg.ServerPort
	log.Printf("🚀 服务启动: http://localhost%s", addr)
	log.Printf("   WebSocket: ws://localhost%s/ws", addr)

	if err := router.Run(addr); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
