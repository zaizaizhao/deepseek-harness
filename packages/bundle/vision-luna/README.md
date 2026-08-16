# `@deepseek-ai/dsh-vision-luna`

English | [中文](README.zh.md)

Optional Web-profile bundle for governed visual delegation. Apply it after [`@deepseek-ai/dsh-base`](../base/README.md) and [`@deepseek-ai/dsh-web-app`](../web-app/README.md). Its [`cordis.patch.yml`](cordis.patch.yml) mounts the Host tool [`@deepseek-ai/dsh-tool-vision-luna`](../../subagent/tool-vision-luna/README.md) and the browser intake adapter [`@deepseek-ai/dsh-client-ui-vision-luna`](../../client/ui-vision-luna/README.md).

The patch selects `zaizaizhao/gpt-5.6-luna` and non-secret execution limits only. It does not carry an API key, credential reference, endpoint, protocol, or request headers. Define the `zaizaizhao` provider profile through the existing `llm-pi-ai` section of `$DSH_HOME/settings.yaml`; keep its referenced secret in the Harness credentials document or inherited process environment.

## Model Experience

### Composed vision delegation

#### What the model sees

The text-only parent receives one `gpt_luna_vision` tool and explicit instructions never to infer image contents. The browser uploads pasted, dropped, or selected images before sending the parent prompt, then inserts only opaque `asset_id` references into that text prompt. A one-shot `spawn` child receives the question and durable image attachments using the configured Luna route and returns structured evidence, OCR, observations, uncertainty, and Host-owned trace fields.

#### Token effect

The parent request gains one stable tool schema, one guidance section, and one short reference line per submitted image. The child receives one bounded instruction plus image attachment blocks; image bytes never become parent text.

#### KV Cache effect

The parent prompt gains one stable tool schema and one stable guidance section. Completed visual results use a bounded process-local cache keyed by parent Session, image digests, question, region, provider, model, output budget, and prompt version.

## Known Limitations and Deferred Work

- This bundle targets the Web profile because its client half depends on the browser conversation surface.
- The custom provider's model catalog must explicitly declare both `text` and `image` input; missing capability metadata fails the tool call.
- Browser upload accepts raster images only. URL intake is disabled until the deployment supplies exact HTTPS origins in a later profile patch.
- A provider change under the same route id requires a process restart to discard completed process-local cache entries.
