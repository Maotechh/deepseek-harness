/** Real Loader, agent loop, persistent sessions and HTTP callbacks; only the school model is scripted. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import * as Gateway from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let context: Context | undefined
let root: string | undefined
let callback: Server | undefined
afterEach(async () => {
  try { await context?.fiber.dispose() } finally {
    try {
      const current = callback
      if (current !== undefined) await new Promise<void>((resolve, reject) => current.close((error) => {
        if (error) reject(error)
        else resolve()
      }))
    }
    finally { if (root !== undefined) await rm(root, { recursive: true, force: true }) }
  }
  context = undefined; root = undefined; callback = undefined
})

async function load() {
  root = await mkdtemp(join(tmpdir(), 'dsh-lab-loader-'))
  const calls: { authorization: string | undefined; body: unknown }[] = []
  callback = createServer((req, res) => {
    void (async () => {
      const parts = []
      for await (const chunk of req) parts.push(Buffer.from(chunk))
      calls.push({ authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()) })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ status: 'pending_confirmation', task_id: 'server-task', preview: { changes: [] } }))
    })().catch((error: unknown) => { res.writeHead(500); res.end(String(error)) })
  })
  await new Promise<void>(resolve => callback!.listen(0, '127.0.0.1', resolve))
  const address = callback.address()
  if (address === null || typeof address === 'string') throw new Error('Callback did not bind TCP')
  const modules = { llm: LlmRuntime, session: SessionStore, projection: SessionProjectionRegistry,
    systemPrompt: SystemPrompt, tools: ToolRuntime, executor: NativeToolExecutor, agents: AgentRegistry, loop: AgentLoop,
    persistence: Persistence, attachments: LocalAttachmentStore, skills: SkillRegistry, speech: SpeechToText, gateway: Gateway }
  const configs: Record<string, object> = { loop: { agents: [] }, persistence: { root: join(root, 'sessions'), compression: 'none' },
    attachments: { dshHome: join(root, 'home') }, speech: { defaultProvider: 'sensevoice-local' },
    gateway: { port: 0, callbackBase: `http://127.0.0.1:${address.port}`, provider: 'mock', model: 'mock' } }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, Object.keys(modules).flatMap(name => [
    `- name: 'cordis:${name}'`, ...configs[name] === undefined ? [] : [`  config: ${JSON.stringify(configs[name])}`],
  ]).join('\n') + '\n')
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const ready = Promise.withResolvers<number>()
  ctx.on('lab/gateway-ready', (port) => { ready.resolve(port) })
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, modules, { include: Include })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const port = await ready.promise
  const base = `http://127.0.0.1:${port}`
  const request = (runId: string, text = 'Prepare two beakers') => fetch(base + '/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, conversationId: 'b'.repeat(32), callbackToken: 'c'.repeat(40), text, systemPrompt: 'All changes require server preview and confirmation.' }) })
  return { ctx, calls, base, request, root }
}

it('persists skill and preview tools, ends at server preview, and resumes the shared session', async () => {
  const fixture = await load()
  const adapter = new MockAdapter([toolCallResponse('skill', 'load_skill', { name: 'experiment-preparation' }),
    toolCallResponse('preview', 'business_preview', { arguments: { kind: 'stock', payload: { item_id: 1, action: 'consume', quantity: '2' } } }),
    textResponse('The server preview is still awaiting confirmation.')])
  fixture.ctx.llm.registerAdapter(['mock'], adapter)
  const response = await fixture.request('a'.repeat(32))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'completed', preview: true, toolCalls: 2 })
  expect(fixture.calls).toEqual([{ authorization: 'Bearer ' + 'c'.repeat(40), body: { name: 'business_preview', arguments: { kind: 'stock', payload: { item_id: 1, action: 'consume', quantity: '2' } } } }])
  expect(adapter.requests).toHaveLength(2)
  expect(JSON.stringify(adapter.requests[1])).toContain('per_person')
  expect(JSON.stringify(adapter.requests[1])).not.toContain('without inject')
  const names = adapter.requests[0]!.tools?.map(tool => tool.name)
  expect(names).toEqual(expect.arrayContaining(['business_preview', 'load_skill']))
  expect(names).not.toEqual(expect.arrayContaining(['bash', 'confirm', 'read_file', 'fetch']))
  const second = await fixture.request('d'.repeat(32), 'What remains pending?')
  expect(await second.json()).toMatchObject({ status: 'completed', reply: 'The server preview is still awaiting confirmation.' })
  const files = await readdir(join(fixture.root, 'sessions'), { recursive: true })
  const logs = await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => readFile(join(fixture.root, 'sessions', file), 'utf8')))
  expect(logs.join('\n')).toContain('server-task')
  expect(logs.join('\n')).toContain('experiment-preparation')
  expect(logs.join('\n')).toContain('What remains pending?')
})

it('rejects overlapping conversation work and drains cancellation before accepting the next run', async () => {
  const fixture = await load()
  const entered = Promise.withResolvers<undefined>()
  // The first model request calls a tool before the second stream waits for cancellation.
  const firstResponse = toolCallResponse('skill', 'load_skill', { name: 'inventory' })
  class CancellableModel extends MockAdapter {
    override async * stream(options: GenerateOptions) {
      if (this.requests.length === 1) entered.resolve(undefined)
      yield* super.stream(options)
    }
  }
  const model = new CancellableModel([firstResponse, 'hang', textResponse('continued')])
  fixture.ctx.llm.registerAdapter(['mock'], model)
  const active = fixture.request('a'.repeat(32))
  await entered.promise
  expect((await fixture.request('d'.repeat(32))).status).toBe(409)
  expect((await fetch(fixture.base + '/runs/' + 'a'.repeat(32) + '/cancel', { method: 'POST' })).status).toBe(200)
  expect(await (await active).json()).toMatchObject({ status: 'cancelled' })
  expect((await fixture.request('e'.repeat(32))).status).toBe(200)
})

it('rejects noncanonical audio before starting recognition', async () => {
  const fixture = await load()
  const response = await fetch(fixture.base + '/voice', { method: 'POST', body: Buffer.from('invalid') })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ status: 'failed', code: 'INVALID_AUDIO' })
  expect(fixture.calls).toEqual([])
})
