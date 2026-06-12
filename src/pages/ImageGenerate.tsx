import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Session } from '@supabase/supabase-js'
import { TopNav } from '../components/TopNav'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import './camera.css'
import './video-studio.css'

type SubmitImageResult =
  | { images: string[]; jobId?: never; usageId?: never }
  | { images?: never; jobId: string; usageId: string }

const MAX_PROMPT_LENGTH = 1000
const MAX_NEGATIVE_PROMPT_LENGTH = 1000
const TICKET_COST = 1
const OAUTH_REDIRECT_URL =
  typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchWithCurrentAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.delete('Authorization')
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

const normalizeImage = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:image/') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/png'
  return `data:${mime};base64,${value}`
}

const extractImageList = (payload: any) => {
  const roots = [
    payload,
    payload?.output,
    payload?.result,
    payload?.output?.output,
    payload?.result?.output,
    payload?.output?.result,
    payload?.result?.result,
    payload?.upstream,
    payload?.upstream?.output,
  ]

  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    const listCandidates = [root.images, root.outputs, root.output_images, root.data]
    for (const candidate of listCandidates) {
      if (!Array.isArray(candidate)) continue
      const images = candidate
        .map((item: any) => {
          const raw = item?.image ?? item?.data ?? item?.url ?? item?.output ?? item
          const filename = item?.filename ?? item?.name
          return normalizeImage(raw, filename)
        })
        .filter(Boolean) as string[]
      if (images.length) return images
    }

    const direct = root.image ?? root.output_image ?? root.output_image_base64 ?? root.output_base64
    const image = normalizeImage(direct, root.filename ?? root.name)
    if (image) return [image]
  }

  return []
}

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id || payload?.result?.id

const extractUsageId = (payload: any) => payload?.usage_id || payload?.usageId || payload?.output?.usage_id || ''

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.detail ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'リクエストに失敗しました。'
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe.error ?? maybe.message ?? maybe.detail
    if (typeof picked === 'string' && picked) return picked
  }
  const raw = String(value).trim()
  const lowered = raw.toLowerCase()
  if (lowered.includes('out of memory') || lowered.includes('cuda') || lowered.includes('oom')) {
    return 'GPUメモリ不足です。時間を置いて再試行してください。'
  }
  return raw || 'リクエストに失敗しました。'
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isRetryableStatusCheck = (status: number) => {
  if (status === 0 || status === 401 || status === 404 || status === 408 || status === 409 || status === 425 || status === 429) return true
  return status >= 500
}

const isTicketShortage = (status: number, message: string) => {
  if (status === 402) return true
  const lowered = message.toLowerCase()
  return lowered.includes('insufficient') || lowered.includes('ticket') || lowered.includes('credit')
}

