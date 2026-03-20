import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import { PURCHASE_PLANS } from '../lib/purchasePlans'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './purchase.css'

const OAUTH_REDIRECT_URL =
  import.meta.env.VITE_SUPABASE_REDIRECT_URL ?? (typeof window !== 'undefined' ? window.location.origin : undefined)
const DAILY_BONUS_COOLDOWN_HOURS = 12
const DAILY_BONUS_AMOUNT = 1

const formatRemaining = (targetIso: string | null) => {
  if (!targetIso) return ''
  const target = new Date(targetIso).getTime()
  if (!Number.isFinite(target)) return ''
  const diff = target - Date.now()
  if (diff <= 0) return ''
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1000)
  return `${hours}時間${minutes.toString().padStart(2, '0')}分${seconds.toString().padStart(2, '0')}秒`
}

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'デイリーボーナスに失敗しました。'
  if (typeof value === 'string') return value
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'object' && value) {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe.error ?? maybe.message ?? maybe.detail
    if (typeof picked === 'string' && picked) return picked
  }
  return 'デイリーボーナスに失敗しました。'
}

export function Purchase() {
  const [session, setSession] = useState<Session | null>(null)
  const [authStatus, setAuthStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [authMessage, setAuthMessage] = useState('')
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [purchaseStatus, setPurchaseStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [purchaseMessage, setPurchaseMessage] = useState('')
  const [dailyClaimStatus, setDailyClaimStatus] = useState<string | null>(null)
  const [dailyNextEligibleAt, setDailyNextEligibleAt] = useState<string | null>(null)
  const [dailyCanClaim, setDailyCanClaim] = useState(false)
  const [dailyCountdown, setDailyCountdown] = useState('')
  const [isLoadingDailyStatus, setIsLoadingDailyStatus] = useState(false)
  const [isClaimingDaily, setIsClaimingDaily] = useState(false)

  const accessToken = session?.access_token ?? ''
  const bestValuePlanId = useMemo(() => {
    if (!PURCHASE_PLANS.length) return null
    return [...PURCHASE_PLANS].sort((a, b) => a.price / a.tickets - b.price / b.tickets)[0]?.id ?? null
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthStatus('idle')
      setAuthMessage('')
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
        setAuthStatus('error')
        setAuthMessage(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const fetchTickets = useCallback(async (token: string) => {
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
      return
    }
    setTicketStatus('idle')
    setTicketMessage('')
    setTicketCount(Number(data?.tickets ?? 0))
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      setDailyCanClaim(false)
      setDailyNextEligibleAt(null)
      setDailyCountdown('')
      return
    }
    void fetchTickets(accessToken)
  }, [accessToken, fetchTickets, session])

  const fetchDailyBonusStatus = useCallback(async (token: string) => {
    if (!token) return
    setIsLoadingDailyStatus(true)
    try {
      const res = await fetch('/api/daily-bonus', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDailyCanClaim(false)
        setDailyNextEligibleAt(null)
        setDailyCountdown('')
        return
      }
      const canClaim = Boolean(data?.can_claim)
      const nextEligibleAt = data?.next_eligible_at ? String(data.next_eligible_at) : null
      setDailyCanClaim(canClaim)
      setDailyNextEligibleAt(nextEligibleAt)
      if (!canClaim && nextEligibleAt) {
        setDailyCountdown(formatRemaining(nextEligibleAt))
      } else {
        setDailyCountdown('')
      }
    } finally {
      setIsLoadingDailyStatus(false)
    }
  }, [])

  useEffect(() => {
    if (!session || !accessToken) return
    void fetchDailyBonusStatus(accessToken)
  }, [accessToken, fetchDailyBonusStatus, session])

  useEffect(() => {
    if (!dailyNextEligibleAt || dailyCanClaim) {
      setDailyCountdown('')
      return
    }
    let didRefresh = false
    const update = () => {
      const remain = formatRemaining(dailyNextEligibleAt)
      setDailyCountdown(remain)
      if (!remain && !didRefresh && accessToken) {
        didRefresh = true
        void fetchDailyBonusStatus(accessToken)
      }
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [accessToken, dailyCanClaim, dailyNextEligibleAt, fetchDailyBonusStatus])

  const dailyBonusHint = isLoadingDailyStatus
    ? '次回まで確認中...'
    : dailyCanClaim
      ? '今すぐ受け取り可能'
      : dailyCountdown
        ? `次回まで ${dailyCountdown}`
        : '次回までまもなく'

  const handleGoogleSignIn = async () => {
    if (!supabase || !isAuthConfigured) {
      setAuthStatus('error')
      setAuthMessage('認証設定が未完了です。')
      return
    }
    setAuthStatus('loading')
    setAuthMessage('')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })
    if (error) {
      setAuthStatus('error')
      setAuthMessage(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    setAuthStatus('error')
    setAuthMessage('認証URLの取得に失敗しました。')
  }

  const handleSignOut = async () => {
    if (!supabase) return
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (error) {
      setAuthStatus('error')
      setAuthMessage(error instanceof Error ? error.message : 'ログアウトに失敗しました。')
    }
  }

  const handleCheckout = async (priceId: string) => {
    if (!session || !accessToken) {
      setPurchaseStatus('error')
      setPurchaseMessage('購入するにはログインが必要です。')
      return
    }
    setPurchaseStatus('loading')
    setPurchaseMessage('決済ページへ移動中...')
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ price_id: priceId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.url) {
      setPurchaseStatus('error')
      setPurchaseMessage(data?.error || '決済作成に失敗しました。')
      return
    }
    window.location.assign(data.url)
  }

  const handleClaimDaily = async () => {
    if (!accessToken || !session) {
      setDailyClaimStatus('ログインしてください。')
      return
    }
    if (isClaimingDaily) return
    setIsClaimingDaily(true)
    setDailyClaimStatus(null)
    try {
      const res = await fetch('/api/daily-bonus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = normalizeErrorMessage(data?.error ?? data?.message ?? data?.detail)
        setDailyClaimStatus(message)
        window.alert(message)
        return
      }
      if (data?.granted) {
        setDailyClaimStatus('無料トークンを付与しました。')
        void fetchTickets(accessToken)
        setDailyCanClaim(false)
        setDailyNextEligibleAt(data?.next_eligible_at ? String(data.next_eligible_at) : null)
      } else {
        const reason = data?.reason
        if (reason === 'cooldown' || reason === 'not_eligible_yet') {
          const remain = formatRemaining(data?.next_eligible_at ?? null)
          setDailyClaimStatus(remain ? `次の受け取りまで ${remain}` : 'まだ受け取れません。')
          setDailyCanClaim(false)
          setDailyNextEligibleAt(data?.next_eligible_at ? String(data.next_eligible_at) : null)
        } else {
          setDailyClaimStatus('まだ受け取れません。')
        }
      }
    } catch (error) {
      const message = normalizeErrorMessage(error)
      setDailyClaimStatus(message)
      window.alert(message)
    } finally {
      setIsClaimingDaily(false)
      void fetchDailyBonusStatus(accessToken)
    }
  }

  return (
    <div className="camera-app purchase-app purchase-page">
      <TopNav />
      <main className="token-lab">
        <section className="token-hero">
          <div className="token-hero__intro">
            <p className="token-hero__eyebrow">TOKEN STATION</p>
            <h1>トークン管理と購入</h1>
            <p>制作ペースに合わせて補充。無料トークンは12時間ごとに1枚受け取れます。</p>
          </div>
          <div className="token-balance-card">
            <span className="token-balance-card__label">現在の残高</span>
            <strong>{session ? `${ticketCount ?? 0}` : '--'}</strong>
            <small>{session ? 'tokens' : 'ログインで表示'}</small>
          </div>
        </section>

        <section className="token-layout">
          <article className="token-card token-card--account">
            <div className="token-card__head">
              <div>
                <p className="token-card__kicker">Account</p>
                <h2>アカウント</h2>
              </div>
              {session ? (
                <span className="token-pill token-pill--online">ログイン中</span>
              ) : (
                <span className="token-pill">ゲスト</span>
              )}
            </div>

            {session ? (
              <div className="token-auth-row">
                <div className="token-user">
                  <span className="token-user__label">Signed in as</span>
                  <strong>{session.user?.email ?? 'ログイン中'}</strong>
                </div>
                <button type="button" className="token-button token-button--ghost" onClick={handleSignOut}>
                  ログアウト
                </button>
              </div>
            ) : (
              <div className="token-auth-row">
                <p className="token-auth-lead">購入と無料トークン受け取りにはログインが必要です。</p>
                <button
                  type="button"
                  className="token-button token-button--primary"
                  onClick={handleGoogleSignIn}
                  disabled={authStatus === 'loading'}
                >
                  {authStatus === 'loading' ? '接続中...' : 'Googleで登録 / ログイン'}
                </button>
              </div>
            )}

            {authMessage && <p className="token-inline-message token-inline-message--error">{authMessage}</p>}

            {session && (
              <p className={`token-inline-message ${ticketStatus === 'error' ? 'token-inline-message--error' : ''}`}>
                {ticketStatus === 'loading' && 'トークン確認中...'}
                {ticketStatus !== 'loading' && `トークン残り: ${ticketCount ?? 0}`}
                {ticketStatus === 'error' && ticketMessage ? ` / ${ticketMessage}` : ''}
              </p>
            )}

            {session && (
              <div className="token-bonus-card">
                <div className="token-bonus-card__head">
                  <div>
                    <p className="token-card__kicker">Free Bonus</p>
                    <h3>{`無料トークン（${DAILY_BONUS_COOLDOWN_HOURS}時間ごとに${DAILY_BONUS_AMOUNT}枚）`}</h3>
                  </div>
                  <span className={`token-bonus-state ${dailyCanClaim ? 'is-ready' : ''}`}>{dailyBonusHint}</span>
                </div>
                <div className="token-bonus-card__actions">
                  <button
                    type="button"
                    className="token-button token-button--primary"
                    onClick={handleClaimDaily}
                    disabled={isClaimingDaily || isLoadingDailyStatus || !dailyCanClaim}
                  >
                    {isClaimingDaily ? '受け取り中...' : isLoadingDailyStatus ? '確認中...' : dailyCanClaim ? '受け取る' : '待機中'}
                  </button>
                  {dailyClaimStatus && <span className="token-bonus-result">{dailyClaimStatus}</span>}
                </div>
              </div>
            )}
          </article>

          <article className="token-card token-card--store">
            <div className="token-card__head">
              <div>
                <p className="token-card__kicker">Store</p>
                <h2>トークンプラン</h2>
              </div>
              <span className="token-pill">Stripe 決済</span>
            </div>
            <div className="token-plan-grid">
              {PURCHASE_PLANS.map((plan) => {
                const unitPrice = plan.price / plan.tickets
                const unitPriceDisplay = unitPrice.toLocaleString('ja-JP', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
                const isBestValue = plan.id === bestValuePlanId
                return (
                  <div key={plan.id} className={`token-plan ${isBestValue ? 'is-featured' : ''}`}>
                    <div className="token-plan__top">
                      <div className="token-plan__name">{plan.label}</div>
                      {isBestValue && <span className="token-plan__badge">BEST VALUE</span>}
                    </div>
                    <div className="token-plan__tokens">
                      {plan.tickets}
                      <small> tokens</small>
                    </div>
                    <div className="token-plan__price-row">
                      <div className="token-plan__price">¥{plan.price.toLocaleString()}</div>
                      <div className="token-plan__unit">{`1枚あたり約 ¥${unitPriceDisplay}`}</div>
                    </div>
                    <button
                      type="button"
                      className="token-button token-button--buy"
                      onClick={() => handleCheckout(plan.priceId)}
                      disabled={!session || purchaseStatus === 'loading'}
                    >
                      {purchaseStatus === 'loading' ? '処理中...' : 'このプランを購入'}
                    </button>
                  </div>
                )
              })}
            </div>
            {purchaseMessage && (
              <p className={`token-inline-message ${purchaseStatus === 'error' ? 'token-inline-message--error' : ''}`}>
                {purchaseMessage}
              </p>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}
