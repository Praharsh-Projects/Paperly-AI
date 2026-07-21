export const OPENROUTER_KEY_HEADER = "x-openrouter-api-key";

export function readOpenRouterApiKey(headers: Headers): string | null {
  const value = headers.get(OPENROUTER_KEY_HEADER)?.trim();
  return value || null;
}
