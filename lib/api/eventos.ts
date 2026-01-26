import { supabase } from '../supabase'

export type Evento = {
  id: string
  titulo: string
  descripcion: string | null
  fecha: string
  hora: string | null
  fecha_fin: string | null
  hora_fin: string | null
  usuario_id: string | null
  proceso_id: string | null
  tipo: string | null
  color: string | null
  recordatorio: boolean
  completado: boolean
  created_at: string
  updated_at: string
}

export type EventoInsert = Omit<Evento, 'id' | 'created_at' | 'updated_at'>
export type EventoUpdate = Partial<EventoInsert>

export async function getEventos() {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventoById(id: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getEventosByFecha(fecha: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('fecha', fecha)
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByRangoFechas(fechaInicio: string, fechaFin: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByUsuario(usuarioId: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('usuario_id', usuarioId)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function getEventosByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('proceso_id', procesoId)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })

  if (error) throw error
  return data
}

export async function createEvento(evento: EventoInsert) {
  const { data, error } = await supabase
    .from('eventos')
    .insert(evento)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateEvento(id: string, evento: EventoUpdate) {
  const { data, error } = await supabase
    .from('eventos')
    .update(evento)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteEvento(id: string) {
  const { error } = await supabase
    .from('eventos')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function marcarEventoCompletado(id: string, completado: boolean) {
  const { data, error } = await supabase
    .from('eventos')
    .update({ completado })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
