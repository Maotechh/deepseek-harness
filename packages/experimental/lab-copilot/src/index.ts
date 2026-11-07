/** Restricted loopback gateway for the campus laboratory website. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as json } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-skill'
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave'

/** Cordis plugin name. */
export const name = 'experimental-lab-copilot'
/** Required lifecycle and capability services. */
export const inject = ['agents', 'sessions', 'sessionPersistence', 'systemPrompt', 'tools', 'speechToText', 'attachments', 'skills']

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The gateway is accepting loopback requests.
     * @mode emit
     * @param port - Bound port available to the local business server.
     */
    'lab/gateway-ready'(port: number): void
  }
}

/** Local transport and model limits. */
export interface Config {
  /** Loopback HTTP port; zero requests an operating-system-assigned port. */
  port: number
  /** Loopback business-server origin for authenticated tool callbacks. */
  callbackBase: string
  /** Registered institution model provider identifier. */
  provider: string
  /** Qualified institution model identifier. */
  model: string
  /** Total run deadline in milliseconds, at most five minutes. */
  maxRunMs: number
  /** Maximum tool calls per run, including skill loading, at most forty. */
  maxToolCalls: number
}
/** Deployment validation; only loopback business callbacks are permitted. */
export const Config: z<Config> = z.object({
  port: z.natural().max(65535).default(8766),
  callbackBase: z.string().pattern(/^http:\/\/127\.0\.0\.1:\d+$/).required(),
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  maxRunMs: z.natural().min(1000).max(300000).default(300000),
  maxToolCalls: z.natural().min(1).max(40).default(40),
})

