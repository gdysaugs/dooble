import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { NavLink } from 'react-router-dom'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'

const OAUTH_REDIRECT_URL =
  import.meta.env.VITE_SUPABASE_REDIRECT_URL ?? (typeof window !== 'undefined' ? window.location.origin : undefined)

export function TopNav() {
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(!supabase)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setIsAuthReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setIsAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsAuthReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return

    const rawHash = window.location.hash
    if (!rawHash || !rawHash.includes('access_token=')) return

    const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash)
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    if (!accessToken || !refreshToken) return

    let isCancelled = false
    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error || isCancelled) return
        const url = new URL(window.location.href)
        url.hash = ''
        window.history.replaceState({}, document.title, url.toString())
      })
      .catch(() => {
        // no-op: onAuthStateChange/getSession already handles auth status display.
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const handleGoogleSignIn = useCallback(async () => {
    if (!supabase || !isAuthConfigured) {
      window.alert('認証設定が未完了です。')
      return
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })

    if (error) {
      window.alert(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    window.alert('認証URLの取得に失敗しました。')
  }, [])

  const isLoggedIn = Boolean(session)
  const showGuestHeader = isAuthReady && !isLoggedIn
  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header className={`top-nav${showGuestHeader ? ' top-nav--guest' : ''}${isMenuOpen ? ' top-nav--menu-open' : ''}`}>
      <div className="top-nav__brand">
        <img className="top-nav__logo" src="/favicon.png" alt="" aria-hidden="true" />
        <NavLink className="top-nav__title" to="/video" onClick={closeMenu}>
          DoobleAI
        </NavLink>
      </div>
      {showGuestHeader ? (
        <div className="top-nav__guest-center">
          <p className="top-nav__guest-copy">アカウントを作成して無料で始めましょう</p>
          <button type="button" className="top-nav__auth-button" onClick={handleGoogleSignIn}>
            サインアップ/ログイン
          </button>
        </div>
      ) : (
        <>
        <button
          type="button"
          className="top-nav__toggle"
          aria-label="メニュー"
          aria-expanded={isMenuOpen}
          aria-controls="top-nav-menu"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <nav className="top-nav__links" id="top-nav-menu">
          <NavLink to="/video" className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} onClick={closeMenu}>
            I2V
          </NavLink>
          <NavLink to="/i2av-test" className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} onClick={closeMenu}>
            音付きI2V
          </NavLink>
          <NavLink to="/image" className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} onClick={closeMenu}>
            I2I
          </NavLink>
          <NavLink to="/purchase" className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} onClick={closeMenu}>
            アカウント
          </NavLink>
          <a className="top-nav__link" href="https://aidooble2.win/" target="_blank" rel="noreferrer" onClick={closeMenu}>
            DoobleAI2
          </a>
          <a className="top-nav__link" href="https://aidooble3.win/" target="_blank" rel="noreferrer" onClick={closeMenu}>
            DoobleAI3
          </a>
        </nav>
        </>
      )}
    </header>
  )
}
