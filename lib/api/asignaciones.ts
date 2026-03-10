import { supabase } from "../supabase";

export type AsignacionUsuario = {
  id: string;
  usuario_origen_id: string;
  usuario_destino_id: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export type AsignacionConNombres = AsignacionUsuario & {
  origen_nombre: string;
  destino_nombre: string;
};

export async function getAsignaciones(): Promise<AsignacionConNombres[]> {
  const { data, error } = await supabase
    .from("asignaciones_usuario")
    .select(
      `id, usuario_origen_id, usuario_destino_id, activo, created_at, updated_at,
       origen:usuarios!asignaciones_usuario_usuario_origen_id_fkey(nombre),
       destino:usuarios!asignaciones_usuario_usuario_destino_id_fkey(nombre)`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    usuario_origen_id: row.usuario_origen_id,
    usuario_destino_id: row.usuario_destino_id,
    activo: row.activo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    origen_nombre: row.origen?.nombre ?? "—",
    destino_nombre: row.destino?.nombre ?? "—",
  }));
}

/**
 * Given a usuario_id (the logged-in user), returns the destino usuario_id
 * if there is an active assignment configured for them. Returns null otherwise.
 */
export async function getDestinoAsignado(
  usuarioOrigenId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("asignaciones_usuario")
    .select("usuario_destino_id")
    .eq("usuario_origen_id", usuarioOrigenId)
    .eq("activo", true)
    .maybeSingle();

  if (error) {
    console.warn("Error fetching asignacion:", error);
    return null;
  }

  return data?.usuario_destino_id ?? null;
}

export async function createAsignacion(
  usuarioOrigenId: string,
  usuarioDestinoId: string
): Promise<AsignacionUsuario> {
  const { data, error } = await supabase
    .from("asignaciones_usuario")
    .insert({
      usuario_origen_id: usuarioOrigenId,
      usuario_destino_id: usuarioDestinoId,
      activo: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateAsignacion(
  id: string,
  patch: { activo?: boolean; usuario_destino_id?: string }
): Promise<AsignacionUsuario> {
  const { data, error } = await supabase
    .from("asignaciones_usuario")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAsignacion(id: string): Promise<void> {
  const { error } = await supabase
    .from("asignaciones_usuario")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
