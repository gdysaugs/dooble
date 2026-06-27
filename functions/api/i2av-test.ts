import { createClient, type User } from '@supabase/supabase-js'
import { buildCorsHeaders, isCorsBlocked } from '../_shared/cors'

type Env = {
  RUNPOD_I2AV_TEST_API_KEY?: string
  RUNPOD_API_KEY?: string
  RUNPOD_I2AV_TEST_ENDPOINT_URL?: string
  COMFY_ORG_API_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  FOXAI_10EROS_DISTILL_LORA_NAME?: string
  FOXAI_10EROS_DISTILL_LORA_STRENGTH?: string
}

const corsMethods = 'POST, GET, OPTIONS'
const DEFAULT_RUNPOD_ENDPOINT = 'https://api.runpod.ai/v2/bogw8zz9d31j4d'
const SIGNUP_TICKET_GRANT = 3
const VIDEO_DURATION_OPTIONS = [
  { seconds: 5, ticketCost: 1 },
  { seconds: 7, ticketCost: 2 },
  { seconds: 10, ticketCost: 3 },
] as const
const DEFAULT_SECONDS = VIDEO_DURATION_OPTIONS[0].seconds
const LTX_DIMENSION_MULTIPLE = 32
const PORTRAIT_MAX = { width: 512, height: 720 }
const LANDSCAPE_MAX = { width: 720, height: 512 }
const DEFAULT_WIDTH = LANDSCAPE_MAX.width
const DEFAULT_HEIGHT = LANDSCAPE_MAX.height
const DEFAULT_FPS = 24
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_LENGTH = 1000
const MAX_NEGATIVE_PROMPT_LENGTH = 1000
const DEFAULT_DISTILL_LORA_NAME =
  'ltx23/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors'
const DEFAULT_DISTILL_LORA_STRENGTH = 0.65
const PROMPT_SUFFIX =
  'consistent color grading, stable lighting, clean high quality video, smooth motion, stable camera'
const DEFAULT_NEGATIVE_PROMPT =
  'still image, bad quality, subtitles, text, watermark, logo, blur, low quality, noise, artifacts, extra limbs, distorted anatomy, flicker, motion artifacts'
const AUDIO_NEGATIVE_PROMPT =
  'background noise, ambient sound, environmental sound, wind noise, street noise, room tone, crowd noise, nature sounds, water sound, rain sound, traffic noise, machinery noise, static noise, hiss, hum, buzz, echo, reverb, muffled audio, distorted audio, unwanted sound effect, music, background music, bgm'
const INTERNAL_SERVER_ERROR_MESSAGE =
  'サーバー内部エラーが発生しました。時間をおいて再度お試しください。'
const ERROR_LOGIN_REQUIRED = 'ログインが必要です。'
const ERROR_AUTH_FAILED = '認証に失敗しました。'
const ERROR_GOOGLE_ONLY = 'Googleログインのみ対応しています。'
const ERROR_SUPABASE_NOT_SET = 'SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が設定されていません。'
const ERROR_ID_REQUIRED = 'idが必要です。'
const ERROR_PROMPT_REQUIRED = 'プロンプトを入力してください。'
const ERROR_I2V_IMAGE_REQUIRED = '画像をアップロードしてください。'

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })

const resolveEndpoint = (env: Env) =>
  (
    env.RUNPOD_I2AV_TEST_ENDPOINT_URL ??
    DEFAULT_RUNPOD_ENDPOINT
  ).replace(/\/$/, '')

const resolveRunpodApiKey = (env: Env) =>
  (
    env.RUNPOD_I2AV_TEST_API_KEY ??
    env.RUNPOD_API_KEY ??
    ''
  ).trim()

const extractBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/Bearer\s+(.+)/i)
  return match ? match[1] : ''
}

