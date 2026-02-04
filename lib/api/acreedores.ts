import { supabase } from '../supabase'
import type { AcreedorInsert, AcreedorUpdate } from '../database.types'

export async function getAcreedores() {
  const { data, error } = await supabase
    .from('acreedores')
    .select(`
      *,
      proceso (*),
      apoderados!acreedores_apoderado_id_fkey (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAcreedoresByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('acreedores')
    .select(`
      *,
      apoderados!acreedores_apoderado_id_fkey (*)
    `)
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAcreedoresByApoderado(apoderadoId: string) {
  const { data, error } = await supabase
    .from('acreedores')
    .select(`
      *,
      proceso (*)
    `)
    .eq('apoderado_id', apoderadoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAcreedorById(id: string) {
  const { data, error } = await supabase
    .from('acreedores')
    .select(`
      *,
      proceso (*),
      apoderados!acreedores_apoderado_id_fkey (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createAcreedor(acreedor: AcreedorInsert) {
  const { data, error } = await supabase
    .from('acreedores')
    .insert(acreedor)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateAcreedor(id: string, acreedor: AcreedorUpdate) {
  const { data, error } = await supabase
    .from('acreedores')
    .update(acreedor)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteAcreedor(id: string) {
  const { error } = await supabase
    .from('acreedores')
    .delete()
    .eq('id', id)

  if (error) throw error
}
