import workflowTemplate from './image-generate-workflow.json'
import nodeMapTemplate from './image-generate-node-map.json'
import { createClient, type User } from '@supabase/supabase-js'
import { getSupabaseUserWithRetry } from '../_shared/auth-retry'
import { buildCorsHeaders, isCorsBlocked } from '../_shared/cors'

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => any
type SupabaseAdmin = any

type Env = {
  RUNPOD_API_KEY?: string
  RUNPOD_I2AV_TEST_API_KEY?: string
  RUNPOD_Z_IMAGE_API_KEY?: string
  RUNPOD_Z_IMAGE_ENDPOINT_URL?: string
  RUNPOD_ENDPOINT_URL?: string
  COMFY_ORG_API_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  CORS_ALLOWED_ORIGINS?: string
}

type AuthResult = { admin: SupabaseAdmin; user: User } | { response: Response }

type TicketEventRow = {
  usage_id: string
  user_id: string | null
  email: string | null
  delta: number | null
  metadata: Record<string, unknown> | null
}

type NodeMapEntry = {
  id: string
  input: string
}

type NodeMapValue = NodeMapEntry | NodeMapEntry[]

type NodeMap = Partial<{
  prompt: NodeMapValue
  negative_prompt: NodeMapValue
  seed: NodeMapValue
  steps: NodeMapValue
  cfg: NodeMapValue
  width: NodeMapValue
  height: NodeMapValue
  batch_size: NodeMapValue
  filename_prefix: NodeMapValue
}>

const corsMethods = 'POST, GET, OPTIONS'
const SIGNUP_TICKET_GRANT = 3
const TICKET_COST = 1
const MAX_PROMPT_LENGTH = 1000
const MAX_NEGATIVE_PROMPT_LENGTH = 1000
const FIXED_STEPS = 8
const FIXED_CFG = 1
const FIXED_WIDTH = 832
const FIXED_HEIGHT = 1216
const FIXED_BATCH_SIZE = 1
const FILENAME_PREFIX = 'dooble-image-generate'
const DEFAULT_Z_IMAGE_ENDPOINT = 'https://api.runpod.ai/v2/l0dbci4na63s7g'

const INTERNAL_SERVER_ERROR_MESSAGE = 'Server processing failed. Please try again later.'
const ERROR_LOGIN_REQUIRED = 'Login is required.'
const ERROR_AUTH_FAILED = 'Authentication failed.'
const ERROR_GOOGLE_ONLY = 'Google login is required.'
const ERROR_SUPABASE_NOT_SET = 'Supabase server setting is missing.'
const ERROR_EMAIL_MISSING = 'Email address is missing.'
const ERROR_NO_TICKETS = 'Not enough tickets.'
const ERROR_INVALID_TICKET_REQUEST = 'Invalid ticket operation.'
const ERROR_ID_REQUIRED = 'id is required.'
const ERROR_USAGE_ID_REQUIRED = 'usage_id is required.'
const ERROR_JOB_NOT_FOUND = 'Job not found.'
const ERROR_PROMPT_REQUIRED = 'Prompt is required.'
const ERROR_PROMPT_TOO_LONG = 'Prompt is too long.'
const ERROR_NEGATIVE_PROMPT_TOO_LONG = 'Negative prompt is too long.'
const ERROR_IMAGE_GENERATE_DISABLED = 'Image generation is no longer available.'
const HIDDEN_MODEL_NAME_PATTERN =
  /z[-_\s]?image|pornmasterZImage_turboV35Fp8|qwen_3_4b|mystic-xxx-zit-v4|[a-z]+-z-image-basic/gi
const HIDDEN_MODEL_FILE_PATTERN = /[A-Za-z0-9_./%\\\-\s]+?\.(safetensors|gguf|onnx|pt|pth|ckpt|bin)/gi
const GENERIC_MODEL_LABEL = 'image model'
const UNSAFE_PAYLOAD_KEYS = new Set([
  'data',
  'image',
  'images',
  'output_image',
  'output_images',
  'output_image_base64',
  'output_base64',
])

