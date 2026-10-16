import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "classroom-academic-planner",
    integrations: {
      supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
      googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI),
      googleTokenEncryptionConfigured: Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY),
      aiConfigured: Boolean(process.env.AI_PROVIDER_API_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY && (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === "openai")),
    },
    note: "Configuration presence only; this endpoint does not verify credentials or make external API calls."
  });
}
