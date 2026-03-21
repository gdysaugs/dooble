import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { buildPromptWithQualityTags } from '../lib/qualityPrompt'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './video-studio.css'

const API_ENDPOINT = '/api/wan'
const FIXED_STEPS = 4
const FIXED_CFG = 1
const FIXED_FPS = 10
const VIDEO_LENGTH_OPTIONS = [
  { seconds: 5, frames: 61, ticketCost: 1, label: '5秒（1トークン）' },
  { seconds: 7, frames: 81, ticketCost: 3, label: '7秒（3トークン）' },
  { seconds: 9, frames: 101, ticketCost: 5, label: '9秒（5トークン）' },
] as const
const DEFAULT_VIDEO_LENGTH_SECONDS = VIDEO_LENGTH_OPTIONS[0].seconds
const resolveVideoLengthOption = (seconds: number) =>
  VIDEO_LENGTH_OPTIONS.find((option) => option.seconds === seconds) ?? VIDEO_LENGTH_OPTIONS[0]
const GUEST_PROMO_IMAGE = '/media/guest-hero/guest-source.png'
const GUEST_PROMO_VIDEO = '/media/guest-hero/guest-demo.mp4'
const GUEST_PROMPT_EXAMPLE = '女性がペンを咥える'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toBase64 = (dataUrl: string) => {
  const parts = dataUrl.split(',')
  return parts.length > 1 ? parts[1] : dataUrl
}

const normalizeVideo = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const isVideoLike = (value: unknown, filename?: string) => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext && ['mp4', 'webm', 'gif'].includes(ext)) return true
  if (typeof value !== 'string') return false
  return value.startsWith('data:video/') || value.startsWith('data:image/gif')
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
        if (!isVideoLike(raw, name)) return null
        return normalizeVideo(raw, name)
      })
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }

  return []
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

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
    return 'GPUメモリ不足です。画像サイズを小さくして再試行してください。'
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
    lowered.includes('no ticket') ||
    lowered.includes('no tickets') ||
    lowered.includes('insufficient_tickets') ||
    lowered.includes('insufficient tickets') ||
    lowered.includes('token') ||
    lowered.includes('credit')
  )
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const alignTo16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
const PORTRAIT_MAX = { width: 576, height: 832 }
const LANDSCAPE_MAX = { width: 832, height: 576 }

const fitWithinBounds = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const aspect = width / height

  if (aspect >= 1) {
    const targetWidth = Math.min(maxWidth, alignTo16(scaledWidth))
    const targetHeight = Math.min(maxHeight, alignTo16(targetWidth / aspect))
    return { width: targetWidth, height: targetHeight }
  }

  const targetHeight = Math.min(maxHeight, alignTo16(scaledHeight))
  const targetWidth = Math.min(maxWidth, alignTo16(targetHeight * aspect))
  return { width: targetWidth, height: targetHeight }
}

const getTargetSize = (width: number, height: number) => {
  const isPortrait = height >= width
  const bounds = isPortrait ? PORTRAIT_MAX : LANDSCAPE_MAX
  return fitWithinBounds(width, height, bounds.width, bounds.height)
}

const buildPaddedDataUrl = (img: HTMLImageElement, targetWidth: number, targetHeight: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
  return canvas.toDataURL('image/png')
}

