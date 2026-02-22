import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { message: "Configuración de servidor incompleta." },
      { status: 500 }
    );
  }

  // Verify caller identity via Bearer token
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!accessToken) {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  // Verify token and check admin role
  const { data: { user: callerUser }, error: userError } =
    await supabaseAdmin.auth.getUser(accessToken);

  if (userError || !callerUser) {
    return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  }

  const { data: callerProfile } = await supabaseAdmin
    .from("usuarios")
    .select("rol")
    .eq("auth_id", callerUser.id)
    .maybeSingle();

  const isAdmin =
    (callerProfile?.rol ?? "").trim().toLowerCase() === "admin";

  if (!isAdmin) {
    return NextResponse.json(
      { message: "Acceso denegado. Se requiere rol de administrador." },
      { status: 403 }
    );
  }

  // Parse request body
  let authId: string | undefined;
  try {
    const body = await request.json();
    authId = body.authId;
  } catch {
    return NextResponse.json(
      { message: "Cuerpo de solicitud inválido." },
      { status: 400 }
    );
  }

  if (!authId || typeof authId !== "string") {
    return NextResponse.json(
      { message: "El campo authId es requerido." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(authId);
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
