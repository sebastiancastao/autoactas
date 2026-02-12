'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function Header() {
  const { user, signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  if (!user) return null

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-black/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
        <Link
          href="/calendario"
          className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-white"
        >
          AutoActas
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/perfil"
            className="text-sm font-medium text-zinc-600 transition hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
          >
            Mi perfil
          </Link>
          <span className="hidden text-sm text-zinc-600 dark:text-zinc-400 sm:block">
            {user.email}
          </span>
          <button
            onClick={handleSignOut}
            className="h-9 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  )
}
