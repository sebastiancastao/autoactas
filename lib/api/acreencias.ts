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

