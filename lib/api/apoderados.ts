import { supabase } from '../supabase'
import type { ApoderadoInsert, ApoderadoUpdate } from '../database.types'

function getMissingColumnFromError(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const message = typeof record.message === 'string' ? record.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const code = typeof record.code === 'string' ? record.code : ''

  if (code === 'PGRST204') {
    const match = message.match(/Could not find the '([^']+)' column/i)
    return match ? match[1] : null
  }

  if (code === '42703') {
    const source = `${message} ${details}`
    const quotedMatch = source.match(/column\s+"([^"]+)"/i)
    if (quotedMatch) return quotedMatch[1]
    const unquotedMatch = source.match(/column\s+([a-zA-Z0-9_]+)\s+does not exist/i)
    return unquotedMatch ? unquotedMatch[1] : null
  }

  return null
}

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
  const payload: Record<string, unknown> = { ...apoderado }
  let lastError: unknown = null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase
      .from('apoderados')
      .insert(payload as ApoderadoInsert)
      .select()
      .single()

    if (!error) return data

    lastError = error
    const missingColumn = getMissingColumnFromError(error)
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn]
      continue
    }

    break
  }

  throw lastError
}

export async function updateApoderado(id: string, apoderado: ApoderadoUpdate) {
  const payload: Record<string, unknown> = { ...apoderado }
  let lastError: unknown = null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase
      .from('apoderados')
      .update(payload as ApoderadoUpdate)
      .eq('id', id)
      .select()
      .single()

    if (!error) return data

    lastError = error
    const missingColumn = getMissingColumnFromError(error)
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn]
      continue
    }

    break
  }

  throw lastError
}

export async function deleteApoderado(id: string) {
  const { error } = await supabase
    .from('apoderados')
    .delete()
    .eq('id', id)

  if (error) throw error
}
