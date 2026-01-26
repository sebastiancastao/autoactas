import { supabase } from '../supabase'
import type { ProgresoInsert, ProgresoUpdate } from '../database.types'

export type { Progreso } from '../database.types'

export async function getProgresos() {
  const { data, error } = await supabase
    .from('progreso')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getProgresoById(id: string) {
  const { data, error } = await supabase
    .from('progreso')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getProgresoByProcesoId(procesoId: string) {
  const { data, error } = await supabase
    .from('progreso')
    .select('*')
    .eq('proceso_id', procesoId)
    .single()

  if (error) {
    // If no progreso exists, return null instead of throwing
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

export async function createProgreso(progreso: ProgresoInsert) {
  const { data, error } = await supabase
    .from('progreso')
    .insert(progreso)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProgreso(id: string, progreso: ProgresoUpdate) {
  const { data, error } = await supabase
    .from('progreso')
    .update(progreso)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProgresoByProcesoId(procesoId: string, progreso: ProgresoUpdate) {
  const { data, error } = await supabase
    .from('progreso')
    .update(progreso)
    .eq('proceso_id', procesoId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProgreso(id: string) {
  const { error } = await supabase
    .from('progreso')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function getOrCreateProgreso(procesoId: string) {
  // Try to get existing progreso
  const existing = await getProgresoByProcesoId(procesoId)
  if (existing) return existing

  // Create new progreso if doesn't exist
  return createProgreso({ proceso_id: procesoId })
}