export function Video() {
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [sourcePayload, setSourcePayload] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [qualityTagsEnabled, setQualityTagsEnabled] = useState(false)
  const [negativePrompt, setNegativePrompt] = useState('')
  const [videoLengthSeconds, setVideoLengthSeconds] = useState(DEFAULT_VIDEO_LENGTH_SECONDS)
  const [width, setWidth] = useState(832)
  const [height, setHeight] = useState(576)
  const [displayVideo, setDisplayVideo] = useState<string | null>(null)
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

  const accessToken = session?.access_token ?? ''
  const selectedVideoLength = useMemo(() => resolveVideoLengthOption(videoLengthSeconds), [videoLengthSeconds])
  const requiredTickets = selectedVideoLength.ticketCost
  const canGenerate = Boolean(sourcePayload && !isRunning && session)
  const isGif = displayVideo?.startsWith('data:image/gif')
  const showGuestPromo = !session && !isRunning && !displayVideo

  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': `${Math.max(1, width)} / ${Math.max(1, height)}`,
      }) as CSSProperties,
    [height, width],
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
        window.alert(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const fetchTickets = useCallback(async (token: string) => {
    if (!token) return null

    setTicketStatus('loading')
    setTicketMessage('')

    const res = await fetch('/api/tickets', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setTicketStatus('error')
      setTicketMessage(data?.error || 'チケット情報の取得に失敗しました。')
      setTicketCount(null)
      return null
    }

    const nextCount = Number(data?.tickets ?? 0)
    setTicketStatus('idle')
    setTicketMessage('')
    setTicketCount(nextCount)
    return nextCount
  }, [])

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
    async (imagePayload: string, token: string) => {
      if (!imagePayload) throw new Error('画像が必要です。')
      const finalPrompt = buildPromptWithQualityTags(prompt, qualityTagsEnabled)

      const input: Record<string, unknown> = {
        mode: 'i2v',
        prompt: finalPrompt,
        negative_prompt: negativePrompt,
        width,
        height,
        fps: FIXED_FPS,
        seconds: selectedVideoLength.seconds,
        num_frames: selectedVideoLength.frames,
        steps: FIXED_STEPS,
        cfg: FIXED_CFG,
        seed: 0,
        randomize_seed: true,
        worker_mode: 'comfyui',
        image_name: sourceName || 'input.png',
      }
      input.image_base64 = imagePayload

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
          setStatusMessage('チケットが不足しています。')
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
      if (!jobId) throw new Error('ジョブIDを取得できませんでした。')
      return { jobId }
    },
    [height, negativePrompt, prompt, qualityTagsEnabled, selectedVideoLength, sourceName, width],
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
        mode: 'i2v',
        seconds: String(selectedVideoLength.seconds),
      })
      const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || 'ステータス確認に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('チケットが不足しています。')
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

  const startGeneration = useCallback(
    async (imagePayload: string) => {
      if (!imagePayload) return
      if (!session) {
        setStatusMessage('先にGoogleログインしてください。')
        return
      }

      const runId = runIdRef.current + 1
      runIdRef.current = runId
      setIsRunning(true)
      setStatusMessage('')
      setDisplayVideo(null)

      try {
        const submitted = await submitVideo(imagePayload, accessToken)
        if (runIdRef.current !== runId) return

        if ('videos' in submitted && submitted.videos.length) {
          setDisplayVideo(submitted.videos[0])
        } else if ('jobId' in submitted) {
          const polled = await pollJob(submitted.jobId, runId, accessToken)
          if (runIdRef.current !== runId) return
          if (polled.status === 'done' && polled.videos.length) {
            setDisplayVideo(polled.videos[0])
          }
        }

        if (accessToken) {
          await fetchTickets(accessToken)
        }
      } catch (error) {
        if (runIdRef.current !== runId) return
        const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
        if (message !== 'TICKET_SHORTAGE') {
          setStatusMessage(message)
        }
      } finally {
        if (runIdRef.current === runId) {
          setIsRunning(false)
        }
      }
    },
    [accessToken, fetchTickets, pollJob, session, submitVideo],
  )

  const clearImage = useCallback(() => {
    setSourcePreview(null)
    setSourcePayload(null)
    setSourceName('')
    setDisplayVideo(null)
    setStatusMessage('')
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => {
        const { width: targetWidth, height: targetHeight } = getTargetSize(img.naturalWidth, img.naturalHeight)
        const paddedDataUrl = buildPaddedDataUrl(img, targetWidth, targetHeight) ?? dataUrl
        setWidth(targetWidth)
        setHeight(targetHeight)
        setSourcePreview(paddedDataUrl)
        setSourcePayload(toBase64(paddedDataUrl))
        setSourceName(file.name)
        setStatusMessage(session ? '画像を読み込みました。プロンプトを入力して生成できます。' : '先にGoogleログインしてください。')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!sourcePayload || isRunning) return
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }

    if (ticketStatus === 'loading') {
      setStatusMessage('チケットを確認中...')
      return
    }

    if (accessToken) {
      setStatusMessage('チケットを確認中...')
      const latestCount = await fetchTickets(accessToken)
      if (latestCount !== null && latestCount < requiredTickets) {
        setShowTicketModal(true)
        return
      }
    } else if (ticketCount === null) {
      setStatusMessage('チケットを確認中...')
      return
    } else if (ticketCount < requiredTickets) {
      setShowTicketModal(true)
      return
    }
    await startGeneration(sourcePayload)
  }

  const handleSaveResult = useCallback(async () => {
    if (!displayVideo || isSavingResult) return
    setIsSavingResult(true)
    try {
      await saveGeneratedAsset({
        source: displayVideo,
        filenamePrefix: 'doobleai-video',
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
            <h1>画像から動画を生成</h1>
            <p>参照画像とプロンプトからi2v動画を作成します。</p>
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
            <h3 className="studio-section-title">素材</h3>
            <label className="studio-upload">
              <input type="file" accept="image/*" onChange={handleFileChange} />
              <div className="studio-upload-inner">
                <strong>{sourceName || '元画像をアップロード'}</strong>
                <span>推奨: 縦832x576以内、横576x832以内</span>
              </div>
            </label>
            {sourcePreview && (
              <div className="studio-thumb-wrap">
                <img src={sourcePreview} alt="元画像プレビュー" className="studio-thumb" />
                <button type="button" className="studio-thumb-remove" onClick={clearImage} aria-label="画像を削除">
                  削除
                </button>
              </div>
            )}
          </section>

          <section className="studio-section">
            <h3 className="studio-section-title">モーション指示</h3>
            <label className="studio-field">
              <span>プロンプト</span>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例: 女性がペンを咥え、カメラがゆっくり寄る"
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
                placeholder="崩れ、ノイズ、低品質"
              />
            </label>
          </section>

          <div className="studio-generate-dock">
            <div className="studio-actions">
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={handleGenerate}
                disabled={!canGenerate}
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

          <div className={`studio-canvas${showGuestPromo ? ' is-guest' : ''}`} style={viewerStyle}>
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

            ) : showGuestPromo ? (
              <section className="studio-guest-promo" aria-label="サービス紹介">
                <div className="studio-guest-promo__header">
                  <h3>画像を1枚アップするだけで、すぐに動画にできます</h3>
                  <p>アップロードした画像と短い指示文だけで、理想の動画が作れます。</p>
                </div>
                <div className="studio-guest-promo__grid">
                  <figure className="studio-guest-promo__card">
                    <figcaption>元画像</figcaption>
                    <img src={GUEST_PROMO_IMAGE} alt="動画化の元画像サンプル" loading="lazy" />
                  </figure>
                  <figure className="studio-guest-promo__card">
                    <figcaption>生成サンプル</figcaption>
                    <video src={GUEST_PROMO_VIDEO} controls playsInline preload="metadata" poster={GUEST_PROMO_IMAGE} />
                  </figure>
                </div>
                <div className="studio-guest-promo__prompt">{`プロンプト例: 「${GUEST_PROMPT_EXAMPLE}」`}</div>
                <ul className="studio-guest-promo__highlights">
                  <li>動画生成は5秒・7秒・9秒から選べる</li>
                  <li>圧倒的高画質</li>
                  <li>独自開発した最先端モデル</li>
                </ul>
              </section>
            ) : (
              <div className="studio-empty">生成結果はここに表示されます。</div>
            )}
          </div>
          {statusMessage && <p className="studio-status studio-status--preview">{statusMessage}</p>}
        </section>

        <nav className="studio-legal-links" aria-label="リーガルリンク">
          <Link className="studio-legal-links__item" to="/terms">
            利用規約
          </Link>
          <Link className="studio-legal-links__item" to="/tokushoho">
            特商法
          </Link>
        </nav>
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
