# AIDraw-ai绘图工具



#### 工具介绍

视频介绍链接：【ai语音绘图工具】 https://www.bilibili.com/video/BV1oCJw6JELx/?share_source=copy_web&vd_source=f8c146a8da6b89157072e234e1c1a7b7

系统通过语音识别实现简单的图形绘制，删除等功能。



#### 启动：

把项目拉取到本地之后，复制.env.example文件为.env，然后在文件中填入自己的api key等信息。

进入到backend目录中，使用命令go run main.go 启动。

打开浏览器输入localhost:8080，即可开始使用工具。



#### 第三方库依赖：

| github.com/gin-gonic/gin        | 后端api           |
| ------------------------------- | ----------------- |
| github.com/gorilla/websocket    | websocket连接管理 |
| github.com/go-deepseek/deepseek | deepseek的go sdk  |



design.md文件中说明了工具的具体实现功能，以及未实现的功能说明。