const getSupabaseAdmin = (env: Env) => {
  const url = env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
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

const requireGoogleUser = async (request: Request, env: Env, corsHeaders: HeadersInit) => {
  const token = extractBearerToken(request)
  if (!token) {
    return { response: jsonResponse({ error: ERROR_LOGIN_REQUIRED }, 401, corsHeaders) }
  }
  const admin = getSupabaseAdmin(env)
  if (!admin) {
    return { response: jsonResponse({ error: ERROR_SUPABASE_NOT_SET }, 500, corsHeaders) }
  }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    return { response: jsonResponse({ error: ERROR_AUTH_FAILED }, 401, corsHeaders) }
  }
  if (!isGoogleUser(data.user)) {
    return { response: jsonResponse({ error: ERROR_GOOGLE_ONLY }, 403, corsHeaders) }
  }
  return { admin, user: data.user }
}

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const fetchTicketRow = async (admin: ReturnType<typeof createClient>, user: User) => {
  const email = user.email
  const { data: byUser, error: userError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('user_id', user.id)
    .maybeSingle()
  if (userError) {
    return { error: userError }
  }
  if (byUser) {
    return { data: byUser, error: null }
  }
  if (!email) {
    return { data: null, error: null }
  }
  const { data: byEmail, error: emailError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('email', email)
    .maybeSingle()
  if (emailError) {
    return { error: emailError }
  }
  return { data: byEmail, error: null }
}

const ensureTicketRow = async (admin: ReturnType<typeof createClient>, user: User) => {
  const email = user.email
  if (!email) {
    return { data: null, error: null }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) {
    return { data: null, error }
  }
  if (existing) {
    return { data: existing, error: null, created: false }
  }

  const { data: inserted, error: insertError } = await admin
    .from('user_tickets')
    .insert({ email, user_id: user.id, tickets: SIGNUP_TICKET_GRANT })
    .select('id, email, user_id, tickets')
    .maybeSingle()

  if (insertError || !inserted) {
    const { data: retry, error: retryError } = await fetchTicketRow(admin, user)
    if (retryError) {
      return { data: null, error: retryError }
    }
    return { data: retry, error: null, created: false }
  }

  const grantUsageId = makeUsageId()
  await admin.from('ticket_events').insert({
    usage_id: grantUsageId,
    email,
    user_id: user.id,
    delta: SIGNUP_TICKET_GRANT,
    reason: 'signup_bonus',
    metadata: { source: 'auto_grant' },
  })

  return { data: inserted, error: null, created: true }
}

const ensureTicketAvailable = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  requiredTickets: number,
  corsHeaders: HeadersInit = {},
) => {
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'Email not available.' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await ensureTicketRow(admin, user)
  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }
  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }
  if (existing.tickets < requiredTickets) {
    return { response: jsonResponse({ error: 'No tickets remaining.' }, 402, corsHeaders) }
  }

  return { existing }
}

const consumeTicket = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  ticketCost: number,
  corsHeaders: HeadersInit = {},
) => {
  const cost = Math.max(1, Math.floor(ticketCost))
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'Email not available.' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }
  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: usageId,
    p_cost: cost,
    p_reason: 'generate_video',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? 'Failed to update tickets.'
    if (message.includes('INSUFFICIENT_TICKETS')) {
      return { response: jsonResponse({ error: 'No tickets remaining.' }, 402, corsHeaders) }
    }
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: 'Invalid ticket request.' }, 400, corsHeaders) }
    }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return {
    ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
    alreadyConsumed: Boolean(result?.already_consumed),
  }
}

const isOwnedUsageEvent = (event: any, user: User) => {
  if (!event) return false
  if (event.user_id && event.user_id === user.id) return true
  const eventEmail = typeof event.email === 'string' ? event.email.toLowerCase() : ''
  const userEmail = typeof user.email === 'string' ? user.email.toLowerCase() : ''
  return Boolean(eventEmail && userEmail && eventEmail === userEmail)
}

const requireOwnedUsage = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  const { data, error } = await admin
    .from('ticket_events')
    .select('usage_id, email, user_id, delta, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!data || !isOwnedUsageEvent(data, user)) {
    return { response: jsonResponse({ error: 'Usage not found.' }, 403, corsHeaders) }
  }
  return { usageEvent: data }
}

