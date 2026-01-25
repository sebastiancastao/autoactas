export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      apoderados: {
        Row: {
          id: string
          nombre: string
          identificacion: string
          email: string | null
          telefono: string | null
          direccion: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nombre: string
          identificacion: string
          email?: string | null
          telefono?: string | null
          direccion?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          identificacion?: string
          email?: string | null
          telefono?: string | null
          direccion?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      proceso: {
        Row: {
          id: string
          numero_proceso: string
          fecha_inicio: string
          estado: string | null
          descripcion: string | null
          tipo_proceso: string | null
          juzgado: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          numero_proceso: string
          fecha_inicio?: string
          estado?: string | null
          descripcion?: string | null
          tipo_proceso?: string | null
          juzgado?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          numero_proceso?: string
          fecha_inicio?: string
          estado?: string | null
          descripcion?: string | null
          tipo_proceso?: string | null
          juzgado?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      deudores: {
        Row: {
          id: string
          proceso_id: string
          nombre: string
          identificacion: string
          tipo_identificacion: string | null
          direccion: string | null
          telefono: string | null
          email: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          nombre: string
          identificacion: string
          tipo_identificacion?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          nombre?: string
          identificacion?: string
          tipo_identificacion?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deudores_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          }
        ]
      }
      acreedores: {
        Row: {
          id: string
          proceso_id: string
          apoderado_id: string | null
          nombre: string
          identificacion: string
          tipo_identificacion: string | null
          direccion: string | null
          telefono: string | null
          email: string | null
          monto_acreencia: number | null
          tipo_acreencia: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          apoderado_id?: string | null
          nombre: string
          identificacion: string
          tipo_identificacion?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          monto_acreencia?: number | null
          tipo_acreencia?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          apoderado_id?: string | null
          nombre?: string
          identificacion?: string
          tipo_identificacion?: string | null
          direccion?: string | null
          telefono?: string | null
          email?: string | null
          monto_acreencia?: number | null
          tipo_acreencia?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acreedores_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acreedores_apoderado_id_fkey"
            columns: ["apoderado_id"]
            isOneToOne: false
            referencedRelation: "apoderados"
            referencedColumns: ["id"]
          }
        ]
      }
      inventario: {
        Row: {
          id: string
          proceso_id: string
          acreedor_id: string | null
          apoderado_id: string | null
          descripcion: string
          valor: number | null
          tipo: string | null
          estado: string | null
          ubicacion: string | null
          observaciones: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          acreedor_id?: string | null
          apoderado_id?: string | null
          descripcion: string
          valor?: number | null
          tipo?: string | null
          estado?: string | null
          ubicacion?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          acreedor_id?: string | null
          apoderado_id?: string | null
          descripcion?: string
          valor?: number | null
          tipo?: string | null
          estado?: string | null
          ubicacion?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_acreedor_id_fkey"
            columns: ["acreedor_id"]
            isOneToOne: false
            referencedRelation: "acreedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_apoderado_id_fkey"
            columns: ["apoderado_id"]
            isOneToOne: false
            referencedRelation: "apoderados"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

// Convenience types
export type Apoderado = Database['public']['Tables']['apoderados']['Row']
export type ApoderadoInsert = Database['public']['Tables']['apoderados']['Insert']
export type ApoderadoUpdate = Database['public']['Tables']['apoderados']['Update']

export type Proceso = Database['public']['Tables']['proceso']['Row']
export type ProcesoInsert = Database['public']['Tables']['proceso']['Insert']
export type ProcesoUpdate = Database['public']['Tables']['proceso']['Update']

export type Deudor = Database['public']['Tables']['deudores']['Row']
export type DeudorInsert = Database['public']['Tables']['deudores']['Insert']
export type DeudorUpdate = Database['public']['Tables']['deudores']['Update']

export type Acreedor = Database['public']['Tables']['acreedores']['Row']
export type AcreedorInsert = Database['public']['Tables']['acreedores']['Insert']
export type AcreedorUpdate = Database['public']['Tables']['acreedores']['Update']

export type Inventario = Database['public']['Tables']['inventario']['Row']
export type InventarioInsert = Database['public']['Tables']['inventario']['Insert']
export type InventarioUpdate = Database['public']['Tables']['inventario']['Update']
