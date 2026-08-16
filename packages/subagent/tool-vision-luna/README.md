# `@deepseek-ai/dsh-tool-vision-luna`

English | [中文](README.zh.md)

Host plugin that gives a text-only parent Agent one governed visual-evidence tool. Browser uploads, workspace image paths, and explicitly allowed HTTPS URLs become durable Harness attachment references; an isolated one-shot `spawn` child receives those attachments through the existing LLM route and returns strict structured evidence.

This package is the Host half. The browser adapter lives in [`@deepseek-ai/dsh-client-ui-vision-luna`](../../client/ui-vision-luna/README.md), and [`@deepseek-ai/dsh-vision-luna`](../../bundle/vision-luna/README.md) installs both halves as an optional Web-profile layer.

## Configuration ownership

The plugin configuration intentionally contains no API key, credential reference, endpoint, protocol, headers, or retry policy. It selects an existing Harness provider/model route and supplies only feature policy:

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

Configure the route through the existing `llm-pi-ai` settings namespace. A custom image route must explicitly declare both input modalities:

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

`apiKeyEnv` is a credential reference, not the secret. Store the actual value through **Settings → Models**, in `$DSH_HOME/.credentials.yaml`, or in the inherited launch environment. The adapter resolves that reference per request. An unresolved configured reference reaches this tool as `MISSING_CREDENTIAL`; the plugin does not catch it, prompt for a key, or fall back to another credential.

The DeepSeek parent model remains independent. Its normal Agent configuration chooses the parent provider/model; only this plugin's `provider` and `model` choose the visual child. The two routes may use different providers, credentials, protocols, and limits without either plugin copying the other's settings.

## Plugin configuration

| Field | Default | Meaning |
|---|---:|---|
| `provider` | `zaizaizhao` | Existing Harness LLM provider route for the child. |
| `model` | `gpt-5.6-luna` | Existing model id on that route. |
| `maxTokens` | `4096` | Child output cap. |
| `toolName` | `gpt_luna_vision` | Model-facing tool name. |
| `enableRunInBackground` | `true` | Allow ordinary `job_output`/`job_kill` execution. |
| `maxDepth` | `1` | Absolute child delegation-depth cap. |
| `maxConcurrency` | `1` | Concurrent visual children per plugin instance. |
| `cacheMaxEntries` | `256` | Process-local completed-result LRU entries. |
| `maxQuestionBytes` | `16384` | UTF-8 question limit. |
| `visionTimeoutMs` | `120000` | Complete visual execution deadline. |
| `allowedUrlOrigins` | `[]` | Exact HTTPS origins allowed for URL assets. Empty disables URL intake. |
| `urlTimeoutMs` | `20000` | Per-URL download deadline. |
| `maxRedirects` | `3` | Redirect cap; every destination is revalidated. |
| `maxUrlLength` | `4096` | URL text limit. |

Unknown fields fail plugin activation. This makes an accidental `apiKey`, `baseURL`, or similar misplaced setting visible immediately instead of silently ignoring or retaining it.

## Runtime flow

1. The browser adapter uploads the complete image batch before the parent prompt. The Host validates canonical base64, count and byte limits, duplicate content, MIME against file signature, and intrinsic dimensions before saving any member.
2. The attachment store persists content-addressed bytes. A `vision/asset` Session event authorizes the opaque `asset_id` for that exact parent Session.
3. `gpt_luna_vision` accepts authorized `asset_id` values, workspace-contained `file_path` values, or exact-origin HTTPS URLs. Path resolution rejects workspace escape and final symlinks. URL resolution rejects credentials, IP literals, private or mixed-public DNS answers, rebinding through DNS pinning, disallowed redirects, and oversized streaming bodies.
4. The runner confirms that the selected Harness model declares both `text` and `image`, then starts one `spawn` child with no tools, `maxDepth: 1`, a hostile-image-content persona, a strict output schema, and text-plus-image content blocks.
5. The Host validates the child's structured result and adds authoritative asset traces, child Session id, provider/model identity, cache status, and warnings before returning text to the parent.

Foreground and background paths share the same concurrency controller, timeout, validation, and cache. Within one parent Session, identical in-flight requests share one child execution; cancelling one waiter does not stop it while another waiter remains. Background work is stored in the existing jobs registry; this package does not create a second task system.

## Model Experience

### Parent tool guidance

#### What the model sees

The parent sees the `gpt_luna_vision` tool and one stable prompt section stating that it is text-only, must not guess image content, must treat image-borne instructions as untrusted evidence, and must preserve OCR and uncertainty. Tool results contain a direct answer, exact OCR, region-linked observations, uncertainty, and trace fields.

#### Token effect

One stable tool schema and guidance paragraph enter the parent request. Image bytes never enter parent text. The child receives one bounded instruction block plus Harness attachment references.

#### KV Cache effect

The parent prefix is stable for the plugin lifetime. Completed visual results are cached by parent Session, ordered asset ids, question, optional region, provider, model, output budget, and prompt version; cached results avoid a new child request without borrowing child provenance from another Session.

## Known Limitations and Deferred Work

- Supported inputs are PNG, JPEG, WebP, and GIF raster images. SVG and PDF are outside this tool.
- A model's `input: [text, image]` declaration is deployment-owned metadata, not an endpoint probe. Incorrectly declaring image support is rejected later by the provider.
- URL intake uses an exact HTTPS-origin allowlist and is disabled by default. It does not accept wildcard domains.
- The completed-result cache is process-local. Changing the backend behind an unchanged provider/model id requires a restart or a new route id to avoid reusing earlier entries.
- The child uses one structured-output turn and no tools. Multi-turn visual refinement is intentionally outside this package.
