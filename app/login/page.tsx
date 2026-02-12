'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const router = useRouter()
  const { signIn, signUp } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    try {
      if (isSignUp) {
        await signUp(email, password, {
          nombre,
          identificacion: cedula,
        })
        setMessage('Revisa tu correo para confirmar tu cuenta')
      } else {
        await signIn(email, password)
        await new Promise(resolve => setTimeout(resolve, 100))
        router.refresh()
        router.push('/procesos')
      }
    } catch (err) {
      console.error('Auth error:', err)
      setError(err instanceof Error ? err.message : 'Error de autenticacion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <header className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50" />
              {isSignUp ? 'Registro' : 'Acceso'}
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {isSignUp ? 'Crear cuenta' : 'Iniciar sesion'}
            </h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Sistema de Gestion de Procesos
            </p>
          </header>

          <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
                  {message}
                </div>
              )}

              {isSignUp && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Nombre
                    </label>
                    <input
                      id="nombre"
                      name="nombre"
                      type="text"
                      autoComplete="name"
                      required={isSignUp}
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Tu nombre completo"
                      className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Numero de cedula
                    </label>
                    <input
                      id="cedula"
                      name="cedula"
                      type="text"
                      autoComplete="off"
                      required={isSignUp}
                      value={cedula}
                      onChange={(e) => setCedula(e.target.value)}
                      placeholder="Ej: 1234567890"
                      className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Correo electronico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Contrasena
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {loading ? 'Cargando...' : isSignUp ? 'Registrarse' : 'Iniciar sesion'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp)
                  setError(null)
                  setMessage(null)
                }}
                className="text-sm text-zinc-600 transition hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
              >
                {isSignUp
                  ? '¿Ya tienes cuenta? Inicia sesion'
                  : '¿No tienes cuenta? Registrate'}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
