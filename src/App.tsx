import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { Account } from './pages/Account'
import { Camera } from './pages/Camera'
import { Image } from './pages/Image'
import { Purchase } from './pages/Purchase'
import { Terms } from './pages/Terms'
import { Tokushoho } from './pages/Tokushoho'
import { Video } from './pages/Video'

function RedirectToVideoPreservingLocation() {
  const location = useLocation()
  return <Navigate to={{ pathname: '/video', search: location.search, hash: location.hash }} replace />
}

function PurchaseRouteGate() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)

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

  if (!authReady) return null
  if (!session) return <Navigate to="/video" replace />
  return <Purchase />
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToVideoPreservingLocation />} />
      <Route path="/t2v" element={<Camera />} />
      <Route path="/image" element={<Image />} />
      <Route path="/purchase" element={<PurchaseRouteGate />} />
      <Route path="/video" element={<Video />} />
      <Route path="/account" element={<Account />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/tokushoho" element={<Tokushoho />} />
      <Route path="*" element={<Navigate to="/video" replace />} />
    </Routes>
  )
}