const refundTicket = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  fallbackTicketCost: number,
  corsHeaders: HeadersInit = {},
) => {
  const email = user.email
  if (!email || !usageId) {
    return { skipped: true }
  }

  const { data: chargeEvent, error: chargeError } = await admin
    .from('ticket_events')
    .select('usage_id, email, user_id, delta, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (chargeError) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!chargeEvent || !isOwnedUsageEvent(chargeEvent, user)) {
    return { skipped: true }
  }

  const charge = chargeEvent as { delta?: unknown; metadata?: { ticket_cost?: unknown } | null }
  const metadataTicketCost = Number(charge.metadata?.ticket_cost)
  const deltaTicketCost = Math.abs(Number(charge.delta))
  const resolvedRefundAmount =
    Number.isFinite(metadataTicketCost) && metadataTicketCost > 0
      ? metadataTicketCost
      : Number.isFinite(deltaTicketCost) && deltaTicketCost > 0
        ? deltaTicketCost
        : fallbackTicketCost
  const refundAmount = Math.max(1, Math.floor(resolvedRefundAmount))

  const refundUsageId = `${usageId}:refund`
  const { data: existingRefund, error: refundCheckError } = await admin
    .from('ticket_events')
    .select('usage_id')
    .eq('usage_id', refundUsageId)
    .maybeSingle()

  if (refundCheckError) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (existingRefund) {
    return { alreadyRefunded: true }
  }

  const { data: existing, error } = await ensureTicketRow(admin, user)
  if (error) {
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }
  if (!existing) {
    return { response: jsonResponse({ error: 'No tickets available.' }, 402, corsHeaders) }
  }
  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('refund_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: refundUsageId,
    p_amount: refundAmount,
    p_reason: 'refund',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? 'Failed to refund tickets.'
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: 'Invalid ticket request.' }, 400, corsHeaders) }
    }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return {
    ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
    alreadyRefunded: Boolean(result?.already_refunded),
  }
}

const hasOutputList = (value: unknown) => Array.isArray(value) && value.length > 0

const hasOutputString = (value: unknown) => typeof value === 'string' && value.trim() !== ''

const hasAssets = (payload: any): boolean => {
  if (!payload || typeof payload !== 'object') return false
  const data = payload as Record<string, unknown>
  const listCandidates = [
    data.images,
    data.videos,
    data.gifs,
    data.outputs,
    data.output_images,
    data.output_videos,
    data.data,
  ]
  if (listCandidates.some(hasOutputList)) return true
  const singleCandidates = [
    data.image,
    data.video,
    data.gif,
    data.output_image,
    data.output_video,
    data.output_image_base64,
    data.output_video_base64,
  ]
  return singleCandidates.some(hasOutputString)
}

const hasAnyAssets = (payload: any) =>
  hasAssets(payload) ||
  hasAssets(payload?.output) ||
  hasAssets(payload?.result) ||
  hasAssets(payload?.output?.output) ||
  hasAssets(payload?.result?.output)

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

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const parseBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

const stripDataUrl = (value: string) => {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma !== -1) {
    return value.slice(comma + 1)
  }
  return value
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())

const estimateBase64Bytes = (value: string) => {
  const trimmed = value.trim()
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

const ensureBase64Input = (label: string, value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  const trimmed = value.trim()
  if (isHttpUrl(trimmed)) {
    throw new Error(`${label} must be base64 (image_url is not allowed).`)
  }
  const base64 = stripDataUrl(trimmed)
  if (!base64) return ''
  const bytes = estimateBase64Bytes(base64)
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`${label} is too large.`)
  }
  return base64
}

const parseOptionalNumber = (value: unknown, min: number, max: number) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return undefined
  const rounded = Math.floor(numberValue)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

const alignToLtxMultiple = (value: number) =>
  Math.max(LTX_DIMENSION_MULTIPLE, Math.round(value / LTX_DIMENSION_MULTIPLE) * LTX_DIMENSION_MULTIPLE)

const fitWithinBounds = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const aspect = width / height

  if (aspect >= 1) {
    const targetWidth = Math.min(maxWidth, alignToLtxMultiple(scaledWidth))
    const targetHeight = Math.min(maxHeight, alignToLtxMultiple(targetWidth / aspect))
    return { width: targetWidth, height: targetHeight }
  }

  const targetHeight = Math.min(maxHeight, alignToLtxMultiple(scaledHeight))
  const targetWidth = Math.min(maxWidth, alignToLtxMultiple(targetHeight * aspect))
  return { width: targetWidth, height: targetHeight }
}

