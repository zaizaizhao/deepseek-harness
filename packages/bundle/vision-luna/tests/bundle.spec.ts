/** The bundle is a static, parseable two-row patch with no credential fields. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-vision-luna bundle', () => {
  it('mounts the Host and browser halves while leaving provider credentials to Harness', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifestText = readFileSync(resolve(root, 'package.json'), 'utf8')
    const manifest = JSON.parse(manifestText) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patchText = readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8')
    const parsed = yaml.load(patchText, { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }[])
      .flatMap(patch => patch.insert ?? [])
    expect(rows).toEqual([
      {
        id: 'tool-vision-luna',
        name: '@deepseek-ai/dsh-tool-vision-luna',
        config: {
          provider: 'zaizaizhao',
          model: 'gpt-5.6-luna',
          maxTokens: 4096,
          maxDepth: 1,
          maxConcurrency: 1,
          cacheMaxEntries: 128,
          maxQuestionBytes: 8192,
          visionTimeoutMs: 120000,
          enableRunInBackground: true,
        },
      },
      { id: 'ui-vision-luna', name: '@deepseek-ai/dsh-client-ui-vision-luna' },
    ])
    expect(patchText).not.toMatch(/^\s+(apiKey|apiKeyEnv|baseURL|headers|protocol|retry):/m)
    expect(manifest.dependencies).toEqual(expect.objectContaining({
      '@deepseek-ai/dsh-client-ui-vision-luna': 'workspace:^',
      '@deepseek-ai/dsh-tool-vision-luna': 'workspace:^',
    }))
  })
})
