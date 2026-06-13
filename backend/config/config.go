package config

import (
	"bufio"
	"os"
	"strings"
)

// Config 应用配置
type Config struct {
	DeepSeekAPIKey  string
	DeepSeekBaseURL string
	DeepSeekModel   string
	ServerPort      string
}

// Load 从 .env 文件加载配置，文件不存在时不报错（使用默认值）
func Load(path string) *Config {
	cfg := &Config{
		DeepSeekBaseURL: "https://api.deepseek.com/v1",
		DeepSeekModel:   "deepseek-chat",
		ServerPort:      "8080",
	}

	file, err := os.Open(path)
	if err != nil {
		// .env 不存在时用默认值 + 环境变量覆盖
		applyEnvOverrides(cfg)
		return cfg
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		switch key {
		case "DEEPSEEK_API_KEY":
			cfg.DeepSeekAPIKey = value
		case "DEEPSEEK_BASE_URL":
			cfg.DeepSeekBaseURL = value
		case "DEEPSEEK_MODEL":
			cfg.DeepSeekModel = value
		case "SERVER_PORT":
			cfg.ServerPort = value
		}
	}

	applyEnvOverrides(cfg)
	return cfg
}

// applyEnvOverrides 环境变量优先级高于 .env 文件
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("DEEPSEEK_API_KEY"); v != "" {
		cfg.DeepSeekAPIKey = v
	}
	if v := os.Getenv("DEEPSEEK_BASE_URL"); v != "" {
		cfg.DeepSeekBaseURL = v
	}
	if v := os.Getenv("DEEPSEEK_MODEL"); v != "" {
		cfg.DeepSeekModel = v
	}
	if v := os.Getenv("SERVER_PORT"); v != "" {
		cfg.ServerPort = v
	}
}
