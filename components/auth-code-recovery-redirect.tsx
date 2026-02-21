'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function AuthCodeRecoveryRedirect() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (pathname !== '/') return

    const code = searchParams.get('code')
    if (!code) return

    const type = searchParams.get('type')
    if (type && type !== 'recovery') return

    const qs = searchParams.toString()
    router.replace(`/reset-password${qs ? `?${qs}` : ''}`)
  }, [pathname, router, searchParams])

  return null
}
