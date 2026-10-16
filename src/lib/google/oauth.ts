import "server-only";
import { google } from "googleapis";
import { requiredEnv } from "@/lib/env";
import { GOOGLE_SCOPES } from "@/lib/google/scopes";

export function makeOAuthClient() {
  return new google.auth.OAuth2(
    requiredEnv("GOOGLE_CLIENT_ID"),
    requiredEnv("GOOGLE_CLIENT_SECRET"),
    requiredEnv("GOOGLE_REDIRECT_URI")
  );
}

export function makeConsentUrl(state: string) {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [...GOOGLE_SCOPES],
    state,
  });
}
