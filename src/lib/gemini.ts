import "server-only";

import { AuthError } from "@/lib/auth/errors";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export async function generateWithGemini(input: {
  modelKey: string;
  instruction: string;
  input: string;
  generationConfig: Record<string, unknown>;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AuthError(503, "Gemini execution is not configured.");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(input.modelKey))
    throw new AuthError(400, "The selected model is invalid.");
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelKey)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${input.instruction}\n\nInput:\n${input.input}` },
              ],
            },
          ],
          generationConfig: input.generationConfig,
        }),
        signal: AbortSignal.timeout(90000),
        cache: "no-store",
      },
    );
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    console.error("Gemini request could not reach the provider", {
      modelKey: input.modelKey,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new AuthError(
      503,
      timedOut
        ? "Gemini timed out after 90 seconds. Retry with a shorter input."
        : "Gemini could not be reached. Check network access and retry.",
    );
  }
  if (!response.ok) {
    console.error("Gemini provider rejected the request", {
      modelKey: input.modelKey,
      status: response.status,
    });
    const message =
      response.status === 401 || response.status === 403
        ? "Gemini rejected the configured API key. Check GEMINI_API_KEY and its API access."
        : response.status === 404
          ? `Gemini model ${input.modelKey} was not found. Check the approved model key.`
          : response.status === 429
            ? "Gemini quota or rate limits were reached. Check the project quota and retry later."
            : response.status >= 500
              ? "Gemini is temporarily unavailable. Retry shortly."
              : `Gemini rejected the request (HTTP ${response.status}). Check the model configuration.`;
    throw new AuthError(
      response.status === 429 || response.status >= 500 ? 503 : 502,
      message,
    );
  }
  const body = (await response.json()) as GeminiResponse;
  const text =
    body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";
  if (!text) throw new AuthError(502, "Gemini returned no text output.");
  return {
    text,
    usage: {
      ...(body.usageMetadata?.promptTokenCount === undefined
        ? {}
        : { input_tokens: body.usageMetadata.promptTokenCount }),
      ...(body.usageMetadata?.candidatesTokenCount === undefined
        ? {}
        : { output_tokens: body.usageMetadata.candidatesTokenCount }),
      ...(body.usageMetadata?.totalTokenCount === undefined
        ? {}
        : { total_tokens: body.usageMetadata.totalTokenCount }),
    },
  };
}
