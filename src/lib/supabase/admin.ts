import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

// Server-only admin client. Never import this module into a client component.
export function createSupabaseAdmin() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
