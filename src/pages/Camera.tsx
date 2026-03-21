import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { buildPromptWithQualityTags } from '../lib/qualityPrompt'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './video-studio.css'

type RenderResult = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  video?: string
  error?: string
}

const MAX_PARALLEL = 1
const API_ENDPOINT = '/api/wan'
const FIXED_FPS = 10
const FIXED_STEPS = 4
const FIXED_CFG = 1
const FIXED_WIDTH = 832
const FIXED_HEIGHT = 576
const VIDEO_LENGTH_OPTIONS = [
  { seconds: 5, frames: 61, ticketCost: 1, label: '5秒（1トークン）' },
  { seconds: 7, frames: 81, ticketCost: 3, label: '7秒（3トークン）' },
  { seconds: 9, frames: 101, ticketCost: 5, label: '9秒（5トークン）' },
] as const
const DEFAULT_VIDEO_LENGTH_SECONDS = VIDEO_LENGTH_OPTIONS[0].seconds
const resolveVideoLengthOption = (seconds: number) =>
  VIDEO_LENGTH_OPTIONS.find((option) => option.seconds === seconds) ?? VIDEO_LENGTH_OPTIONS[0]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const runQueue = async (tasks: Array<() => Promise<void>>, concurrency: number) => {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      await tasks[index]()
    }
  })
  await Promise.all(runners)
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const normalizeVideo = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const POLICY_BLOCK_MESSAGE =
  'この画像には暴力的な表現、低年齢、または規約違反の可能性があります。別の画像でお試しください。'

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'リクエストに失敗しました。'
  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe?.error ?? maybe?.message ?? maybe?.detail
    if (typeof picked === 'string' && picked) return picked
    if (value instanceof Error && value.message) return value.message
  }
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  const lowered = raw.toLowerCase()
  if (
    lowered.includes('out of memory') ||
    lowered.includes('would exceed allowed memory') ||
    lowered.includes('allocation on device') ||
    lowered.includes('cuda') ||
    lowered.includes('oom')
  ) {
    return '画像サイズエラーです。サイズの小さい画像で再生成してください。'
  }
  if (
    lowered.includes('underage') ||
    lowered.includes('minor') ||
    lowered.includes('child') ||
    lowered.includes('age_range') ||
    lowered.includes('age range') ||
    lowered.includes('agerange') ||
    lowered.includes('policy') ||
    lowered.includes('moderation') ||
    lowered.includes('violence') ||
    lowered.includes('rekognition')
  ) {
    return POLICY_BLOCK_MESSAGE
  }
  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed)
      const message = parsed?.error || parsed?.message || parsed?.detail
      if (typeof message === 'string' && message) return message
    } catch {
      // ignore parse errors
    }
  }
  return raw
}

const isTicketShortage = (status: number, message: string) => {
  if (status === 402) return true
  const lowered = message.toLowerCase()
  return (
    lowered.includes('no tickets') ||
    lowered.includes('no ticket') ||
    lowered.includes('insufficient_tickets') ||
    lowered.includes('insufficient tickets') ||
    lowered.includes('token不足') ||
    lowered.includes('トークン') ||
    lowered.includes('token') ||
    lowered.includes('credit')
  )
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output
  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.output_videos,
    output?.gifs,
    output?.images,
    payload?.videos,
    payload?.gifs,
    payload?.images,
    nested?.videos,
    nested?.outputs,
    nested?.output_videos,
    nested?.gifs,
    nested?.images,
    nested?.data,
  ]
  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = candidate
      .map((item: any) => {
        const raw = item?.video ?? item?.data ?? item?.url ?? item
        const name = item?.filename
        return normalizeVideo(raw, name)
      })
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }
  return []
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

