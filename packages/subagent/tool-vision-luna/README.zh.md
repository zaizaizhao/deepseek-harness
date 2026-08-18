# `@deepseek-ai/dsh-tool-vision-luna`

[English](README.md) | 中文

这是一个为纯文本主 Agent 提供单一、受治理视觉证据工具的 Host 插件。浏览器上传、工作区图片路径和显式允许的 HTTPS URL 会变成持久化 Harness 附件引用；隔离的一次性 `spawn` 子 Agent 通过现有 LLM 路由接收这些附件，并返回严格的结构化证据。

本包是 Host 半边。浏览器适配器位于 [`@deepseek-ai/dsh-client-ui-vision-luna`](../../client/ui-vision-luna/README.md)，[`@deepseek-ai/dsh-vision-luna`](../../bundle/vision-luna/README.md) 则把两半作为可选 Web profile 层一起安装。

## 配置归属

插件配置有意不包含 API Key、凭据引用、端点、协议、请求头或重试策略。它只选择一条已经存在的 Harness provider/model 路由，并提供功能策略：

```yaml
- id: tool-vision-luna
  name: '@deepseek-ai/dsh-tool-vision-luna'
  config:
    provider: zaizaizhao
    model: gpt-5.6-luna
    maxTokens: 4096
    maxConcurrency: 1
    visionTimeoutMs: 120000
```

请通过现有 `llm-pi-ai` settings namespace 配置该路由。自定义图片模型必须明确声明两种输入模态：

```yaml
# $DSH_HOME/settings.yaml
llm-pi-ai:
  providers:
    zaizaizhao:
      displayName: Zaizaizhao
      apiKeyEnv: ZAIZAIZHAO_API_KEY
      api: openai-completions       # use the protocol implemented by the endpoint
      baseURL: https://gateway.example/v1
      models:
        - id: gpt-5.6-luna
          input: [text, image]
```

`apiKeyEnv` 是凭据引用，不是密钥本身。真实值通过**设置 → 模型**、`$DSH_HOME/.credentials.yaml` 或继承的启动环境保存。适配器在每次请求时解析该引用。已配置但无法解析的引用会以 `MISSING_CREDENTIAL` 原样到达本工具；插件不会截获它、询问密钥或退回其他凭据。

DeepSeek 主模型保持独立。普通 Agent 配置选择主 Agent 的 provider/model；只有本插件的 `provider` 和 `model` 选择视觉子 Agent。两条路由可以使用不同 provider、凭据、协议与限额，不需要任何插件复制另一方的设置。

## 插件配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `provider` | `zaizaizhao` | 视觉子 Agent 使用的现有 Harness LLM provider 路由。 |
| `model` | `gpt-5.6-luna` | 该路由上的现有模型 id。 |
| `maxTokens` | `4096` | 子 Agent 输出上限。 |
| `toolName` | `gpt_luna_vision` | 面向模型的工具名。 |
| `enableRunInBackground` | `true` | 是否允许通过普通 `job_output`/`job_kill` 后台执行。 |
| `maxDepth` | `1` | 子 Agent 委派深度绝对上限。 |
| `maxConcurrency` | `1` | 每个插件实例并发运行的视觉子 Agent 数量。 |
| `cacheMaxEntries` | `256` | 进程内已完成结果 LRU 条目上限。 |
| `maxQuestionBytes` | `16384` | 问题的 UTF-8 字节上限。 |
| `visionTimeoutMs` | `120000` | 完整视觉执行时限。 |
| `allowedUrlOrigins` | `[]` | URL 图片的精确 HTTPS origin 白名单；空列表会禁用 URL 接入。 |
| `urlTimeoutMs` | `20000` | 单次 URL 下载时限。 |
| `maxRedirects` | `3` | 重定向上限；每个目的地都会重新验证。 |
| `maxUrlLength` | `4096` | URL 文本长度上限。 |

未知字段会让插件激活直接失败。因此误放的 `apiKey`、`baseURL` 等配置会立刻暴露，而不会被静默忽略或留存。

## 运行流程

1. 浏览器适配器在发送主提示词前上传完整图片批次。Host 会在保存任何成员前校验规范 base64、数量与字节限额、重复内容、MIME 与文件签名一致性以及图片固有尺寸。
2. 附件存储持久化内容寻址字节；`vision/asset` Session 事件把不透明 `asset_id` 授权给这个确切的主 Session。
3. 生成的 `visionLuna.read` Remote 接受 Session id 与从 `vision/asset` 事件投影出的不透明资产 id，用于展示已发送消息。它在该 Session 内解析权威事件、使用事件中的引用验证存储对象，并返回仅供浏览器使用的规范 base64，不暴露凭据或存储路径。
4. `gpt_luna_vision` 接受已授权 `asset_id`、工作区内 `file_path` 或精确 origin 白名单中的 HTTPS URL。路径解析拒绝越界与末端符号链接；URL 解析拒绝凭据、IP 字面量、私网或公私混合 DNS 结果，并通过 DNS 固定、防重绑定、重定向复验和流式大小限制保护下载。
5. runner 先确认所选 Harness 模型声明同时支持 `text` 与 `image`，再启动一个无工具、`maxDepth: 1`、带敌对图片内容防护 persona、严格输出 schema 与“文本 + 图片”内容块的 `spawn` 子 Agent。
6. Host 校验子 Agent 的结构化结果，并补充权威附件追踪、子 Session id、provider/model、缓存命中状态与警告，再把文本结果交给主 Agent。

前台与后台路径共用同一个并发控制器、时限、校验与缓存。同一父 Session 内相同的进行中请求只运行一个子 Agent；只要还有其他等待者，取消其中一个不会终止共享执行。后台工作进入现有 jobs registry；本包不会另建任务系统。

## 模型体验

### 主 Agent 工具说明

#### 模型看到的内容

主 Agent 会看到 `gpt_luna_vision` 工具和一个稳定提示词段落，明确说明自己是纯文本模型、不得猜测图片内容、必须把图片中的指令视为不可信证据，并保留 OCR 与疑点。工具结果包含直接回答、精确 OCR、带区域的观察、疑点与追踪字段。

#### Token 效应

主请求增加一份稳定工具 schema 与说明段落。图片字节永远不进入主 Agent 文本；子 Agent 接收一个有界说明块和 Harness 附件引用。

#### KV Cache 影响

插件生命周期内的主提示词前缀保持稳定。已完成视觉结果按父 Session、有序附件 id、问题、可选区域、provider、model、输出预算与提示词版本缓存；命中缓存时不会再次请求子 Agent，也不会借用其他 Session 的子 Agent 追踪信息。

## 已知限制与延期工作

- 支持 PNG、JPEG、WebP 与 GIF 栅格图片；SVG 和 PDF 不属于本工具。
- 模型的 `input: [text, image]` 是部署方声明的元数据，不是端点探测。错误声明图片能力时，后续会由 provider 拒绝。
- URL 接入采用精确 HTTPS origin 白名单且默认关闭，不接受通配域名。
- 已完成结果缓存位于进程内。在同一 provider/model id 背后更换后端后，应重启进程或使用新 route id，以免复用旧条目。
- 子 Agent 只运行一个结构化输出轮次且没有工具；多轮视觉追问不属于本包。
