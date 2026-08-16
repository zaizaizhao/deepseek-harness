# `@deepseek-ai/dsh-client-ui-vision-luna`

English | [中文](README.zh.md)

Browser image-intake adapter for [`@deepseek-ai/dsh-tool-vision-luna`](../../subagent/tool-vision-luna/README.md). It mounts the Host package's generated `visionLuna` Remote and registers the sole submit-time image intake provider on `ctx.conversation`.

When this plugin is absent, `ui-conversation` keeps its native behavior and serializes draft images as raw image prompt blocks. When this plugin is present, submission becomes a gated two-stage operation: upload the complete ordered file batch to the Host, then send the parent prompt with text-only `asset_id` reference parts. Upload failure, adapter unload, conversation teardown, or prompt failure leaves the draft available for retry and never sends a partial prompt. A prompt failure can leave already authorized, content-addressed assets available for a retry; it does not roll durable storage back.

The browser accepts PNG, JPEG, WebP, and GIF files already admitted by the shared composer policy. It encodes the upload payload in bounded chunks, uses the live Session Remote scope for authorization, requires exactly one durable receipt per input file, and rejects an unsupported MIME type or inconsistent receipt count before the parent prompt is sent.

## Configuration

This package has no configuration and no secret handling. The Client receives no provider API key, credential reference, endpoint, or protocol. All model routing and credential resolution occur in the Host's existing Harness services; the only browser-to-Host payload is image data plus optional display names.

## Model Experience

### Browser image intake

#### What the model sees

The parent receives only text such as `Visual asset available through gpt_luna_vision: asset_id=…`. No base64 or raw image block reaches the text-only parent. The Host prompt section and tool schema then tell the parent how to delegate the visual question.

#### Token effect

One short reference line per submitted image is added to the parent prompt. Image bytes stay outside the model-visible text.

#### KV Cache effect

Reference lines are content-addressed and stable for the same persisted attachment, but adding any new image changes the current user-message suffix. Earlier stable prompt turns remain reusable according to the selected provider.

## Known Limitations and Deferred Work

- Exactly one image intake adapter may be active. A duplicate registration fails during plugin activation.
- Upload is submit-time rather than selection-time, so a large batch adds one Host round trip before the parent prompt.
- The adapter exposes no independent gallery or image editor; preview and draft removal remain owned by `ui-conversation`.
