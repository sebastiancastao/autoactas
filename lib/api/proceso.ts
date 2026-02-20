import { supabase } from '../supabase'
import { getApoderadosByProceso } from './apoderados'
import type {
  Acreedor,
  Acreencia,
  Apoderado,
  Deudor,
  Proceso,
  ProcesoInsert,
  ProcesoUpdate,
  Progreso,
} from '../database.types'

const SELECT_PROCESO_WITH_FULL_RELATIONS: string = `
      *,
      deudores (*),
      acreedores (
        *,
        acreencias (*)
      ),
      progreso (*)
    `

const SELECT_PROCESO_WITHOUT_PROGRESO: string = `
      *,
      deudores (*),
      acreedores (
        *,
        acreencias (*)
      )
    `

const SELECT_PROCESO_WITHOUT_PROGRESO_AND_ACREENCIAS: string = `
      *,
      deudores (*),
      acreedores (*)
    `

const SELECT_PROCESO_BASIC: string = `
      *
    `

const SCHEMA_RELATION_ERROR_CODES = new Set([
  'PGRST200',
  'PGRST201',
  'PGRST202',
  'PGRST204',
  '42P01',
])

type AcreedorWithAcreencias = Acreedor & {
  acreencias?: Acreencia[]
}

type ProcesoWithNestedData = Proceso & {
  deudores?: Deudor[]
  acreedores?: AcreedorWithAcreencias[]
  progreso?: Progreso | null
}

export type ProcesoWithRelations = ProcesoWithNestedData & {
  apoderados?: Apoderado[]
}

function formatErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const details = [record.code, record.message, record.details, record.hint]
      .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
      .map((part) => String(part).trim())
      .join(' | ')
    if (details) return details
  }

  return String(error)
}

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  return code === '42P01' || /relation .* does not exist/i.test(message)
}

function isAcreenciasHistorialDeleteFkError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const hint = typeof record.hint === 'string' ? record.hint : ''
  const haystack = `${message} ${details} ${hint}`.toLowerCase()
  return code === '23503' && haystack.includes('acreencias_historial_acreencia_id_fkey')
}

function isApoderadosProcesoFkError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const hint = typeof record.hint === 'string' ? record.hint : ''
  const haystack = `${message} ${details} ${hint}`.toLowerCase()
  return code === '23503' && haystack.includes('apoderados_proceso_fkey')
}

function toDeleteProcesoStepError(step: string, error: unknown) {
  if (isAcreenciasHistorialDeleteFkError(error)) {
    return new Error(
      'No se pudo eliminar el proceso porque falta aplicar la migracion '
        + '`supabase/migrations/20260220_fix_acreencias_historial_delete_fk.sql`.',
    )
  }
  if (isApoderadosProcesoFkError(error)) {
    return new Error(
      'No se pudo eliminar el proceso porque hay una FK antigua en apoderados. '
        + 'Aplica la migracion '
        + '`supabase/migrations/20260220_fix_apoderados_proceso_fk.sql`.',
    )
  }
  return new Error(`No se pudo eliminar el proceso (${step}): ${formatErrorDetails(error)}`)
}

function isForeignKeyConstraintError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  return code === '23503' || /violates foreign key constraint/i.test(message)
}

type DeleteStepResult = {
  error: unknown | null
}

type DeleteProcesoResult = {
  error: unknown | null
  deleted: boolean
}

async function deleteProcesoRow(id: string): Promise<DeleteProcesoResult> {
  const { data, error } = await supabase
    .from('proceso')
    .delete()
    .eq('id', id)
    .select('id')

  return {
    error,
    deleted: Boolean(data && data.length > 0),
  }
}

async function executeDeleteStep(
  step: string,
  action: () => Promise<DeleteStepResult>,
) {
  const { error } = await action()
  if (!error) return

  if (isMissingRelationError(error)) {
    console.warn(
      `Skipping delete step "${step}" because relation is missing:`,
      formatErrorDetails(error),
    )
    return
  }

  throw toDeleteProcesoStepError(step, error)
}

function isSchemaRelationError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  return typeof record.code === 'string' && SCHEMA_RELATION_ERROR_CODES.has(record.code)
}

function isNotFoundSingleRowError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const record = error as Record<string, unknown>
  return record.code === "PGRST116"
}

function getMissingColumnFromError(error: unknown) {
  if (!error || typeof error !== "object") return null
  const record = error as Record<string, unknown>
  const message = typeof record.message === "string" ? record.message : ""
  const details = typeof record.details === "string" ? record.details : ""
  const code = typeof record.code === "string" ? record.code : ""

  if (code === "PGRST204") {
    const match = message.match(/Could not find the '([^']+)' column/i)
    return match ? match[1] : null
  }

  if (code === "42703") {
    const source = `${message} ${details}`
    const quotedMatch = source.match(/column\s+"([^"]+)"/i)
    if (quotedMatch) return quotedMatch[1]
    const unquotedMatch = source.match(/column\s+([a-zA-Z0-9_]+)\s+does not exist/i)
    return unquotedMatch ? unquotedMatch[1] : null
  }

  return null
}

