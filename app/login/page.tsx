'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { useAuth } from '@/lib/auth-context'

function getErrorText(err: unknown) {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return 'Error de autenticacion'
}

export default function LoginPage() {
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
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
        setMessage('Cuenta creada. Revisa tu correo para confirmar el acceso.')
      } else {
        await signIn(email, password)
        await new Promise((resolve) => setTimeout(resolve, 120))
        router.refresh()
        router.push('/procesos')
      }
    } catch (err) {
      setError(getErrorText(err))
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordKeyState = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState('CapsLock'))
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-44 bg-gradient-to-b from-white/80 to-transparent dark:from-zinc-900/60" />

      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/85 p-5 shadow-[0_20px_50px_-26px_rgba(15,23,42,0.45)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
          <header className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {isSignUp ? 'Registro' : 'Acceso'}
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {isSignUp ? 'Crear cuenta' : 'Iniciar sesion'}
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Sistema de gestion de procesos
            </p>
          </header>

          <div className="mb-5 grid grid-cols-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-1 dark:border-white/10 dark:bg-white/5">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false)
                setError(null)
                setMessage(null)
              }}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                !isSignUp
                  ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              Ingresar
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true)
                setError(null)
                setMessage(null)
              }}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                isSignUp
                  ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
              }`}
            >
              Registrarme
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                {message}
              </div>
            )}

            {isSignUp && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Nombre completo
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
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Numero de identificacion
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
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
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
                className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Contrasena
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handlePasswordKeyState}
                  onKeyUp={handlePasswordKeyState}
                  placeholder="Ingresa tu contrasena"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 pr-24 text-sm outline-none focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-1 right-1 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-white"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <div className="mt-1 min-h-5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {capsLockOn ? 'Bloq Mayus activado: revisa la contrasena.' : 'Usa al menos 8 caracteres para mayor seguridad.'}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {loading ? 'Procesando...' : isSignUp ? 'Crear cuenta' : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