const toSafeLtxDimensions = (width: number, height: number) => {
  const isPortrait = height >= width
  const bounds = isPortrait ? PORTRAIT_MAX : LANDSCAPE_MAX
  return fitWithinBounds(width, height, bounds.width, bounds.height)
}

const normalizeSeed = (value: unknown) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0
  return Math.floor(numberValue)
}

const normalizeSeconds = (value: unknown) => {
  const seconds = Math.floor(Number(value ?? DEFAULT_SECONDS))
  return VIDEO_DURATION_OPTIONS.some((option) => option.seconds === seconds) ? seconds : DEFAULT_SECONDS
}

const ticketCostForSeconds = (seconds: number) =>
  VIDEO_DURATION_OPTIONS.find((option) => option.seconds === seconds)?.ticketCost ?? VIDEO_DURATION_OPTIONS[0].ticketCost

const isAllowedSeconds = (seconds: number) => VIDEO_DURATION_OPTIONS.some((option) => option.seconds === seconds)

const appendPromptSuffix = (prompt: string) => {
  const trimmed = prompt.trim()
  if (!trimmed) return PROMPT_SUFFIX
  return `${trimmed}, ${PROMPT_SUFFIX}`
}

const normalizeDistillLoraStrength = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_DISTILL_LORA_STRENGTH
  return Math.max(0, Math.min(2, parsed))
}

const buildNegativePrompt = (negativePrompt: string) =>
  [negativePrompt, DEFAULT_NEGATIVE_PROMPT, AUDIO_NEGATIVE_PROMPT]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')

