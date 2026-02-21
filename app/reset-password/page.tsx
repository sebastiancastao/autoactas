'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { updatePassword } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

function getErrorText(err: unknown) {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return 'No se pudo restablecer la contrasena.'
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [validatingLink, setValidatingLink] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setValidatingLink(true)
      setError(null)
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.warn('[reset-password] exchangeCodeForSession failed:', exchangeError.message)
          }

          url.searchParams.delete('code')
          const nextPath = `${url.pathname}${url.search}${url.hash}`
          window.history.replaceState({}, '', nextPath)
        }

        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!data.session) {
          throw new Error('El enlace de recuperacion es invalido o expiro. Solicita uno nuevo desde Login.')
        }

        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) setError(getErrorText(err))
      } finally {
        if (!cancelled) setValidatingLink(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || saving) return

    setError(null)
    setMessage(null)

    if (newPassword.length < 8) {
      setError('La nueva contrasena debe tener al menos 8 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('La confirmacion de contrasena no coincide.')
      return
    }

    setSaving(true)
    try {
      await updatePassword(newPassword)
      setMessage('Contrasena actualizada correctamente. Ya puedes iniciar sesion.')
    } catch (err) {
      setError(getErrorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-44 bg-gradient-to-b from-white/80 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-[0_20px_50px_-26px_rgba(15,23,42,0.45)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <header className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Recuperacion
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Restablecer contrasena</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Define una nueva contrasena para tu cuenta.
            </p>
          </header>

          {error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              {message}
            </div>
          )}

          {validatingLink ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              Validando enlace de recuperacion...
            </div>
          ) : message ? (
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              Ir a login
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Nueva contrasena
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Minimo 8 caracteres"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 pr-24 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute inset-y-1 right-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-white"
                  >
                    {showNewPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Confirmar contrasena
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Repite la contrasena"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 pr-24 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-1 right-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-white"
                  >
                    {showConfirmPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={!ready || saving}
                className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {saving ? 'Actualizando...' : 'Guardar nueva contrasena'}
              </button>

              <Link
                href="/login"
                className="block text-center text-xs font-medium text-zinc-600 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
              >
                Volver a login
              </Link>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
