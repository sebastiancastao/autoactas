import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}

// Lazy singleton for backwards compatibility
let _supabase: ReturnType<typeof createBrowserClient<Database>> | null = null

export const supabase = {
  get from() {
    if (!_supabase && supabaseUrl && supabaseAnonKey) {
      _supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
    }
    return _supabase!.from.bind(_supabase!)
  },
  get auth() {
    if (!_supabase && supabaseUrl && supabaseAnonKey) {
      _supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
    }
    return _supabase!.auth
  },
  get storage() {
    if (!_supabase && supabaseUrl && supabaseAnonKey) {
      _supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
    }
    return _supabase!.storage
  }
}
