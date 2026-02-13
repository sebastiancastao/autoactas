'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

type NavLink = {
  href: string
  label: string
  match: (pathname: string) => boolean
}

type ListaProcesoOption = {
  id: string
  numero_proceso: string
  created_at: string
}

type ListaPickerPosition = {
  top: number
  left: number
  width: number
}

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Inicio', match: (pathname) => pathname === '/' },
  { href: '/procesos', label: 'Procesos', match: (pathname) => pathname.startsWith('/procesos') },
  { href: '/calendario', label: 'Calendario', match: (pathname) => pathname.startsWith('/calendario') },
  { href: '/inicializacion', label: 'Inicializacion', match: (pathname) => pathname.startsWith('/inicializacion') },
  { href: '/lista', label: 'Lista', match: (pathname) => pathname.startsWith('/lista') },
  { href: '/finalizacion', label: 'Finalizacion', match: (pathname) => pathname.startsWith('/finalizacion') },
]

function getContextLabel(pathname: string) {
  const match = NAV_LINKS.find((item) => item.match(pathname))
  if (match) return match.label
  if (pathname.startsWith('/perfil')) return 'Perfil'
  if (pathname.startsWith('/consulta-publica')) return 'Consulta publica'
  if (pathname.startsWith('/onboarding')) return 'Onboarding'
  return 'Flujo principal'
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = [record.message, record.detail, record.details, record.hint]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (message) {
      return message
    }
  }

  return fallback
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = `${record.message ?? ''} ${record.details ?? ''}`.toLowerCase()
  return (code === 'PGRST204' || code === '42703' || code === 'PGRST200') && message.includes(columnName)
}

