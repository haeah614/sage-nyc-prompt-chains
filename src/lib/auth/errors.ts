import { NextResponse } from "next/server";
import { z } from "zod";

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  const known = error instanceof AuthError;
  const invalid = error instanceof z.ZodError;
  return NextResponse.json(
    {
      error: known
        ? error.message
        : invalid
          ? "Invalid request."
          : "Authentication is temporarily unavailable.",
    },
    {
      status: known ? error.status : invalid ? 400 : 503,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
