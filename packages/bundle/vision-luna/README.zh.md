# `@deepseek-ai/dsh-vision-luna`

[English](README.md) | 中文

这是一个可选的 Web profile 视觉委派组合包。它应在 [`@deepseek-ai/dsh-base`](../base/README.md) 与 [`@deepseek-ai/dsh-web-app`](../web-app/README.md) 之后应用。[`cordis.patch.yml`](cordis.patch.yml) 同时挂载 Host 工具 [`@deepseek-ai/dsh-tool-vision-luna`](../../subagent/tool-vision-luna/README.md) 与浏览器图片接入适配器 [`@deepseek-ai/dsh-client-ui-vision-luna`](../../client/ui-vision-luna/README.md)。

patch 只选择 `zaizaizhao/gpt-5.6-luna` 并设置非敏感的执行限额，不携带 API Key、凭据引用、端点、协议或请求头。请继续通过 `$DSH_HOME/settings.yaml` 的现有 `llm-pi-ai` 段定义 `zaizaizhao` provider profile；其引用的真实密钥只保存在 Harness 凭据文档或继承的进程环境中。

## 模型体验

### 组合后的视觉委派

#### 模型看到的内容

纯文本主 Agent 会得到一个 `gpt_luna_vision` 工具，以及不得猜测图片内容的明确指令。浏览器在发送主提示词之前先上传粘贴、拖放或选择的图片，然后只把不透明的 `asset_id` 引用写进纯文本提示词。一次性的 `spawn` 子 Agent 使用已配置的 Luna 路由接收问题和持久化图片附件，并返回结构化证据、OCR、观察、疑点与 Host 写入的追踪字段。

#### Token 效应

主 Agent 请求增加一份稳定工具 schema、一个说明段落，以及每张已提交图片的一行短引用。子 Agent 接收一段有界说明和图片附件块；图片字节不会成为主 Agent 文本。

#### KV Cache 影响

主 Agent 提示词增加一份稳定工具 schema 和一个稳定说明段落。已完成的视觉结果使用有界进程内缓存；缓存键覆盖父 Session、图片摘要、问题、区域、provider、model、输出预算与提示词版本。

## 已知限制与延期工作

- 本组合包面向 Web profile，因为客户端半边依赖浏览器会话表层。
- 自定义 provider 的模型目录必须明确声明同时接受 `text` 与 `image`；缺少能力元数据时工具会直接失败。
- 浏览器上传只接受栅格图片。部署未在后续 profile patch 中提供精确 HTTPS origin 前，URL 接入保持禁用。
- 在同一 route id 下更换 provider 后，需要重启进程以清空已完成的进程内缓存。
