import { supabase } from '../supabase'
import type { ApoderadoInsert, ApoderadoUpdate } from '../database.types'

export async function getApoderados() {
  const { data, error } = await supabase
    .from('apoderados')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getApoderadoById(id: string) {
  const { data, error } = await supabase
    .from('apoderados')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getApoderadosByIds(ids: string[]) {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('apoderados')
    .select('*')
    .in('id', ids)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getApoderadosByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('apoderados')
    .select('*')
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createApoderado(apoderado: ApoderadoInsert) {
  const { data, error } = await supabase
    .from('apoderados')
    .insert(apoderado)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateApoderado(id: string, apoderado: ApoderadoUpdate) {
  const { data, error } = await supabase
    .from('apoderados')
    .update(apoderado)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteApoderado(id: string) {
  const { error } = await supabase
    .from('apoderados')
    .delete()
    .eq('id', id)

  if (error) throw error
}