function withNullProgreso(data: ProcesoWithNestedData): ProcesoWithNestedData {
  return {
    ...data,
    progreso: null,
  }
}

function withNullProgresoAndEmptyAcreencias(data: ProcesoWithNestedData): ProcesoWithNestedData {
  return {
    ...data,
    progreso: null,
    acreedores: Array.isArray(data.acreedores)
      ? data.acreedores.map((acreedor): AcreedorWithAcreencias => ({
          ...acreedor,
          acreencias: [],
        }))
      : data.acreedores,
  }
}

async function fetchProcesoByIdWithFallbacks(id: string): Promise<ProcesoWithNestedData> {
  const attempts = [
    {
      label: 'full relations',
      select: SELECT_PROCESO_WITH_FULL_RELATIONS,
      normalize: (data: ProcesoWithNestedData) => data,
    },
    {
      label: 'without progreso relation',
      select: SELECT_PROCESO_WITHOUT_PROGRESO,
      normalize: withNullProgreso,
    },
    {
      label: 'without progreso and acreencias relations',
      select: SELECT_PROCESO_WITHOUT_PROGRESO_AND_ACREENCIAS,
      normalize: withNullProgresoAndEmptyAcreencias,
    },
    {
      label: 'basic proceso fields',
      select: SELECT_PROCESO_BASIC,
      normalize: withNullProgresoAndEmptyAcreencias,
    },
  ] as const

  let lastError: unknown = null

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const { data, error } = await supabase
      .from('proceso')
      .select(attempt.select)
      .eq('id', id)
      .single()

    if (!error) {
      return attempt.normalize(data as unknown as ProcesoWithNestedData)
    }

    lastError = error
    if (isNotFoundSingleRowError(error)) {
      break
    }
    if (index === attempts.length - 1) {
      break
    }

    const reason = isSchemaRelationError(error) ? "schema mismatch" : "restricted relation access"
    console.warn(
      `Retrying proceso relations query (${attempt.label}) due to ${reason}:`,
      formatErrorDetails(error),
    )
  }

  throw lastError
}

async function fetchProcesosWithFallbacks(): Promise<ProcesoWithNestedData[]> {
  const attempts = [
    {
      label: 'full relations',
      select: SELECT_PROCESO_WITH_FULL_RELATIONS,
      normalize: (rows: ProcesoWithNestedData[]) => rows,
    },
    {
      label: 'without progreso relation',
      select: SELECT_PROCESO_WITHOUT_PROGRESO,
      normalize: (rows: ProcesoWithNestedData[]) => rows.map(withNullProgreso),
    },
    {
      label: 'without progreso and acreencias relations',
      select: SELECT_PROCESO_WITHOUT_PROGRESO_AND_ACREENCIAS,
      normalize: (rows: ProcesoWithNestedData[]) => rows.map(withNullProgresoAndEmptyAcreencias),
    },
    {
      label: 'basic proceso fields',
      select: SELECT_PROCESO_BASIC,
      normalize: (rows: ProcesoWithNestedData[]) => rows.map(withNullProgresoAndEmptyAcreencias),
    },
  ] as const

  let lastError: unknown = null

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const { data, error } = await supabase
      .from('proceso')
      .select(attempt.select)
      .order('created_at', { ascending: false })

    if (!error) {
      return attempt.normalize((data ?? []) as unknown as ProcesoWithNestedData[])
    }

    lastError = error
    if (index === attempts.length - 1) {
      break
    }

    const reason = isSchemaRelationError(error) ? "schema mismatch" : "restricted relation access"
    console.warn(
      `Retrying procesos relations query (${attempt.label}) due to ${reason}:`,
      formatErrorDetails(error),
    )
  }

  throw lastError
}

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

export async function getProcesoWithRelations(id: string): Promise<ProcesoWithRelations> {
  const data = await fetchProcesoByIdWithFallbacks(id)

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
  return fetchProcesosWithFallbacks()
}