export function Camera() {
  const [prompt, setPrompt] = useState('')
  const [qualityTagsEnabled, setQualityTagsEnabled] = useState(false)
  const [negativePrompt, setNegativePrompt] = useState('')
  const [videoLengthSeconds, setVideoLengthSeconds] = useState(DEFAULT_VIDEO_LENGTH_SECONDS)
  const [results, setResults] = useState<RenderResult[]>([])
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null)
  const [isSavingResult, setIsSavingResult] = useState(false)
  const runIdRef = useRef(0)
  const navigate = useNavigate()

  const totalFrames = results.length || 1
  const completedCount = useMemo(() => results.filter((item) => item.video).length, [results])
  const progress = totalFrames ? completedCount / totalFrames : 0
  const displayVideo = results[0]?.video ?? null
  const accessToken = session?.access_token ?? ''
  const selectedVideoLength = useMemo(() => resolveVideoLengthOption(videoLengthSeconds), [videoLengthSeconds])
  const requiredTickets = selectedVideoLength.ticketCost

  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': `${FIXED_WIDTH} / ${FIXED_HEIGHT}`,
        '--progress': progress,
      }) as CSSProperties,
    [progress],
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
    if (!supabase) return
    const hasCode = typeof window !== 'undefined' && window.location.search.includes('code=')
    const hasState = typeof window !== 'undefined' && window.location.search.includes('state=')
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

  const fetchTickets = useCallback(
    async (token: string) => {
      if (!token) return
      setTicketStatus('loading')
      setTicketMessage('')
      const res = await fetch('/api/tickets', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTicketStatus('error')
        setTicketMessage(data?.error || 'トークン取得に失敗しました。')
        setTicketCount(null)
        return null
      }
      const nextCount = Number(data?.tickets ?? 0)
      setTicketStatus('idle')
      setTicketMessage('')
      setTicketCount(nextCount)
      return nextCount
    },
    [],
  )

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      return
    }
    void fetchTickets(accessToken)
  }, [accessToken, fetchTickets, session])

  const submitVideo = useCallback(
    async (token: string) => {
      const finalPrompt = buildPromptWithQualityTags(prompt, qualityTagsEnabled)
      const input: Record<string, unknown> = {
        mode: 't2v',
        prompt: finalPrompt,
        negative_prompt: negativePrompt,
        width: FIXED_WIDTH,
        height: FIXED_HEIGHT,
        fps: FIXED_FPS,
        seconds: selectedVideoLength.seconds,
        num_frames: selectedVideoLength.frames,
        steps: FIXED_STEPS,
        cfg: FIXED_CFG,
        seed: 0,
        randomize_seed: true,
        worker_mode: 'comfyui',
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || '生成に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('トークン不足')
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }
      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }
      const videos = extractVideoList(data)
      if (videos.length) {
        return { videos }
      }
      const jobId = extractJobId(data)
      if (!jobId) throw new Error('ジョブID取得に失敗しました。')
      return { jobId }
    },
    [negativePrompt, prompt, qualityTagsEnabled, selectedVideoLength],
  )

  const pollJob = useCallback(async (jobId: string, runId: number, token?: string) => {
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return { status: 'cancelled' as const, videos: [] }
      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const params = new URLSearchParams({
        id: jobId,
        mode: 't2v',
        seconds: String(selectedVideoLength.seconds),
      })
      const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || '状態取得に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('トークン不足')
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }
      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }
      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError) {
        const normalized = normalizeErrorMessage(statusError)
        if (isTicketShortage(res.status, normalized)) {
          setShowTicketModal(true)
          setStatusMessage('トークン不足')
          throw new Error('TICKET_SHORTAGE')
        }
      }
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }
      const videos = extractVideoList(data)
      if (videos.length) {
        return { status: 'done' as const, videos }
      }
      await wait(2000 + i * 50)
    }
    throw new Error('生成がタイムアウトしました。')
  }, [selectedVideoLength.seconds])

  const startBatch = useCallback(async () => {
    if (!session) {
      setStatusMessage('Googleでログインしてください。')
      return
    }
    if (ticketStatus === 'loading') {
      setStatusMessage('トークン確認中...')
      return
    }
    if (accessToken) {
      setStatusMessage('トークン確認中...')
      const latestCount = await fetchTickets(accessToken)
      if (latestCount !== null && latestCount < requiredTickets) {
        setShowTicketModal(true)
        return
      }
    } else if (ticketCount === null) {
      setStatusMessage('トークン確認中...')
      return
    } else if (ticketCount < requiredTickets) {
      setShowTicketModal(true)
      return
    }
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setStatusMessage('')
    setResults([{ id: makeId(), status: 'queued' as const }])

    try {
      const tasks = [async () => {
        if (runIdRef.current !== runId) return
        setResults((prev) =>
          prev.map((item, itemIndex) =>
            itemIndex === 0 ? { ...item, status: 'running' as const, error: undefined } : item,
          ),
        )
        try {
          const submitted = await submitVideo(accessToken)
          if (runIdRef.current !== runId) return
          if ('videos' in submitted && submitted.videos.length) {
            setResults((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === 0 ? { ...item, status: 'done' as const, video: submitted.videos[0] } : item,
              ),
            )
            return
          }
          if ('jobId' in submitted) {
            const polled = await pollJob(submitted.jobId, runId, accessToken)
            if (runIdRef.current !== runId) return
            if (polled.status === 'done' && polled.videos.length) {
              setResults((prev) =>
                prev.map((item, itemIndex) =>
                  itemIndex === 0 ? { ...item, status: 'done' as const, video: polled.videos[0] } : item,
                ),
              )
            }
          }
        } catch (error) {
          if (runIdRef.current !== runId) return
          const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
          if (message === 'TICKET_SHORTAGE') {
            setResults((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === 0 ? { ...item, status: 'error' as const, error: 'トークン不足' } : item,
              ),
            )
            setStatusMessage('トークン不足')
            return
          }
          setResults((prev) =>
            prev.map((item, itemIndex) =>
              itemIndex === 0 ? { ...item, status: 'error' as const, error: message } : item,
            ),
          )
          setStatusMessage(message)
          setErrorModalMessage(message)
        }
      }]

      await runQueue(tasks, MAX_PARALLEL)
      if (runIdRef.current === runId) {
        setStatusMessage('完了')
        if (accessToken) {
          void fetchTickets(accessToken)
        }
      }
    } catch (error) {
      const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
      setStatusMessage(message)
      setResults((prev) => prev.map((item) => ({ ...item, status: 'error', error: message })))
      setErrorModalMessage(message)
    } finally {
      if (runIdRef.current === runId) {
        setIsRunning(false)
      }
    }
  }, [accessToken, fetchTickets, pollJob, requiredTickets, session, submitVideo, ticketCount, ticketStatus])

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setStatusMessage('プロンプトを入力してください。')
      return
    }
    await startBatch()
  }

  const isGif = displayVideo?.startsWith('data:image/gif')

  const handleSaveResult = useCallback(async () => {
    if (!displayVideo || isSavingResult) return
    setIsSavingResult(true)
    try {
      await saveGeneratedAsset({
        source: displayVideo,
        filenamePrefix: 'doobleai-t2v',
        fallbackExtension: isGif ? 'gif' : 'mp4',
      })
    } finally {
      setIsSavingResult(false)
    }
  }, [displayVideo, isGif, isSavingResult])

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <div className="studio-loader">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="studio-page">
      <TopNav />
      <main className="studio-wrap">
        <section className="studio-panel studio-panel--controls">
          <header className="studio-heading">
            <h1>テキストから動画を生成</h1>
            <p>{`プロンプトを入力して、${selectedVideoLength.seconds}秒のT2V動画を作成します。`}</p>
          </header>

          <p className="studio-token-line">
            Token:
            <strong className="studio-token-value">
              {session ? ticketCount ?? 0 : '--'}
              <span className="studio-token-icon" aria-hidden="true">
                👑
              </span>
            </strong>
          </p>
          <div className="studio-ticket-row">
            <span className="studio-ticket-label">今回の設定</span>
            <strong className="studio-ticket-value">{`${selectedVideoLength.seconds}秒`}</strong>
            <span className="studio-ticket-cost">{`消費 ${requiredTickets}トークン`}</span>
          </div>

          {ticketStatus === 'error' && ticketMessage && <p className="studio-inline-error">{ticketMessage}</p>}

          <section className="studio-section">
            <h3 className="studio-section-title">シーン指示</h3>
            <label className="studio-field">
              <span>プロンプト</span>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例: 女性がペンを咥え、ゆっくりカメラが寄る、映画風"
              />
            </label>

            <div className="studio-duration-row">
              <span>動画の長さ</span>
              <div className="studio-duration-options" role="radiogroup" aria-label="動画の長さ">
                {VIDEO_LENGTH_OPTIONS.map((option) => (
                  <button
                    key={option.seconds}
                    type="button"
                    role="radio"
                    aria-checked={videoLengthSeconds === option.seconds}
                    className={`studio-duration-option${videoLengthSeconds === option.seconds ? ' is-active' : ''}`}
                    onClick={() => setVideoLengthSeconds(option.seconds)}
                    disabled={isRunning}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="studio-toggle-row">
              <span>品質タグ(有効にすると高画質化タグを内部で埋め込みます)</span>
              <button
                type="button"
                role="switch"
                aria-checked={qualityTagsEnabled}
                className={`studio-switch${qualityTagsEnabled ? ' is-on' : ''}`}
                onClick={() => setQualityTagsEnabled((prev) => !prev)}
                aria-label="品質タグを有効化"
              >
                <span className="studio-switch-thumb" />
              </button>
            </div>

            <label className="studio-field">
              <span>除外したい要素(任意)</span>
              <textarea
                rows={3}
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="低品質、ブレ、ノイズ、破綻"
              />
            </label>
          </section>

          <div className="studio-generate-dock">
            <div className="studio-actions">
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={handleGenerate}
                disabled={isRunning || !prompt.trim() || !session}
              >
                {isRunning ? '生成中...' : '動画を生成'}
              </button>
            </div>
            {statusMessage && <p className="studio-status">{statusMessage}</p>}
          </div>
        </section>

        <section className="studio-panel studio-panel--preview">
          <div className="studio-preview-head">
            <h2>生成結果</h2>
          </div>

          <div className="studio-canvas" style={viewerStyle}>
            <div className="viewer-progress" aria-hidden="true" />
            {isRunning ? (
              <div className="studio-loading" role="status" aria-live="polite">
                <div className="studio-loading__halo" aria-hidden="true">
                  <div className="studio-loading__core" />
                  <div className="studio-spinner" />
                </div>
                <p className="studio-loading__title">動画を生成しています</p>
                <p className="studio-loading__subtitle">モデル起動とフレーム生成を実行中です。しばらくお待ちください。</p>
                <div className="studio-loading__steps" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : displayVideo ? (
              <div className="studio-result-media">
                <button
                  type="button"
                  className="studio-save-btn"
                  onClick={handleSaveResult}
                  disabled={isSavingResult}
                >
                  {isSavingResult ? 'Saving...' : 'Save'}
                </button>
                {isGif ? <img src={displayVideo} alt="Generated video" /> : <video controls src={displayVideo} />}
              </div>

            ) : (
              <div className="studio-empty">生成結果はここに表示されます。</div>
            )}
          </div>
          {statusMessage && <p className="studio-status studio-status--preview">{statusMessage}</p>}
        </section>
      </main>

      {showTicketModal && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>チケット不足</h3>
            <p>{`この設定ではチケット${requiredTickets}枚が必要です。購入ページで追加してください。`}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--ghost" onClick={() => setShowTicketModal(false)}>
                閉じる
              </button>
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => navigate('/purchase')}>
                購入ページへ
              </button>
            </div>
          </div>
        </div>
      )}

      {errorModalMessage && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>エラー</h3>
            <p>{errorModalMessage}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => setErrorModalMessage(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}




