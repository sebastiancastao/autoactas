import { supabase } from '../supabase'
import type { InventarioInsert, InventarioUpdate } from '../database.types'

export async function getInventario() {
  const { data, error } = await supabase
    .from('inventario')
    .select(`
      *,
      proceso (*),
      acreedores (*),
      apoderados!inventario_apoderado_id_fkey (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getInventarioByProceso(procesoId: string) {
  const { data, error } = await supabase
    .from('inventario')
    .select(`
      *,
      acreedores (*),
      apoderados!inventario_apoderado_id_fkey (*)
    `)
    .eq('proceso_id', procesoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getInventarioByAcreedor(acreedorId: string) {
  const { data, error } = await supabase
    .from('inventario')
    .select(`
      *,
      proceso (*),
      apoderados!inventario_apoderado_id_fkey (*)
    `)
    .eq('acreedor_id', acreedorId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getInventarioByApoderado(apoderadoId: string) {
  const { data, error } = await supabase
    .from('inventario')
    .select(`
      *,
      proceso (*),
      acreedores (*)
    `)
    .eq('apoderado_id', apoderadoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getInventarioById(id: string) {
  const { data, error } = await supabase
    .from('inventario')
    .select(`
      *,
      proceso (*),
      acreedores (*),
      apoderados!inventario_apoderado_id_fkey (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createInventario(inventario: InventarioInsert) {
  const { data, error } = await supabase
    .from('inventario')
    .insert(inventario)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createInventarioMultiple(items: InventarioInsert[]) {
  const { data, error } = await supabase
    .from('inventario')
    .insert(items)
    .select()

  if (error) throw error
  return data
}

export async function updateInventario(id: string, inventario: InventarioUpdate) {
  const { data, error } = await supabase
    .from('inventario')
    .update(inventario)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteInventario(id: string) {
  const { error } = await supabase
    .from('inventario')
    .delete()
    .eq('id', id)

  if (error) throw error
}
