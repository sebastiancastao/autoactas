// Re-export all API functions
export * from './apoderados'
export * from './proceso'
export * from './deudores'
export * from './acreedores'
export * from './acreencias'
export * from './inventario'
export * from './auth-users'

// Re-export supabase client and types
export { supabase } from '../supabase'
export type {
  Database,
  Apoderado,
  ApoderadoInsert,
  ApoderadoUpdate,
  Proceso,
  ProcesoInsert,
  ProcesoUpdate,
  Deudor,
  DeudorInsert,
  DeudorUpdate,
  Acreedor,
  AcreedorInsert,
  AcreedorUpdate,
  Acreencia,
  AcreenciaInsert,
  AcreenciaUpdate,
  Inventario,
  InventarioInsert,
  InventarioUpdate,
} from '../database.types'
