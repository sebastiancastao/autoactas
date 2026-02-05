import { supabase } from '../supabase'
import type { AcreenciaInsert, AcreenciaUpdate } from '../database.types'

export async function getAcreenciasByProcesoAndApoderado(
  procesoId: string,
  apoderadoId: string
) {

  
  const { data, error } = await supabase
    .from('acreencias')
    .select('*')
    .eq('proceso_id', procesoId)
    .eq('apoderado_id', apoderadoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function getAcreenciasByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('acreencias')
    .select(
      `
      *,
      acreedores (*),
      apoderados!acreencias_apoderado_id_fkey (*)
    `
    )
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function upsertAcreencias(items: AcreenciaInsert[]) {
  if (items.length === 0) return []

  const { data, error } = await supabase
    .from('acreencias')
    .upsert(items, { onConflict: 'proceso_id,apoderado_id,acreedor_id' })
    .select()

  if (error) {
    if (error.code === '42P10') {
      throw new Error(
        "No se puede guardar porque falta un índice/constraint UNIQUE para el upsert en 'acreencias' (proceso_id, apoderado_id, acreedor_id). Aplica la migración `autoactas/supabase/migrations/20260204_add_acreencias_unique_conflict.sql` (o crea el índice UNIQUE equivalente en Supabase).",
        { cause: error }
      )
    }
    throw error
  }
  return data ?? []
}

export async function createAcreencia(acreencia: AcreenciaInsert) {
  const { data, error } = await supabase
    .from('acreencias')
    .insert(acreencia)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateAcreencia(id: string, acreencia: AcreenciaUpdate) {
  const { data, error } = await supabase
    .from('acreencias')
    .update(acreencia)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