export function ImageGenerate() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isSavingResult, setIsSavingResult] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const runIdRef = useRef(0)

  const accessToken = session?.access_token ?? ''
  const trimmedPrompt = prompt.trim()
  const trimmedNegativePrompt = negativePrompt.trim()
  const canGenerate = Boolean(
    trimmedPrompt &&
      trimmedPrompt.length <= MAX_PROMPT_LENGTH &&
      trimmedNegativePrompt.length <= MAX_NEGATIVE_PROMPT_LENGTH &&
      session &&
      !isRunning,
  )
  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': '832 / 1216',
      }) as CSSProperties,
    [],
  )

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return
    const hasCode = window.location.search.includes('code=')
    const hasState = window.location.search.includes('state=')
    if (!hasCode || !hasState) return

    supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
      if (error) {
        setStatusMessage(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const fetchTickets = useCallback(async () => {
    setTicketStatus('loading')
    setTicketMessage('')

    try {
      const res = await fetchWithCurrentAuth('/api/tickets')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTicketStatus('error')
        setTicketMessage(data?.error || 'ポイント情報の取得に失敗しました。')
        setTicketCount(null)
        return null
      }

      const nextCount = Number(data?.tickets ?? 0)
      setTicketStatus('idle')
      setTicketMessage('')
      setTicketCount(nextCount)
      return nextCount
    } catch {
      setTicketStatus('error')
      setTicketMessage('ポイント情報の取得に失敗しました。')
      setTicketCount(null)
      return null
    }
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      return
    }
    void fetchTickets()
  }, [accessToken, fetchTickets, session])

  const handleGoogleSignIn = useCallback(async () => {
    if (isRunning) return
    if (!supabase || !isAuthConfigured) {
      setStatusMessage('認証設定が未完了です。')
      return
    }

    setStatusMessage('Googleログインへ移動します…')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })
    if (error) {
      setStatusMessage(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    setStatusMessage('認証URLの取得に失敗しました。')
  }, [isRunning])

  const submitImage = useCallback(async (): Promise<SubmitImageResult> => {
    const res = await fetchWithCurrentAuth('/api/image-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          prompt: trimmedPrompt,
          negative_prompt: trimmedNegativePrompt,
          randomize_seed: true,
        },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = normalizeErrorMessage(extractErrorMessage(data) || '生成に失敗しました。')
      if (isTicketShortage(res.status, message)) {
        throw new Error('ポイントが不足しています。')
      }
      throw new Error(message)
    }

    const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
    if (Number.isFinite(nextTickets)) setTicketCount(nextTickets)

    const images = extractImageList(data)
    if (images.length) return { images }

    const jobId = extractJobId(data)
    const usageId = extractUsageId(data)
    if (!jobId || !usageId) throw new Error('ジョブIDを取得できませんでした。')
    return { jobId: String(jobId), usageId: String(usageId) }
  }, [trimmedNegativePrompt, trimmedPrompt])

  const pollJob = useCallback(async (jobId: string, usageId: string, runId: number) => {
    let statusCheckFailures = 0
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return null

      const params = new URLSearchParams({
        id: jobId,
        usage_id: usageId,
      })

      let res: Response
      let data: any = {}
      try {
        res = await fetchWithCurrentAuth(`/api/image-generate?${params.toString()}`)
        data = await res.json().catch(() => ({}))
      } catch {
        statusCheckFailures += 1
        if (statusCheckFailures < 30) {
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error('ステータス確認に失敗しました。')
      }

      if (!res.ok) {
        const message = normalizeErrorMessage(extractErrorMessage(data) || 'ステータス確認に失敗しました。')
        if (isRetryableStatusCheck(res.status) && statusCheckFailures < 30) {
          statusCheckFailures += 1
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error(message)
      }
      statusCheckFailures = 0

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) setTicketCount(nextTickets)

      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }

      const images = extractImageList(data)
      if (images.length) return images[0]

      await wait(2000 + i * 50)
    }

    throw new Error('生成がタイムアウトしました。')
  }, [])

  const startGeneration = useCallback(async () => {
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!trimmedPrompt) {
      setStatusMessage('プロンプトを入力してください。')
      return
    }
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      setStatusMessage('プロンプトは1000文字以内で入力してください。')
      return
    }
    if (trimmedNegativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
      setStatusMessage('ネガティブプロンプトは1000文字以内で入力してください。')
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setResultImage(null)
    setStatusMessage('画像を生成中です…')

    try {
      const submitted = await submitImage()
      if (runIdRef.current !== runId) return

      if ('images' in submitted && submitted.images?.length) {
        setResultImage(submitted.images[0])
        setStatusMessage('画像生成が完了しました。')
        if (accessToken) await fetchTickets()
        return
      }

      if (!submitted.jobId || !submitted.usageId) {
        throw new Error('ジョブIDを取得できませんでした。')
      }
      const image = await pollJob(submitted.jobId, submitted.usageId, runId)
      if (!image || runIdRef.current !== runId) return
      setResultImage(image)
      setStatusMessage('画像生成が完了しました。')
      if (accessToken) await fetchTickets()
    } catch (error) {
      if (runIdRef.current !== runId) return
      setStatusMessage(normalizeErrorMessage(error))
    } finally {
      if (runIdRef.current === runId) setIsRunning(false)
    }
  }, [accessToken, fetchTickets, pollJob, session, submitImage, trimmedNegativePrompt, trimmedPrompt])

  const clearResult = useCallback(() => {
    setResultImage(null)
    setStatusMessage('')
  }, [])

  const saveResult = useCallback(async () => {
    if (!resultImage || isSavingResult) return
    setIsSavingResult(true)
    try {
      await saveGeneratedAsset({
        source: resultImage,
        filenamePrefix: 'dooble-image',
        fallbackExtension: 'png',
      })
    } finally {
      setIsSavingResult(false)
    }
  }, [isSavingResult, resultImage])

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <main className="studio-loader">読み込み中...</main>
      </div>
    )
  }

  return (
    <div className="studio-page">
      <TopNav />
      <main className="studio-wrap">
        <section className="studio-panel studio-panel--controls">
          <header className="studio-heading">
            <h1>画像生成</h1>
            <p>入力したイメージをもとに、用途に合わせた高品質な画像を生成します。SNS投稿、作品制作、アイデア出しに活用できます。</p>
          </header>

          {session ? (
            <>
              <div className="studio-ticket-row">
                <span className="studio-ticket-label">保有ポイント</span>
                <span className="studio-ticket-value">{ticketStatus === 'loading' ? '確認中' : ticketCount ?? '-'}</span>
                <span className="studio-ticket-cost">消費 {TICKET_COST} ポイント</span>
              </div>
              {ticketMessage ? <p className="studio-inline-error">{ticketMessage}</p> : null}

              <label className="studio-field">
                <span>プロンプト（必須、1000文字まで）</span>
                <textarea
                  value={prompt}
                  maxLength={MAX_PROMPT_LENGTH}
                  placeholder="作りたい画像の内容を入力。例: 雨の夜、ネオン街を歩く女性、リアルな質感"
                  disabled={isRunning}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <p className="studio-status">{prompt.length}/{MAX_PROMPT_LENGTH}</p>

              <label className="studio-field">
                <span>ネガティブプロンプト（任意、1000文字まで）</span>
                <textarea
                  value={negativePrompt}
                  maxLength={MAX_NEGATIVE_PROMPT_LENGTH}
                  placeholder="避けたい要素を入力"
                  disabled={isRunning}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                />
              </label>
              <p className="studio-status">{negativePrompt.length}/{MAX_NEGATIVE_PROMPT_LENGTH}</p>

              <div className="studio-actions">
                <button className="studio-btn studio-btn--primary" type="button" disabled={!canGenerate} onClick={startGeneration}>
                  {isRunning ? '生成中...' : '生成する'}
                </button>
                <button className="studio-btn studio-btn--ghost" type="button" disabled={isRunning && !resultImage} onClick={clearResult}>
                  クリア
                </button>
              </div>
            </>
          ) : (
            <div className="studio-chat-bubble">
              <strong>ログインが必要です</strong>
              <p>Googleログイン後に画像生成を利用できます。</p>
              <div className="studio-actions">
                <button className="studio-btn studio-btn--primary" type="button" onClick={handleGoogleSignIn}>
                  Googleでログイン
                </button>
              </div>
            </div>
          )}

          {statusMessage ? <p className="studio-status">{statusMessage}</p> : null}
        </section>

        <section className="studio-panel studio-panel--preview">
          <div className="studio-preview-head">
            <h2>生成結果</h2>
          </div>

          <div className="studio-canvas" style={viewerStyle}>
            {isRunning ? (
              <div className="studio-loading" role="status" aria-live="polite">
                <div className="studio-loading__halo" aria-hidden="true">
                  <div className="studio-loading__core" />
                  <div className="studio-spinner" />
                </div>
                <p className="studio-loading__title">画像を生成しています</p>
                <p className="studio-loading__subtitle">モデル起動と画像生成を実行中です。しばらくお待ちください。</p>
                <div className="studio-loading__steps" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : resultImage ? (
              <>
                <img className="studio-result-media" src={resultImage} alt="生成画像" />
                <button className="studio-save-btn" type="button" disabled={isSavingResult} onClick={saveResult}>
                  {isSavingResult ? '保存中' : '保存'}
                </button>
              </>
            ) : (
              <div className="studio-preview-idle">
                <p>生成後の画像がここに表示されます。</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