export async function createProceso(proceso: ProcesoInsert) {
  const payload: Record<string, unknown> = { ...proceso }
  let lastError: unknown = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabase
      .from("proceso")
      .insert(payload as ProcesoInsert)
      .select()
      .single()

    if (!error) return data

    lastError = error
    const missingColumn = getMissingColumnFromError(error)
    if (
      missingColumn &&
      Object.prototype.hasOwnProperty.call(payload, missingColumn)
    ) {
      delete payload[missingColumn]
      continue
    }

    break
  }

  throw lastError
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
  const initialDelete = await deleteProcesoRow(id)

  if (!initialDelete.error && initialDelete.deleted) {
    return
  }

  if (initialDelete.error && !isForeignKeyConstraintError(initialDelete.error)) {
    throw toDeleteProcesoStepError('eliminando proceso', initialDelete.error)
  }

  if (!initialDelete.error && !initialDelete.deleted) {
    throw new Error(
      'No se pudo eliminar el proceso. Verifica permisos de borrado o intenta refrescar la página.',
    )
  }

  const { data: eventosRows, error: eventosQueryError } = await supabase
    .from('eventos')
    .select('id')
    .eq('proceso_id', id)

  if (eventosQueryError && !isMissingRelationError(eventosQueryError)) {
    throw toDeleteProcesoStepError('consultando eventos', eventosQueryError)
  }

  const { data: apoderadosRows, error: apoderadosQueryError } = await supabase
    .from('apoderados')
    .select('id')
    .eq('proceso_id', id)

  if (apoderadosQueryError && !isMissingRelationError(apoderadosQueryError)) {
    throw toDeleteProcesoStepError('consultando apoderados', apoderadosQueryError)
  }

  const eventoIds = (eventosRows ?? []).map((row) => row.id)
  const apoderadoIds = (apoderadosRows ?? []).map((row) => row.id)

  if (eventoIds.length > 0) {
    await executeDeleteStep('eliminando asistencia por evento', async () => {
      const { error } = await supabase
        .from('asistencia')
        .delete()
        .in('evento_id', eventoIds)
      return { error }
    })
  }

  if (apoderadoIds.length > 0) {
    await executeDeleteStep('eliminando asistencia por apoderado', async () => {
      const { error } = await supabase
        .from('asistencia')
        .delete()
        .in('apoderado_id', apoderadoIds)
      return { error }
    })
  }

  await executeDeleteStep('eliminando asistencia por proceso', async () => {
    const { error } = await supabase
      .from('asistencia')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando acreencias', async () => {
    const { error } = await supabase
      .from('acreencias')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando inventario', async () => {
    const { error } = await supabase
      .from('inventario')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando acreedores', async () => {
    const { error } = await supabase
      .from('acreedores')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando deudores', async () => {
    const { error } = await supabase
      .from('deudores')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando archivos de excel', async () => {
    const { error } = await supabase
      .from('proceso_excel_archivos')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  const { error: deleteApoderadosError } = await supabase
    .from('apoderados')
    .delete()
    .eq('proceso_id', id)

  if (deleteApoderadosError) {
    if (isMissingRelationError(deleteApoderadosError)) {
      console.warn(
        'Skipping delete step "eliminando apoderados" because relation is missing:',
        formatErrorDetails(deleteApoderadosError),
      )
    } else if (isForeignKeyConstraintError(deleteApoderadosError)) {
      // Some apoderados can be shared with acreencias from other procesos.
      // Detach them from this proceso so deleting the proceso can continue.
      const { error: detachApoderadosError } = await supabase
        .from('apoderados')
        .update({ proceso_id: null })
        .eq('proceso_id', id)

      if (detachApoderadosError) {
        throw toDeleteProcesoStepError(
          'desasociando apoderados compartidos',
          detachApoderadosError,
        )
      }
    } else {
      throw toDeleteProcesoStepError('eliminando apoderados', deleteApoderadosError)
    }
  }

  // Legacy schema fallback: some databases still keep apoderados.proceso.
  // If present, null it out so old FK constraints don't block deleting proceso.
  const { error: detachLegacyApoderadosError } = await supabase
    .from('apoderados')
    .update({ proceso: null } as unknown as Partial<Apoderado>)
    .eq('proceso', id)

  if (detachLegacyApoderadosError) {
    const missingColumn = getMissingColumnFromError(detachLegacyApoderadosError)
    if (missingColumn !== 'proceso' && !isMissingRelationError(detachLegacyApoderadosError)) {
      throw toDeleteProcesoStepError(
        'desasociando apoderados (columna legado proceso)',
        detachLegacyApoderadosError,
      )
    }
  }

  await executeDeleteStep('eliminando progreso', async () => {
    const { error } = await supabase
      .from('progreso')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  await executeDeleteStep('eliminando eventos', async () => {
    const { error } = await supabase
      .from('eventos')
      .delete()
      .eq('proceso_id', id)
    return { error }
  })

  const retryDelete = await deleteProcesoRow(id)

  if (retryDelete.error) {
    throw toDeleteProcesoStepError('eliminando proceso tras limpiar relaciones', retryDelete.error)
  }

  if (!retryDelete.deleted) {
    throw new Error(
      'No se pudo eliminar el proceso. Verifica permisos de borrado o intenta refrescar la página.',
    )
  }
}
