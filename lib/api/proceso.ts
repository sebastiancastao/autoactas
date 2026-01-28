import { supabase } from '../supabase'
import { getApoderadosByProceso } from './apoderados'
import type { Apoderado, ProcesoInsert, ProcesoUpdate } from '../database.types'

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
      acreedores (*),
      progreso (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error

  let apoderados: Apoderado[] | undefined
  try {
    apoderados = await getApoderadosByProceso(id)
  } catch (apError) {
    const errorDetails =
      apError instanceof Error
        ? apError.message
        : apError && typeof apError === 'object'
        ? JSON.stringify(apError, Object.getOwnPropertyNames(apError))
        : String(apError)
    console.warn('Could not load apoderados for proceso:', errorDetails, apError)
  }

  return {
    ...data,
    apoderados,
  }
}

export async function getProcesosWithRelations() {
  const { data, error } = await supabase
    .from('proceso')
    .select(`
      *,
      deudores (*),
      acreedores (*),
      progreso (*)
    `)
    .order('created_at', { ascending: false })

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
