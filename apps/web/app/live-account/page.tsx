"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import LiveAccountShell from '../../components/LiveAccountShell'
import { getSession, type SessionResponse } from '../../lib/api'

export default function LiveAccountPage() {
  const router = useRouter()
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function restoreSession() {
      try {
        const currentSession = await getSession()
        if (!currentSession.authenticated) {
          router.replace('/')
          return
        }
        setSession(currentSession)
      } catch {
        router.replace('/')
      } finally {
        setLoading(false)
      }
    }

    void restoreSession()
  }, [router])

  if (loading || !session?.authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary text-text-secondary">
        正在检查登录状态...
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-bg-primary p-6">
      <LiveAccountShell />
    </div>
  )
}
