import { supabase } from '../supabase'
import type { AsistenciaInsert, AsistenciaUpdate } from '../database.types'

export async function getAsistenciasByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      *,
      apoderados (*),
      eventos (*)
    `)
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAsistenciasByEvento(eventoId: string) {
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      *,
      apoderados (*),
      proceso (*)
    `)
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAsistenciaById(id: string) {
  const { data, error } = await supabase
    .from('asistencia')
    .select(`
      *,
      apoderados (*),
      eventos (*),
      proceso (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createAsistencia(asistencia: AsistenciaInsert) {
  const { data, error } = await supabase
    .from('asistencia')
    .insert(asistencia)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createAsistenciasBulk(asistencias: AsistenciaInsert[]) {
  const { data, error } = await supabase
    .from('asistencia')
    .insert(asistencias)
    .select()

  if (error) throw error
  return data
}

export async function updateAsistencia(id: string, asistencia: AsistenciaUpdate) {
  const { data, error } = await supabase
    .from('asistencia')
    .update(asistencia)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteAsistencia(id: string) {
  const { error } = await supabase
    .from('asistencia')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function deleteAsistenciasByEvento(eventoId: string) {
  const { error } = await supabase
    .from('asistencia')
    .delete()
    .eq('evento_id', eventoId)

  if (error) throw error
}
