# `@deepseek-ai/dsh-client-ui-vision-luna`

[English](README.md) | 中文

这是 [`@deepseek-ai/dsh-tool-vision-luna`](../../subagent/tool-vision-luna/README.md) 的浏览器图片接入适配器。它挂载 Host 包生成的 `visionLuna` Remote，并在 `ctx.conversation` 上注册唯一的发送时图片接入 provider。

本插件缺席时，`ui-conversation` 保持原生行为，把草稿图片序列化为原始图片提示词块。本插件存在时，发送变成受门控的两阶段操作：先把完整、有序文件批次上传给 Host，再使用纯文本 `asset_id` 引用块发送主提示词。上传失败、适配器卸载、会话服务销毁或提示词发送失败都会保留草稿供重试，且绝不会发送半份提示词。提示词发送失败时，已经授权、按内容寻址的资产可以留给重试使用；持久存储不会回滚。

浏览器接受已经通过共享 composer 策略准入的 PNG、JPEG、WebP 与 GIF 文件。它以有界分块编码上传载荷，使用当前 Session 的 Remote scope 完成授权，要求每个输入文件恰好对应一份持久化回执，并在发送主提示词前拒绝不支持的 MIME 或回执数量不一致。

## 配置

本包没有配置，也不处理机密。Client 不会收到 provider API Key、凭据引用、端点或协议。所有模型路由与凭据解析都发生在 Host 现有 Harness 服务内；浏览器到 Host 的载荷只有图片数据与可选显示名称。

## 模型体验

### 浏览器图片接入

#### 模型看到的内容

主 Agent 只收到类似 `Visual asset available through gpt_luna_vision: asset_id=…` 的文本。base64 与原始图片块都不会进入纯文本主 Agent；随后由 Host 的提示词段落和工具 schema 告诉主 Agent 如何委派视觉问题。

#### Token 效应

每张已发送图片会给主提示词增加一行很短的引用；图片字节始终位于模型可见文本之外。

#### KV Cache 影响

同一持久化附件的引用行采用内容寻址并保持稳定，但新增图片会改变本轮用户消息后缀。更早的稳定提示词轮次能否复用由所选 provider 决定。

## 已知限制与延期工作

- 同一时刻只能有一个图片接入适配器；重复注册会在插件激活时失败。
- 上传发生在发送时而不是选择时，因此大批图片会在主提示词前增加一次 Host 往返。
- 适配器不提供独立图库或图片编辑器；预览与草稿删除仍由 `ui-conversation` 拥有。
