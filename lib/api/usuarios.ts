import { supabase } from '../supabase'

export type Usuario = {
  id: string
  auth_id: string | null
  nombre: string
  email: string
  telefono: string | null
  rol: string
  avatar_url: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export async function getUsuarios() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('activo', true)
    .order('nombre', { ascending: true })

  if (error) throw error
  return data
}

export async function getUsuarioById(id: string) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getUsuarioByAuthId(authId: string) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('auth_id', authId)
    .single()

  if (error) throw error
  return data
}

export async function createUsuario(usuario: Omit<Usuario, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('usuarios')
    .insert(usuario)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateUsuario(id: string, usuario: Partial<Omit<Usuario, 'id' | 'created_at' | 'updated_at'>>) {
  const { data, error } = await supabase
    .from('usuarios')
    .update(usuario)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteUsuario(id: string) {
  const { error } = await supabase
    .from('usuarios')
    .delete()
    .eq('id', id)

  if (error) throw error
}
