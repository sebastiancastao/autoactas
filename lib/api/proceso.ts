import { supabase } from '../supabase'
import type { ProcesoInsert, ProcesoUpdate } from '../database.types'

export async function getProcesos() {
  const { data, error } = await supabase
    .from('proceso')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getProcesoById(id: string) {
  const { data, error } = await supabase
    .from('proceso')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getProcesoWithRelations(id: string) {
  const { data, error } = await supabase
    .from('proceso')
    .select(`
      *,
      deudores (*),
      acreedores (
        *,
        apoderados (*)
      ),
      inventario (
        *,
        apoderados (*),
        acreedores (*)
      )
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createProceso(proceso: ProcesoInsert) {
  const { data, error } = await supabase
    .from('proceso')
    .insert(proceso)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProceso(id: string, proceso: ProcesoUpdate) {
  const { data, error } = await supabase
    .from('proceso')
    .update(proceso)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProceso(id: string) {
  const { error } = await supabase
    .from('proceso')
    .delete()
    .eq('id', id)

  if (error) throw error
}
