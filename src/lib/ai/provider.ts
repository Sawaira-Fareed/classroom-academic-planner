import "server-only";

type AiProvider = "openai" | "openrouter";

type AiProviderConfig = {
  endpoint: string;
  headers: Record<string, string>;
  model: string;
};

export function getAiProviderConfig(): AiProviderConfig | null {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  const provider = process.env.AI_PROVIDER || "openai";
  if (!apiKey || (provider !== "openai" && provider !== "openrouter")) return null;

  const supportedProvider: AiProvider = provider;
  const isOpenRouter = supportedProvider === "openrouter";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (isOpenRouter) {
    headers["HTTP-Referer"] = process.env.APP_BASE_URL || "https://classroom-academic-planner.vercel.app";
    headers["X-Title"] = "StudyFlow";
  }

  return {
    endpoint: isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions",
    headers,
    model: process.env.AI_MODEL || (isOpenRouter ? "openai/gpt-4o" : "gpt-4o-mini"),
  };
}