const sanitizeUserText = (value: string) =>
  value
    .replace(HIDDEN_MODEL_NAME_PATTERN, GENERIC_MODEL_LABEL)
    .replace(HIDDEN_MODEL_FILE_PATTERN, `${GENERIC_MODEL_LABEL}.bin`)

const sanitizeJsonPayload = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    if (UNSAFE_PAYLOAD_KEYS.has(key) || value.length > 4096) return value
    return sanitizeUserText(value)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonPayload(item, key))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      next[entryKey] = sanitizeJsonPayload(entryValue, entryKey)
    }
    return next
  }
  return value
}

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const normalizeEndpoint = (value?: string) => {
  const trimmed = (value ?? '').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return trimmed
  } catch {
    return ''
  }
}

const resolveEndpoint = (env: Env) =>
  normalizeEndpoint(env.RUNPOD_Z_IMAGE_ENDPOINT_URL) || DEFAULT_Z_IMAGE_ENDPOINT

const resolveRunpodApiKey = (env: Env) =>
  (env.RUNPOD_Z_IMAGE_API_KEY || env.RUNPOD_I2AV_TEST_API_KEY || env.RUNPOD_API_KEY || '').trim()

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const parseTicketMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const normalizeEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const isUsageOwnedByUser = (event: Pick<TicketEventRow, 'user_id' | 'email'>, user: User) => {
  if (event.user_id && event.user_id === user.id) return true
  const userEmail = normalizeEmail(user.email ?? '')
  return Boolean(userEmail && normalizeEmail(event.email) === userEmail)
}

const extractBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/Bearer\s+(.+)/i)
  return match ? match[1] : ''
}

const getSupabaseAdmin = (env: Env): SupabaseAdmin | null => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const isGoogleUser = (user: User) => {
  if (user.app_metadata?.provider === 'google') return true
  if (Array.isArray(user.identities)) {
    return user.identities.some((identity) => identity.provider === 'google')
  }
  return false
}

const requireGoogleUser = async (request: Request, env: Env, corsHeaders: HeadersInit): Promise<AuthResult> => {
  const token = extractBearerToken(request)
  if (!token) return { response: jsonResponse({ error: ERROR_LOGIN_REQUIRED }, 401, corsHeaders) }

  const admin = getSupabaseAdmin(env)
  if (!admin) return { response: jsonResponse({ error: ERROR_SUPABASE_NOT_SET }, 500, corsHeaders) }

  const { data, error } = await getSupabaseUserWithRetry(admin, token)
  if (error || !data?.user) return { response: jsonResponse({ error: ERROR_AUTH_FAILED }, 401, corsHeaders) }
  if (!isGoogleUser(data.user)) return { response: jsonResponse({ error: ERROR_GOOGLE_ONLY }, 403, corsHeaders) }

  return { admin, user: data.user }
}

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const fetchUsageEvent = async (admin: SupabaseAdmin, usageId: string) => {
  const { data, error } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (error || !data) {
    return { event: null as TicketEventRow | null, error }
  }

  return {
    event: {
      usage_id: String(data.usage_id),
      user_id: data.user_id ? String(data.user_id) : null,
      email: data.email ? String(data.email) : null,
      delta: Number.isFinite(Number(data.delta)) ? Number(data.delta) : null,
      metadata: parseTicketMetadata(data.metadata),
    } satisfies TicketEventRow,
    error: null,
  }
}

const requireOwnedUsageChargeEvent = async (
  admin: SupabaseAdmin,
  user: User,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  const { event, error } = await fetchUsageEvent(admin, usageId)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!event || !isUsageOwnedByUser(event, user) || Number(event.delta) >= 0) {
    return { response: jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders) }
  }
  return { event }
}

