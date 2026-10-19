import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { configuration, appUrl, required } from "@/lib/server/config";
import { cookieOptions } from "@/lib/server/auth";
import { seal } from "@/lib/server/crypto";

export async function GET() {
  if (configuration().length)
    return NextResponse.json(
      {
        error: "Completa las variables de .env.example antes de conectar X.",
        missing: configuration(),
      },
      { status: 503 },
    );
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  (await cookies()).set(
    "xpeace_oauth",
    seal({ state, verifier, expires: Date.now() + 600_000 }, "oauth"),
    { ...cookieOptions, maxAge: 600 },
  );
  const params = new URLSearchParams({
    response_type: "code",
    client_id: required("X_CLIENT_ID"),
    redirect_uri: `${appUrl()}/api/auth/callback`,
    scope:
      "tweet.read tweet.write users.read like.read like.write block.read block.write offline.access",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return NextResponse.redirect(`https://x.com/i/oauth2/authorize?${params}`);
}
