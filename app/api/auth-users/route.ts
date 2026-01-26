import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sanitizeUser = (user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}) => ({
  id: user.id,
  email: user.email ?? null,
  user_metadata: user.user_metadata ?? {},
});

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.warn(
      "Auth users API: missing Supabase configuration (url or service role key). Skipping user listing."
    );
    return NextResponse.json([], { status: 200 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 100 });
  if (error) {
    console.error("Auth users API error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json((data?.users ?? []).map(sanitizeUser));
}
