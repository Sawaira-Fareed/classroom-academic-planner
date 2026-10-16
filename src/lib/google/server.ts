import "server-only";
import { google } from "googleapis";
import { decryptGoogleToken, encryptGoogleToken } from "@/lib/google/token-vault";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { requiredEnv } from "@/lib/env";

export async function getGoogleClient(userId: string) {
  const admin = createSupabaseAdmin();
  const { data: connection, error } = await admin
    .from("google_connections")
    .select("refresh_token_ciphertext,token_key_version,scopes,study_calendar_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load Google connection: ${error.message}`);
  if (!connection?.refresh_token_ciphertext) throw new Error("Google Classroom is not connected.");

  const refreshToken = decryptGoogleToken(connection.refresh_token_ciphertext, connection.token_key_version);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = await response.json().catch(() => null) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  } | null;
  if (!response.ok || !tokens?.access_token) {
    throw new Error("Google access token refresh failed. Reconnect Google from Settings.");
  }
  if (tokens.refresh_token) {
    const { ciphertext, keyVersion } = encryptGoogleToken(tokens.refresh_token);
    const { error: updateError } = await admin.from("google_connections").update({
      refresh_token_ciphertext: ciphertext,
      token_key_version: keyVersion,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (updateError) throw new Error(`Could not rotate Google refresh token: ${updateError.message}`);
  }

  const auth = new google.auth.OAuth2(requiredEnv("GOOGLE_CLIENT_ID"), requiredEnv("GOOGLE_CLIENT_SECRET"), requiredEnv("GOOGLE_REDIRECT_URI"));
  auth.setCredentials({
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expiry_date: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  return { auth, admin, connection };
}
