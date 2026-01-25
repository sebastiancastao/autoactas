import { supabase } from '../supabase'
import type { DeudorInsert, DeudorUpdate } from '../database.types'

export async function getDeudores() {
  const { data, error } = await supabase
    .from('deudores')
    .select(`
      *,
      proceso (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getDeudoresByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('deudores')
    .select('*')
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getDeudorById(id: string) {
  const { data, error } = await supabase
    .from('deudores')
    .select(`
      *,
      proceso (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createDeudor(deudor: DeudorInsert) {
  const { data, error } = await supabase
    .from('deudores')
    .insert(deudor)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateDeudor(id: string, deudor: DeudorUpdate) {
  const { data, error } = await supabase
    .from('deudores')
    .update(deudor)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteDeudor(id: string) {
  const { error } = await supabase
    .from('deudores')
    .delete()
    .eq('id', id)

  if (error) throw error
}