const buildRunpodInput = (input: any, env: Env, imageBase64: string, imageName: string) => {
  const rawPrompt = String(input?.prompt ?? input?.text ?? '').trim()
  const negativePrompt = String(input?.negative_prompt ?? input?.negative ?? '').trim()
  const seconds = normalizeSeconds(input?.seconds ?? input?.duration)
  const fps = DEFAULT_FPS
  const requestedWidth = parseOptionalNumber(input?.width, 128, 2048) ?? DEFAULT_WIDTH
  const requestedHeight = parseOptionalNumber(input?.height, 128, 2048) ?? DEFAULT_HEIGHT
  const { width, height } = toSafeLtxDimensions(requestedWidth, requestedHeight)
  const distillLoraName = String(env.FOXAI_10EROS_DISTILL_LORA_NAME ?? DEFAULT_DISTILL_LORA_NAME).trim()
  const distillStrength = normalizeDistillLoraStrength(env.FOXAI_10EROS_DISTILL_LORA_STRENGTH)
  const runpodInput: Record<string, unknown> = {
    mode: 'i2v',
    prompt: appendPromptSuffix(rawPrompt),
    negative_prompt: buildNegativePrompt(negativePrompt),
    seconds,
    fps,
    width,
    height,
    audio_mode: String(input?.audio_mode ?? 'model'),
    generate_audio: parseBoolean(input?.generate_audio, true),
    randomize_seed: parseBoolean(input?.randomize_seed, true),
    seed: normalizeSeed(input?.seed),
    image_base64: imageBase64,
    image_name: imageName,
    metadata: {
      service: 'dooble',
      workflow: 'i2av-test',
      seconds,
      fps,
      width,
      height,
      internal_audio: true,
      distill_lora_strength: distillStrength,
    },
  }

  const videoCfg = Number(input?.video_cfg)
  if (Number.isFinite(videoCfg)) {
    runpodInput.video_cfg = videoCfg
  }
  if (distillLoraName && distillStrength > 0) {
    runpodInput.loras = [{ name: distillLoraName, strength: distillStrength }]
  }
  const comfyKey = String(env.COMFY_ORG_API_KEY ?? '').trim()
  if (comfyKey) {
    runpodInput.comfy_org_api_key = comfyKey
  }

  return { runpodInput, rawPrompt, seconds, fps, width, height, distillStrength }
}

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) {
    return auth.response
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: ERROR_ID_REQUIRED }, 400, corsHeaders)
  }
  const usageId = url.searchParams.get('usage_id') || `i2av_test:${id}`
  const usage = await requireOwnedUsage(auth.admin, auth.user, usageId, corsHeaders)
  if ('response' in usage) {
    return usage.response
  }
  const usageMetadata = (usage.usageEvent as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {}

  const runpodApiKey = resolveRunpodApiKey(env)
  if (!runpodApiKey) {
    return jsonResponse({ error: 'RUNPOD_API_KEY is not set.' }, 500, corsHeaders)
  }

  const endpoint = resolveEndpoint(env)
  const upstream = await fetch(`${endpoint}/status/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${runpodApiKey}` },
  })
  const raw = await upstream.text()
  let payload: any = null
  let ticketsLeft: number | null = null
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = null
  }

  if (payload && (isFailureStatus(payload) || hasOutputError(payload))) {
    const metadataTicketCost = Math.floor(Number(usageMetadata.ticket_cost))
    const metadataSeconds = Math.floor(Number(usageMetadata.seconds))
    const refundTicketCost = Number.isFinite(metadataTicketCost) && metadataTicketCost > 0
      ? metadataTicketCost
      : ticketCostForSeconds(metadataSeconds)
    const refundMeta = {
      job_id: id,
      status: payload?.status ?? payload?.state ?? null,
      source: 'status',
      reason: 'failure',
      usage_id: usageId,
    }
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      refundMeta,
      usageId,
      refundTicketCost,
      corsHeaders,
    )
    if ('response' in refundResult) {
      return refundResult.response
    }
    const nextTickets = Number((refundResult as { ticketsLeft?: unknown }).ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      ticketsLeft = nextTickets
    }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    payload.usage_id = usageId
    if (ticketsLeft !== null) {
      payload.ticketsLeft = ticketsLeft
    }
    return jsonResponse(payload, upstream.status, corsHeaders)
  }

  return new Response(raw, {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) {
    return auth.response
  }

  const runpodApiKey = resolveRunpodApiKey(env)
  if (!runpodApiKey) {
    return jsonResponse({ error: 'RUNPOD_API_KEY is not set.' }, 500, corsHeaders)
  }

  const payload = await request.json().catch(() => null)
  if (!payload) {
    return jsonResponse({ error: 'Invalid request body.' }, 400, corsHeaders)
  }

  const input = payload.input ?? payload
  if (input?.workflow) {
    return jsonResponse({ error: 'workflow overrides are not allowed.' }, 400, corsHeaders)
  }
  const mode = String(input?.mode ?? 'i2v').toLowerCase()
  if (mode !== 'i2v') {
    return jsonResponse({ error: 'mode must be "i2v".' }, 400, corsHeaders)
  }
  const requestedSeconds = Math.floor(Number(input?.seconds ?? input?.duration ?? DEFAULT_SECONDS))
  if (!isAllowedSeconds(requestedSeconds)) {
    return jsonResponse({ error: 'seconds must be 5, 7, or 10.' }, 400, corsHeaders)
  }

  const imageValue = input?.image_base64 ?? input?.image ?? input?.image_url
  if (!imageValue) {
    return jsonResponse({ error: ERROR_I2V_IMAGE_REQUIRED }, 400, corsHeaders)
  }
  let imageBase64 = ''
  try {
    if (typeof input?.image_url === 'string' && input.image_url) {
      throw new Error('image_url is not allowed. Use base64.')
    }
    imageBase64 = ensureBase64Input('image', imageValue)
  } catch {
    return jsonResponse({ error: '画像の読み取りに失敗しました。画像を確認して再度お試しください。' }, 400, corsHeaders)
  }
  if (!imageBase64) {
    return jsonResponse({ error: ERROR_I2V_IMAGE_REQUIRED }, 400, corsHeaders)
  }

  const imageName = String(input?.image_name ?? 'input.png')
  const built = buildRunpodInput(input, env, imageBase64, imageName)
  if (!built.rawPrompt) {
    return jsonResponse({ error: ERROR_PROMPT_REQUIRED }, 400, corsHeaders)
  }
  if (built.rawPrompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Prompt is too long.' }, 400, corsHeaders)
  }
  const rawNegativePrompt = String(input?.negative_prompt ?? input?.negative ?? '')
  if (rawNegativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Negative prompt is too long.' }, 400, corsHeaders)
  }

  const ticketCost = ticketCostForSeconds(built.seconds)
  const ticketCheck = await ensureTicketAvailable(auth.admin, auth.user, ticketCost, corsHeaders)
  if ('response' in ticketCheck) {
    return ticketCheck.response
  }

  const endpoint = resolveEndpoint(env)
  const usageId = `i2av_test:${makeUsageId()}`
  const ticketMeta = {
    prompt_length: built.rawPrompt.length,
    width: built.width,
    height: built.height,
    fps: built.fps,
    seconds: built.seconds,
    mode: 'i2av_test',
    ticket_cost: ticketCost,
    endpoint,
    source: 'reserve',
  }
  const chargeResult = await consumeTicket(auth.admin, auth.user, ticketMeta, usageId, ticketCost, corsHeaders)
  if ('response' in chargeResult) {
    return chargeResult.response
  }
  const chargedTicketsLeft = Number((chargeResult as { ticketsLeft?: unknown }).ticketsLeft)

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runpodApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: built.runpodInput }),
    })
  } catch (error) {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      {
        ...ticketMeta,
        source: 'run',
        reason: 'request_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      usageId,
      ticketCost,
      corsHeaders,
    )
    if ('response' in refundResult) {
      return refundResult.response
    }
    const ticketsLeft = Number((refundResult as { ticketsLeft?: unknown }).ticketsLeft)
    return jsonResponse(
      {
        error: 'RunPod request failed.',
        usage_id: usageId,
        ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
      },
      502,
      corsHeaders,
    )
  }

  const raw = await upstream.text()
  let upstreamPayload: any = null
  try {
    upstreamPayload = JSON.parse(raw)
  } catch {
    upstreamPayload = null
  }

  if (!upstream.ok || (upstreamPayload && (isFailureStatus(upstreamPayload) || hasOutputError(upstreamPayload)))) {
    const jobId = extractJobId(upstreamPayload)
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      {
        ...ticketMeta,
        job_id: jobId ?? undefined,
        status: upstreamPayload?.status ?? upstreamPayload?.state ?? upstream.status,
        source: 'run',
        reason: 'upstream_rejected',
      },
      usageId,
      ticketCost,
      corsHeaders,
    )
    if ('response' in refundResult) {
      return refundResult.response
    }
    const ticketsLeft = Number((refundResult as { ticketsLeft?: unknown }).ticketsLeft)
    const body =
      upstreamPayload && typeof upstreamPayload === 'object'
        ? upstreamPayload
        : { error: raw || 'RunPod request failed.' }
    body.usage_id = usageId
    if (Number.isFinite(ticketsLeft)) {
      body.ticketsLeft = ticketsLeft
    }
    return jsonResponse(body, upstream.status || 500, corsHeaders)
  }

  if (upstreamPayload && typeof upstreamPayload === 'object' && !Array.isArray(upstreamPayload)) {
    const jobId = extractJobId(upstreamPayload)
    await auth.admin
      .from('ticket_events')
      .update({
        metadata: {
          ...ticketMeta,
          job_id: jobId ?? undefined,
          status: upstreamPayload?.status ?? upstreamPayload?.state ?? null,
          source: 'run',
        },
      })
      .eq('usage_id', usageId)
    upstreamPayload.usage_id = usageId
    upstreamPayload.ticket_cost = ticketCost
    if (jobId) {
      upstreamPayload.job_id = jobId
    }
    if (Number.isFinite(chargedTicketsLeft)) {
      upstreamPayload.ticketsLeft = chargedTicketsLeft
    }
    if (hasAnyAssets(upstreamPayload)) {
      upstreamPayload.status = upstreamPayload.status ?? 'COMPLETED'
    }
    return jsonResponse(upstreamPayload, upstream.status, corsHeaders)
  }

  return new Response(raw, {
    status: upstream.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