const bindUsageToJob = async (
  admin: SupabaseAdmin,
  user: User,
  usageId: string,
  jobId: string | null,
) => {
  if (!jobId) return
  const usageEvent = await fetchUsageEvent(admin, usageId)
  if (usageEvent.error || !usageEvent.event || !isUsageOwnedByUser(usageEvent.event, user)) return

  const metadata = usageEvent.event.metadata ?? {}
  if (String(metadata.job_id ?? '') === jobId) return
  await admin.from('ticket_events').update({ metadata: { ...metadata, job_id: jobId } }).eq('usage_id', usageId)
}

const fetchTicketRow = async (admin: SupabaseAdmin, user: User) => {
  const email = user.email
  const { data: byUser, error: userError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('user_id', user.id)
    .maybeSingle()
  if (userError) return { error: userError }
  if (byUser) return { data: byUser, error: null }
  if (!email) return { data: null, error: null }

  const { data: byEmail, error: emailError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .ilike('email', email)
    .maybeSingle()
  if (emailError) return { error: emailError }
  return { data: byEmail, error: null }
}

const ensureTicketRow = async (admin: SupabaseAdmin, user: User) => {
  const email = user.email
  if (!email) return { data: null, error: null }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) return { data: null, error }
  if (existing) return { data: existing, error: null, created: false }

  const { data: inserted, error: insertError } = await admin
    .from('user_tickets')
    .insert({ email, user_id: user.id, tickets: SIGNUP_TICKET_GRANT })
    .select('id, email, user_id, tickets')
    .maybeSingle()

  if (insertError || !inserted) {
    const { data: retry, error: retryError } = await fetchTicketRow(admin, user)
    if (retryError) return { data: null, error: retryError }
    return { data: retry, error: null, created: false }
  }

  await admin.from('ticket_events').insert({
    usage_id: makeUsageId(),
    email,
    user_id: user.id,
    delta: SIGNUP_TICKET_GRANT,
    reason: 'signup_bonus',
    metadata: { source: 'auto_grant' },
  })

  return { data: inserted, error: null, created: true }
}

const consumeTicket = async (
  admin: SupabaseAdmin,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  if (!user.email) return { response: jsonResponse({ error: ERROR_EMAIL_MISSING }, 400, corsHeaders) }

  const { data: existing, error } = await ensureTicketRow(admin, user)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!existing) return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }

  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }
  if (Number(existing.tickets) < TICKET_COST) {
    return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: usageId,
    p_cost: TICKET_COST,
    p_reason: 'image_generate',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? INTERNAL_SERVER_ERROR_MESSAGE
    if (message.includes('INSUFFICIENT_TICKETS')) {
      return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }
    }
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: ERROR_INVALID_TICKET_REQUEST }, 400, corsHeaders) }
    }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return { ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined }
}