const runRequest = json.object({
  runId: json.string().regex(/^[a-f0-9]{32}$/),
  conversationId: json.string().regex(/^[a-f0-9]{32}$/),
  callbackToken: json.string().min(32).max(100),
  text: json.string().min(1).max(200000),
  systemPrompt: json.string().min(1).max(100000),
  images: json.array(json.object({
    name: json.string().max(250),
    data: json.string().max(4000000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: json.literal('image/jpeg').default('image/jpeg'),
  }).strict()).max(8).default([]),
}).strict()
type RunRequest = json.infer<typeof runRequest>
const toolNames = [
  'inventory_search', 'workflow_query', 'history_search', 'prepare_attachment',
  'inventory_import_preview', 'business_preview', 'export_inventory',
  'read_attachment', 'analyze_attachments', 'export_task', 'export_history',
] as const

class GatewayFailure extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message) }
}

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    if (!(chunk instanceof Uint8Array)) throw new GatewayFailure('INVALID_BODY', 'Expected binary request bytes', 400)
    const part = Buffer.from(chunk)
    size += part.length
    if (size > limit) throw new GatewayFailure('TOO_LARGE', 'Request exceeds the byte limit', 413)
    parts.push(part)
  }
  return Buffer.concat(parts)
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * Mount the private HTTP gateway. Runs own their whole inbox-to-idle interval;
 * concurrent requests for one conversation are refused before creation.
 * @param ctx - profile-owned context; disposal cancels and drains all agents.
 * @param config - validated local endpoints, model selection and budgets.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const running = new Map<string, { promise: Promise<object>; cancel: () => void }>()
  const conversations = new Set<string>()
  let accepting = true
  const skillNames = ['inventory', 'loans', 'experiment-preparation', 'purchasing', 'counting-maintenance', 'attachments', 'reminders']
  for (const skillName of skillNames) {
    const content = await readFile(new URL(`../docs/skills/${skillName}/SKILL.md`, import.meta.url), 'utf8')
    const description = content.split('\n').at(0)
    if (!description) throw new Error(`Packaged skill has no description: ${skillName}`)
    ctx.effect(() => ctx.skills.register({ name: skillName, description, content, source: 'bundled' }))
  }

  async function run(input: RunRequest): Promise<object> {
    const id = SessionId(`lab-${input.conversationId}`)
    let handle: AgentHandle | undefined
    let reply = ''
    let calls = 0
    let failure: string | undefined
    let preview = false
    const controller = new AbortController()
    const cancel = () => {
      controller.abort()
      handle?.agent.cancel({ kind: 'user' })
    }
    const timer = setTimeout(() => {
      failure = 'RUN_LIMIT'
      cancel()
    }, config.maxRunMs)
    const pending = running.get(input.runId)
    if (pending !== undefined) pending.cancel = cancel
    const setup = (scope: Context) => {
      scope.systemPrompt.section({ name: 'lab-rules', order: 0, text: `${input.systemPrompt}\nLoad the matching skill before business work with load_skill. Available skills: ${skillNames.join(', ')}.`, interpolate: false, complete: true })
      scope.on('session/event', (_session, event) => {
        if (event.type === 'assistant/message' && event.data.interrupted !== true) {
          reply = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        }
      })
      scope.on('agent/error', () => { failure = 'MODEL_FAILED' })
      scope.effect(() => scope.tools.register(defineTool({
        name: 'load_skill', description: 'Read the packaged laboratory workflow instructions before performing the matching task.',
        parameters: { name: { type: 'string', enum: skillNames, required: true } },
        output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute(args) {
          if (++calls > config.maxToolCalls) { failure = 'TOOL_LIMIT'; cancel(); throw new GatewayFailure('TOOL_LIMIT', 'Tool call limit reached', 429) }
          const skill = await ctx.skills.get(args.name)
          if (skill === undefined) throw new GatewayFailure('SKILL_UNAVAILABLE', 'Packaged skill is unavailable', 503)
          return { name: skill.name, instructions: skill.content }
        },
      })))
      for (const toolName of toolNames) {
        scope.effect(() => scope.tools.register(defineTool({
          name: toolName,
          description: toolName === 'business_preview'
            ? 'Validate and preview a business plan. Never executes it. Ends this turn after a persisted preview.'
            : `Campus laboratory ${toolName}. Arguments follow the laboratory system instructions.`,
          parameters: { arguments: { type: 'object', additionalProperties: true, required: true } },
          output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
          isConcurrencySafe: () => false,
          async execute(args, exec) {
            if (++calls > config.maxToolCalls) {
              failure = 'TOOL_LIMIT'
              handle?.agent.cancel({ kind: 'hook', reason: 'Lab tool limit' })
              throw new GatewayFailure('TOOL_LIMIT', 'Tool call limit reached', 429)
            }
            const response = await fetch(`${config.callbackBase}/api/internal/dsh/${input.runId}/tools`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.callbackToken}` },
              body: JSON.stringify({ name: toolName, arguments: args.arguments }),
              signal: AbortSignal.any([controller.signal, exec.signal, AbortSignal.timeout(60000)]),
            })
            if (!response.ok) throw new GatewayFailure('BUSINESS_CALLBACK_FAILED', 'Business tool rejected the request', 502)
            const value = json.json().parse(await response.json())
            if (toolName === 'business_preview' && typeof value === 'object' && value !== null && !Array.isArray(value)
              && value.status === 'pending_confirmation') {
              preview = true
              exec.concludeTurn()
            }
            return value
          },
        })))
      }
    }
    try {
      const options = {
        agentOptions: { provider: config.provider, model: config.model, maxTokens: 65536 }, setup, signal: controller.signal,
      }
      const exists = await ctx.sessionPersistence.stat(id, { signal: controller.signal })
      handle = exists === undefined
        ? await ctx.agents.create({ ...options, sessionId: id })
        : await ctx.agents.resume({ ...options, resumeSessionId: id })
      controller.signal.throwIfAborted()
      const content = await ctx.attachments.admitPromptContent([
        { type: 'text', text: input.text },
        ...input.images.map(image => ({ type: 'image' as const, data: image.data, mediaType: 'image/jpeg' as const, name: image.name })),
      ])
      handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      await ctx.sessions.flush(handle.agent.session)
      const status = failure ?? (controller.signal.aborted ? 'cancelled' : 'completed')
      return { runId: input.runId, sessionId: id, status, reply, preview, toolCalls: calls }
    } catch (error) {
      if (!controller.signal.aborted) throw error
      return { runId: input.runId, sessionId: id, status: failure ?? 'cancelled', reply: '', preview, toolCalls: calls }
    } finally {
      clearTimeout(timer)
      await handle?.dispose()
      conversations.delete(input.conversationId)
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!accepting) throw new GatewayFailure('STOPPING', 'Gateway is stopping', 503)
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { status: 'ok', speech: ctx.speechToText.snapshot(), tools: toolNames })
      return
    }
    if (req.method === 'POST' && req.url === '/voice') {
      const audio = await body(req, 4 * 1024 * 1024)
      try { validateWave(audio, 120) }
      catch (error) {
        throw new GatewayFailure('INVALID_AUDIO', error instanceof Error ? error.message : 'Invalid WAV recording', 400)
      }
      const spec = ctx.speechToText.resolve({ audio, language: 'zh' })
      const signal = AbortSignal.timeout(120000)
      const result = await ctx.speechToText.transcribe(spec, signal)
      send(res, 200, result)
      return
    }
    const cancellation = /^\/runs\/([a-f0-9]{32})\/cancel$/.exec(req.url ?? '')
    if (req.method === 'POST' && cancellation?.[1] !== undefined) {
      const current = running.get(cancellation[1])
      current?.cancel()
      send(res, 200, { status: current === undefined ? 'not_running' : 'cancelling' })
      return
    }
    if (req.method !== 'POST' || req.url !== '/runs') throw new GatewayFailure('NOT_FOUND', 'Unknown endpoint', 404)
    let input: RunRequest
    try { input = runRequest.parse(JSON.parse((await body(req, 34 * 1024 * 1024)).toString('utf8'))) }
    catch (error) {
      if (error instanceof GatewayFailure) throw error
      throw new GatewayFailure('INVALID_REQUEST', 'Request JSON is invalid', 400)
    }
    const existing = running.get(input.runId)
    if (existing !== undefined) {
      send(res, 200, await existing.promise)
      return
    }
    if (conversations.has(input.conversationId)) throw new GatewayFailure('BUSY', 'Conversation has another running request', 409)
    conversations.add(input.conversationId)
    // Register before running so cancellation owns creation as well as inference.
    const deferred = Promise.withResolvers<object>()
    running.set(input.runId, { promise: deferred.promise, cancel: () => undefined })
    const task = run(input)
    task.then(deferred.resolve, deferred.reject)
    try { send(res, 200, await deferred.promise) } finally { running.delete(input.runId) }
  }

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      const expected = error instanceof GatewayFailure
      send(res, expected ? error.status : 500, { status: 'failed', code: expected ? error.code : 'GATEWAY_FAILED' })
      if (!expected) ctx.logger.error(error)
    })
  })
  await ctx.effect(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Lab gateway did not bind a TCP port')
    ctx.emit('lab/gateway-ready', address.port)
    server.on('error', (error) => { ctx.logger.error(error) })
    return async () => {
      accepting = false
      const closed = new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error)
        else resolve()
      }))
      for (const task of running.values()) task.cancel()
      await Promise.allSettled([...running.values()].map(task => task.promise))
      await closed
    }
  })
}