export function Header() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const listaPickerRef = useRef<HTMLDivElement | null>(null)
  const listaTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [listaPickerOpen, setListaPickerOpen] = useState(false)
  const [loadingListaProcesos, setLoadingListaProcesos] = useState(false)
  const [listaProcesosError, setListaProcesosError] = useState<string | null>(null)
  const [listaProcesos, setListaProcesos] = useState<ListaProcesoOption[]>([])
  const [hasLoadedListaProcesos, setHasLoadedListaProcesos] = useState(false)
  const [selectedListaProcesoId, setSelectedListaProcesoId] = useState('')
  const [listaPickerPosition, setListaPickerPosition] = useState<ListaPickerPosition>({
    top: 0,
    left: 0,
    width: 280,
  })

  const activeLabel = useMemo(() => getContextLabel(pathname), [pathname])

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  const updateListaPickerPosition = useCallback(() => {
    if (!listaTriggerRef.current) return
    const rect = listaTriggerRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const panelWidth = Math.min(320, Math.max(240, viewportWidth - 16))
    const maxLeft = Math.max(8, viewportWidth - panelWidth - 8)
    const left = Math.max(8, Math.min(rect.left, maxLeft))

    setListaPickerPosition({
      top: rect.bottom + 8,
      left,
      width: panelWidth,
    })
  }, [])

  async function loadListaProcesos(force = false) {
    if (!user?.id) {
      setListaProcesos([])
      setListaProcesosError('Inicia sesion para ver tus procesos.')
      setHasLoadedListaProcesos(true)
      return
    }

    if (hasLoadedListaProcesos && !force) return

    setLoadingListaProcesos(true)
    setListaProcesosError(null)

    try {
      let usuarioPerfilId: string | null = null

      const { data: usuarioPerfil, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('auth_id', user.id)
        .maybeSingle()

      if (usuarioError) {
        console.warn('No se pudo resolver usuarios.id para el selector de Lista:', usuarioError)
      } else {
        usuarioPerfilId = usuarioPerfil?.id ?? null
      }

      let rows: ListaProcesoOption[] = []

      if (usuarioPerfilId) {
        const combined = await supabase
          .from('proceso')
          .select('id, numero_proceso, created_at')
          .or(`created_by_auth_id.eq.${user.id},usuario_id.eq.${usuarioPerfilId}`)
          .order('created_at', { ascending: false })

        if (!combined.error) {
          rows = (combined.data ?? []) as ListaProcesoOption[]
        } else {
          const missingUsuarioId = isMissingColumnError(combined.error, 'usuario_id')
          const missingCreatedByAuthId = isMissingColumnError(combined.error, 'created_by_auth_id')

          if (missingUsuarioId && !missingCreatedByAuthId) {
            const byCreator = await supabase
              .from('proceso')
              .select('id, numero_proceso, created_at')
              .eq('created_by_auth_id', user.id)
              .order('created_at', { ascending: false })
            if (byCreator.error) throw byCreator.error
            rows = (byCreator.data ?? []) as ListaProcesoOption[]
          } else if (!missingUsuarioId && missingCreatedByAuthId) {
            const byUsuario = await supabase
              .from('proceso')
              .select('id, numero_proceso, created_at')
              .eq('usuario_id', usuarioPerfilId)
              .order('created_at', { ascending: false })
            if (byUsuario.error) throw byUsuario.error
            rows = (byUsuario.data ?? []) as ListaProcesoOption[]
          } else if (missingUsuarioId && missingCreatedByAuthId) {
            rows = []
          } else {
            throw combined.error
          }
        }
      } else {
        const byCreator = await supabase
          .from('proceso')
          .select('id, numero_proceso, created_at')
          .eq('created_by_auth_id', user.id)
          .order('created_at', { ascending: false })

        if (byCreator.error) {
          if (isMissingColumnError(byCreator.error, 'created_by_auth_id')) {
            rows = []
          } else {
            throw byCreator.error
          }
        } else {
          rows = (byCreator.data ?? []) as ListaProcesoOption[]
        }
      }

      setListaProcesos(rows)
    } catch (error) {
      setListaProcesos([])
      setListaProcesosError(toErrorMessage(error, 'No se pudo cargar tus procesos.'))
    } finally {
      setLoadingListaProcesos(false)
      setHasLoadedListaProcesos(true)
    }
  }

  function handleListaNavClick() {
    const nextOpen = !listaPickerOpen
    setListaPickerOpen(nextOpen)
    setSelectedListaProcesoId('')

    if (nextOpen) {
      requestAnimationFrame(() => {
        updateListaPickerPosition()
      })
      void loadListaProcesos()
    }
  }

  function handleListaProcesoChange(procesoId: string) {
    setSelectedListaProcesoId(procesoId)
    if (!procesoId) return
    setListaPickerOpen(false)
    router.push(`/lista?procesoId=${encodeURIComponent(procesoId)}`)
  }

  useEffect(() => {
    setListaPickerOpen(false)
    setSelectedListaProcesoId('')
  }, [pathname])

  useEffect(() => {
    setHasLoadedListaProcesos(false)
    setListaProcesos([])
    setListaProcesosError(null)
    setSelectedListaProcesoId('')
  }, [user?.id])

  useEffect(() => {
    if (!listaPickerOpen) return

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (listaPickerRef.current && target && !listaPickerRef.current.contains(target)) {
        setListaPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [listaPickerOpen])

  useEffect(() => {
    if (!listaPickerOpen) return

    updateListaPickerPosition()

    function onLayoutChange() {
      updateListaPickerPosition()
    }

    window.addEventListener('resize', onLayoutChange)
    window.addEventListener('scroll', onLayoutChange, true)
    return () => {
      window.removeEventListener('resize', onLayoutChange)
      window.removeEventListener('scroll', onLayoutChange, true)
    }
  }, [listaPickerOpen, updateListaPickerPosition])

  if (!user) return null

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-black/80">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm font-semibold tracking-tight text-zinc-900 shadow-sm transition hover:border-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              AutoActas
            </Link>
            <span className="hidden rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 sm:inline-flex">
              En esta seccion: {activeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 md:inline-flex">
              {user.email}
            </span>
            <Link
              href="/perfil"
              className="inline-flex h-9 items-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white"
            >
              Perfil
            </Link>
            <button
              onClick={handleSignOut}
              className="inline-flex h-9 items-center rounded-full bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              Salir
            </button>
          </div>
        </div>

        <nav aria-label="Navegacion principal" className="-mx-1 flex overflow-x-auto pb-3">
          <div className="flex min-w-full gap-2 px-1">
            {NAV_LINKS.map((item) => {
              const isActive = item.match(pathname)
              const className = `inline-flex items-center justify-center rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                isActive
                  ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-black'
                  : 'border-zinc-200 bg-white/70 text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-white dark:hover:text-white'
              }`

              if (item.href === '/lista') {
                return (
                  <div key={item.href} ref={listaPickerRef} className="relative">
                    <button
                      ref={listaTriggerRef}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      aria-expanded={listaPickerOpen}
                      aria-controls="header-lista-proceso-picker"
                      onClick={handleListaNavClick}
                      className={className}
                    >
                      {item.label}
                    </button>

                    {listaPickerOpen && (
                      <div
                        id="header-lista-proceso-picker"
                        className="fixed z-[120] rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-zinc-900"
                        style={{
                          top: `${listaPickerPosition.top}px`,
                          left: `${listaPickerPosition.left}px`,
                          width: `${listaPickerPosition.width}px`,
                        }}
                      >
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                          Selecciona proceso
                        </label>
                        <select
                          value={selectedListaProcesoId}
                          onChange={(event) => handleListaProcesoChange(event.target.value)}
                          disabled={loadingListaProcesos}
                          className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-700 outline-none transition focus:border-zinc-900/40 focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100 dark:focus:border-white/30 dark:focus:ring-white/10"
                        >
                          <option value="">
                            {loadingListaProcesos ? 'Cargando...' : 'Selecciona un proceso...'}
                          </option>
                          {listaProcesos.map((proceso) => (
                            <option key={proceso.id} value={proceso.id}>
                              {proceso.numero_proceso || proceso.id}
                            </option>
                          ))}
                        </select>

                        {listaProcesosError && (
                          <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">{listaProcesosError}</p>
                        )}

                        {!loadingListaProcesos && !listaProcesosError && listaProcesos.length === 0 && (
                          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            No tienes procesos disponibles para abrir en Lista.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={className}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </header>
  )
}