const refundTicket = async (
  admin: SupabaseAdmin,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  if (!user.email || !usageId) return { skipped: true }

  const { data: chargeEvent, error: chargeError } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (chargeError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!chargeEvent) return { skipped: true }

  const chargeDelta = Number((chargeEvent as { delta?: unknown }).delta)
  const chargeOwner = {
    user_id: (chargeEvent as { user_id?: unknown }).user_id ? String((chargeEvent as { user_id?: unknown }).user_id) : null,
    email: (chargeEvent as { email?: unknown }).email ? String((chargeEvent as { email?: unknown }).email) : null,
  }
  if (!Number.isFinite(chargeDelta) || chargeDelta >= 0 || !isUsageOwnedByUser(chargeOwner, user)) {
    return { skipped: true }
  }

  const refundUsageId = `${usageId}:refund`
  const { data: existingRefund, error: refundCheckError } = await admin
    .from('ticket_events')
    .select('usage_id')
    .eq('usage_id', refundUsageId)
    .maybeSingle()

  if (refundCheckError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (existingRefund) return { alreadyRefunded: true }

  const { data: ticketRow, error } = await ensureTicketRow(admin, user)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!ticketRow) return { skipped: true }

  const { data: rpcData, error: rpcError } = await admin.rpc('refund_tickets', {
    p_ticket_id: ticketRow.id,
    p_usage_id: refundUsageId,
    p_amount: TICKET_COST,
    p_reason: 'image_generate_refund',
    p_metadata: metadata,
  })

  if (rpcError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return { ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined }
}

const hasOutputList = (value: unknown) => Array.isArray(value) && value.length > 0

const hasOutputString = (value: unknown) => typeof value === 'string' && value.trim() !== ''

const hasAssets = (payload: any) => {
  if (!payload || typeof payload !== 'object') return false
  const data = payload as Record<string, unknown>
  const listCandidates = [data.images, data.outputs, data.output_images, data.data]
  if (listCandidates.some(hasOutputList)) return true
  const singleCandidates = [data.image, data.output_image, data.output_image_base64]
  return singleCandidates.some(hasOutputString)
}

const hasOutputError = (payload: any) =>
  Boolean(
    payload?.error ||
      payload?.output?.error ||
      payload?.result?.error ||
      payload?.output?.output?.error ||
      payload?.result?.output?.error,
  )

const isFailureStatus = (payload: any) => {
  const status = String(payload?.status ?? payload?.state ?? '').toLowerCase()
  return status.includes('fail') || status.includes('error') || status.includes('cancel')
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id || payload?.result?.id

const setInputValue = (workflow: Record<string, any>, entry: NodeMapEntry, value: unknown) => {
  const node = workflow[entry.id]
  if (!node?.inputs) throw new Error(`Node ${entry.id} not found in workflow.`)
  node.inputs[entry.input] = value
}

const applyNodeMap = (workflow: Record<string, any>, nodeMap: NodeMap, values: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(values)) {
    const entry = nodeMap[key as keyof NodeMap]
    if (!entry || value === undefined || value === null) continue
    const entries = Array.isArray(entry) ? entry : [entry]
    for (const item of entries) setInputValue(workflow, item, value)
  }
}

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })
  return jsonResponse({ error: ERROR_IMAGE_GENERATE_DISABLED }, 410, corsHeaders)

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const url = new URL(request.url)
  const id = url.searchParams.get('id')?.trim()
  const usageId = url.searchParams.get('usage_id')?.trim() || url.searchParams.get('usageId')?.trim() || ''
  if (!id) return jsonResponse({ error: ERROR_ID_REQUIRED }, 400, corsHeaders)
  if (!usageId) return jsonResponse({ error: ERROR_USAGE_ID_REQUIRED }, 400, corsHeaders)

  const usageEventResult = await requireOwnedUsageChargeEvent(auth.admin, auth.user, usageId, corsHeaders)
  if ('response' in usageEventResult) return usageEventResult.response

  const usageJobId = String(usageEventResult.event.metadata?.job_id ?? '')
  if (!usageJobId || usageJobId !== id) return jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders)

  const apiKey = resolveRunpodApiKey(env)
  const endpoint = resolveEndpoint(env)
  if (!apiKey || !endpoint) return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders)

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/status/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 502, corsHeaders)
  }

  const raw = await upstream.text()
  let payload: any = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }

  let ticketsLeft: number | undefined
  if (payload && (isFailureStatus(payload) || hasOutputError(payload))) {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      { source: 'image_generate_status', job_id: id, status: payload?.status ?? payload?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload.usage_id = usageId
    if (ticketsLeft !== undefined) payload.ticketsLeft = ticketsLeft
    return jsonResponse(sanitizeJsonPayload(payload), upstream.status, corsHeaders)
  }

  return new Response(raw.length > 4096 ? raw : sanitizeUserText(raw), {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })
  return jsonResponse({ error: ERROR_IMAGE_GENERATE_DISABLED }, 410, corsHeaders)

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const apiKey = resolveRunpodApiKey(env)
  const endpoint = resolveEndpoint(env)
  if (!apiKey || !endpoint) return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders)

  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ error: 'Invalid request body.' }, 400, corsHeaders)
  }

  const input = (payload as Record<string, unknown>).input ?? payload
  const safeInput = typeof input === 'object' && input && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  if (safeInput.workflow) return jsonResponse({ error: 'workflow overrides are not allowed.' }, 400, corsHeaders)

  const prompt = String(safeInput.prompt ?? safeInput.text ?? '').trim()
  const negativePrompt = String(safeInput.negative_prompt ?? safeInput.negativePrompt ?? '').trim()
  if (!prompt) return jsonResponse({ error: ERROR_PROMPT_REQUIRED }, 400, corsHeaders)
  if (prompt.length > MAX_PROMPT_LENGTH) return jsonResponse({ error: ERROR_PROMPT_TOO_LONG }, 400, corsHeaders)
  if (negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
    return jsonResponse({ error: ERROR_NEGATIVE_PROMPT_TOO_LONG }, 400, corsHeaders)
  }

  const seed = safeInput.randomize_seed === false ? Math.floor(Number(safeInput.seed ?? 1)) : Math.floor(Math.random() * 2147483647)
  const resolvedSeed = Number.isFinite(seed) && seed >= 0 ? seed : 1

  const usageId = `image_generate:${makeUsageId()}`
  let ticketsLeft: number | undefined
  const ticketMeta = {
    source: 'image_generate',
    prompt_length: prompt.length,
    negative_prompt_length: negativePrompt.length,
    width: FIXED_WIDTH,
    height: FIXED_HEIGHT,
    steps: FIXED_STEPS,
    cfg: FIXED_CFG,
    ticket_cost: TICKET_COST,
  }

  const ticketCharge = await consumeTicket(auth.admin, auth.user, ticketMeta, usageId, corsHeaders)
  if ('response' in ticketCharge) return ticketCharge.response
  if ('ticketsLeft' in ticketCharge) ticketsLeft = ticketCharge.ticketsLeft

  const workflow = clone(workflowTemplate) as Record<string, any>
  const nodeMap = nodeMapTemplate as NodeMap
  try {
    applyNodeMap(workflow, nodeMap, {
      prompt,
      negative_prompt: negativePrompt,
      seed: resolvedSeed,
      steps: FIXED_STEPS,
      cfg: FIXED_CFG,
      width: FIXED_WIDTH,
      height: FIXED_HEIGHT,
      batch_size: FIXED_BATCH_SIZE,
      filename_prefix: FILENAME_PREFIX,
    })
  } catch {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      { ...ticketMeta, reason: 'workflow_apply_failed' },
      usageId,
      corsHeaders,
    )
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft }, 500, corsHeaders)
  }

  const runpodInput: Record<string, unknown> = { workflow }
  const comfyKey = String(env.COMFY_ORG_API_KEY ?? '').trim()
  if (comfyKey) runpodInput.comfy_org_api_key = comfyKey

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: runpodInput }),
    })
  } catch {
    const refundResult = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'network_error' }, usageId, corsHeaders)
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const raw = await upstream.text()
  let upstreamPayload: any = null
  try {
    upstreamPayload = raw ? JSON.parse(raw) : null
  } catch {
    upstreamPayload = null
  }

  if (!upstreamPayload || typeof upstreamPayload !== 'object' || Array.isArray(upstreamPayload)) {
    const refundResult = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'parse_error' }, usageId, corsHeaders)
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const jobId = extractJobId(upstreamPayload)
  if (jobId) await bindUsageToJob(auth.admin, auth.user, usageId, String(jobId))

  const isFailure = !upstream.ok || isFailureStatus(upstreamPayload) || hasOutputError(upstreamPayload)
  if (isFailure) {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      { ...ticketMeta, reason: 'runpod_failure', status: upstreamPayload?.status ?? upstreamPayload?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
  }

  upstreamPayload.usage_id = usageId
  if (ticketsLeft !== undefined) upstreamPayload.ticketsLeft = ticketsLeft
  return jsonResponse(sanitizeJsonPayload(upstreamPayload), upstream.status, corsHeaders)
}
