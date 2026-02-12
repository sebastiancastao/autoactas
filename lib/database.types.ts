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
          proceso_id: string | null
          nombre: string
          identificacion: string
          email: string | null
          telefono: string | null
          direccion: string | null
          tarjeta_profesional: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id?: string | null
          nombre: string
          identificacion: string
          email?: string | null
          telefono?: string | null
          direccion?: string | null
          tarjeta_profesional?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string | null
          nombre?: string
          identificacion?: string
          email?: string | null
          telefono?: string | null
          direccion?: string | null
          tarjeta_profesional?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apoderados_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          }
        ]
      }
      usuarios: {
        Row: {
          id: string
          auth_id: string | null
          nombre: string
          email: string
          telefono: string | null
          rol: string
          avatar_url: string | null
          activo: boolean
          identificacion: string | null
          tarjeta_profesional: string | null
          firma_data_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          auth_id?: string | null
          nombre: string
          email: string
          telefono?: string | null
          rol?: string
          avatar_url?: string | null
          activo?: boolean
          identificacion?: string | null
          tarjeta_profesional?: string | null
          firma_data_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          auth_id?: string | null
          nombre?: string
          email?: string
          telefono?: string | null
          rol?: string
          avatar_url?: string | null
          activo?: boolean
          identificacion?: string | null
          tarjeta_profesional?: string | null
          firma_data_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      proceso: {
        Row: {
          id: string
          numero_proceso: string
          fecha_procesos: string
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
          fecha_procesos?: string
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
          fecha_procesos?: string
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
          apoderado_id: string | null
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
          apoderado_id?: string | null
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
          apoderado_id?: string | null
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
          },
          {
            foreignKeyName: "deudores_apoderado_id_fkey"
            columns: ["apoderado_id"]
            isOneToOne: false
            referencedRelation: "apoderados"
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
      acreencias: {
        Row: {
          id: string
          proceso_id: string
          apoderado_id: string
          acreedor_id: string
          naturaleza: string | null
          prelacion: string | null
          capital: number | null
          int_cte: number | null
          int_mora: number | null
          otros_cobros_seguros: number | null
          total: number | null
          porcentaje: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          apoderado_id: string
          acreedor_id: string
          naturaleza?: string | null
          prelacion?: string | null
          capital?: number | null
          int_cte?: number | null
          int_mora?: number | null
          otros_cobros_seguros?: number | null
          total?: number | null
          porcentaje?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          apoderado_id?: string
          acreedor_id?: string
          naturaleza?: string | null
          prelacion?: string | null
          capital?: number | null
          int_cte?: number | null
          int_mora?: number | null
          otros_cobros_seguros?: number | null
          total?: number | null
          porcentaje?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acreencias_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acreencias_apoderado_id_fkey"
            columns: ["apoderado_id"]
            isOneToOne: false
            referencedRelation: "apoderados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acreencias_acreedor_id_fkey"
            columns: ["acreedor_id"]
            isOneToOne: false
            referencedRelation: "acreedores"
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
      eventos: {
        Row: {
          id: string
          titulo: string
          descripcion: string | null
          fecha: string
          hora: string | null
          fecha_fin: string | null
          hora_fin: string | null
          usuario_id: string | null
          proceso_id: string | null
          tipo: string | null
          color: string | null
          recordatorio: boolean
          completado: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          titulo: string
          descripcion?: string | null
          fecha: string
          hora?: string | null
          fecha_fin?: string | null
          hora_fin?: string | null
          usuario_id?: string | null
          proceso_id?: string | null
          tipo?: string | null
          color?: string | null
          recordatorio?: boolean
          completado?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          titulo?: string
          descripcion?: string | null
          fecha?: string
          hora?: string | null
          fecha_fin?: string | null
          hora_fin?: string | null
          usuario_id?: string | null
          proceso_id?: string | null
          tipo?: string | null
          color?: string | null
          recordatorio?: boolean
          completado?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          }
        ]
      }
      progreso: {
        Row: {
          id: string
          proceso_id: string
          estado: 'no_iniciado' | 'iniciado' | 'finalizado'
          numero_audiencias: number
          fecha_procesos_real: string | null
          fecha_finalizacion: string | null
          observaciones: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          estado?: 'no_iniciado' | 'iniciado' | 'finalizado'
          numero_audiencias?: number
          fecha_procesos_real?: string | null
          fecha_finalizacion?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          estado?: 'no_iniciado' | 'iniciado' | 'finalizado'
          numero_audiencias?: number
          fecha_procesos_real?: string | null
          fecha_finalizacion?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "progreso_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: true
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          }
        ]
      }
      asistencia: {
        Row: {
          id: string
          evento_id: string | null
          proceso_id: string | null
          apoderado_id: string | null
          nombre: string
          email: string | null
          categoria: 'Acreedor' | 'Deudor' | 'Apoderado'
          estado: 'Presente' | 'Ausente'
          tarjeta_profesional: string | null
          calidad_apoderado_de: string | null
          fecha: string
          titulo: string | null
          observaciones: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          evento_id?: string | null
          proceso_id?: string | null
          apoderado_id?: string | null
          nombre: string
          email?: string | null
          categoria?: 'Acreedor' | 'Deudor' | 'Apoderado'
          estado?: 'Presente' | 'Ausente'
          tarjeta_profesional?: string | null
          calidad_apoderado_de?: string | null
          fecha?: string
          titulo?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          evento_id?: string | null
          proceso_id?: string | null
          apoderado_id?: string | null
          nombre?: string
          email?: string | null
          categoria?: 'Acreedor' | 'Deudor' | 'Apoderado'
          estado?: 'Presente' | 'Ausente'
          tarjeta_profesional?: string | null
          calidad_apoderado_de?: string | null
          fecha?: string
          titulo?: string | null
          observaciones?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asistencia_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asistencia_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asistencia_apoderado_id_fkey"
            columns: ["apoderado_id"]
            isOneToOne: false
            referencedRelation: "apoderados"
            referencedColumns: ["id"]
          }
        ]
      }
      proceso_excel_archivos: {
        Row: {
          id: string
          proceso_id: string
          original_file_name: string
          drive_file_id: string
          drive_file_name: string
          drive_web_view_link: string | null
          drive_web_content_link: string | null
          mime_type: string
          uploaded_by_auth_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          proceso_id: string
          original_file_name: string
          drive_file_id: string
          drive_file_name: string
          drive_web_view_link?: string | null
          drive_web_content_link?: string | null
          mime_type: string
          uploaded_by_auth_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          proceso_id?: string
          original_file_name?: string
          drive_file_id?: string
          drive_file_name?: string
          drive_web_view_link?: string | null
          drive_web_content_link?: string | null
          mime_type?: string
          uploaded_by_auth_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proceso_excel_archivos_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "proceso"
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

export type Acreencia = Database['public']['Tables']['acreencias']['Row']
export type AcreenciaInsert = Database['public']['Tables']['acreencias']['Insert']
export type AcreenciaUpdate = Database['public']['Tables']['acreencias']['Update']

export type Inventario = Database['public']['Tables']['inventario']['Row']
export type InventarioInsert = Database['public']['Tables']['inventario']['Insert']
export type InventarioUpdate = Database['public']['Tables']['inventario']['Update']

export type Evento = Database['public']['Tables']['eventos']['Row']
export type EventoInsert = Database['public']['Tables']['eventos']['Insert']
export type EventoUpdate = Database['public']['Tables']['eventos']['Update']

export type Progreso = Database['public']['Tables']['progreso']['Row']
export type ProgresoInsert = Database['public']['Tables']['progreso']['Insert']
export type ProgresoUpdate = Database['public']['Tables']['progreso']['Update']

export type Asistencia = Database['public']['Tables']['asistencia']['Row']
export type AsistenciaInsert = Database['public']['Tables']['asistencia']['Insert']
export type AsistenciaUpdate = Database['public']['Tables']['asistencia']['Update']

export type ProcesoExcelArchivo = Database['public']['Tables']['proceso_excel_archivos']['Row']
export type ProcesoExcelArchivoInsert = Database['public']['Tables']['proceso_excel_archivos']['Insert']
export type ProcesoExcelArchivoUpdate = Database['public']['Tables']['proceso_excel_archivos']['Update']
