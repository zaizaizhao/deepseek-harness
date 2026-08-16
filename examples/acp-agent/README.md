# acp-agent example

English | [中文](README.zh.md)

Automation-oriented [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. It is intended for parent agents, subagent providers, and other programmatic clients, not as the product UI.

```sh
pnpm run demo:acp             # needs DEEPSEEK_API_KEY (repo-root .env or env)
pnpm run demo:code-mode       # same protocol with the Code Mode tool transport
```

The leaf loads the ACP app, DeepSeek adapter, sandboxed bash and filesystem stacks, one-shot approval policy, compaction, subagents, workflows, hooks, a derived session-query index, and repeat guard. The app creates one fresh agent per `session/new`, persists sessions to JSONL, and keeps stdout protocol-pure. Optional overlays add session queries, filesystem spill storage, Code Mode, or web fetching.

## Text-only parent with Luna vision

[`vision-luna.cordis.yml`](vision-luna.cordis.yml) adds the same attachment, jobs, settings, credentials, generic LLM adapter, and vision-tool plugins used by the installable `@deepseek-ai/dsh-vision-luna` bundle. The ACP parent remains on DeepSeek; each `gpt_luna_vision` call starts an isolated `zaizaizhao/gpt-5.6-luna` child. Configure that provider under the Harness-owned `llm-pi-ai:` settings namespace and store the referenced `ZAIZAIZHAO_API_KEY` through the Models page, `$DSH_HOME/.credentials.yaml`, or the launch environment. The vision plugin accepts no key, endpoint, protocol, or headers.

```sh
node --import tsx packages/examples/acp-demo/src/bin.ts \
  --config examples/acp-agent/vision-luna.cordis.yml
pnpm exec vitest run --config vitest.snapshot.config.ts \
  -t 'snapshot: vision-luna matches the expected outputs'
```

The second command is keyless and proves the assembled transcript: the parent request contains no image block, the child route is `zaizaizhao/gpt-5.6-luna`, and the result returned to the parent is structured text. The [host plugin reference](../../packages/subagent/tool-vision-luna/README.md) owns the provider schema, credential ownership, security checks, and limits.

## Protocol channel

Stdout carries only newline-delimited ACP JSON-RPC. `@deepseek-ai/dsh-acp-demo` installs no stdout logger; leaf additions must use stderr for diagnostics.

The automation contract — supported methods, baseline prompt content, committed-text output, and the intentionally absent UI surfaces — lives in [`@deepseek-ai/dsh-acp`](../../packages/acp/acp/README.md).

## Session workspaces and permissions

Each `session/new` supplies an absolute `cwd`. Sandboxed bash and filesystem mutations resolve `workspace-write` against that session cwd, so concurrent sessions can use separate project roots; platform temporary roots remain shared writable scratch space ([sandbox contract](../../packages/sandbox/sandbox/README.md)). `DSH_PERMISSION_MODE` selects `workspace-write` or `danger-full-access` for the deployment.

Under `workspace-write`, a model retry requesting wider sandbox access triggers `session/request_permission` with `allow_once` and `reject_once`. The client decides programmatically; dismissal or an unavailable answer fails closed. The selected outcome applies only to that retry and is recorded through the normal tool-result/audit path. The server never exposes a permission picker or persists client policy.
