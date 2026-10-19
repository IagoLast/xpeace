import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/server/config";
import { cookieOptions } from "@/lib/server/auth";
import { seal, unseal, sameSecret } from "@/lib/server/crypto";
import { query, withAccountLock } from "@/lib/server/db";
import { exchangeToken, xRequest } from "@/lib/server/x";

export async function GET(request: Request) {
  const jar = await cookies();
  const raw = jar.get("xpeace_oauth")?.value;
  jar.delete("xpeace_oauth");
  try {
    const params = new URL(request.url).searchParams;
    if (!raw || !params.get("code") || !params.get("state"))
      throw new Error("OAuth cancelado");
    const oauth = unseal<{ state: string; verifier: string; expires: number }>(
      raw,
      "oauth",
    );
    if (
      oauth.expires < Date.now() ||
      !sameSecret(oauth.state, params.get("state")!)
    )
      throw new Error("OAuth inválido");
    const tokens = await exchangeToken({
      grant_type: "authorization_code",
      code: params.get("code")!,
      redirect_uri: `${appUrl()}/api/auth/callback`,
      code_verifier: oauth.verifier,
    });
    const { data: user } = await xRequest<{
      data: { id: string; username: string; name: string };
    }>(tokens.access_token, "/users/me");
    const allowed = process.env.ALLOWED_X_USER_IDS?.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (allowed?.length && !allowed.includes(user.id))
      return NextResponse.redirect(`${appUrl()}/?auth_error=not_allowed`);
    const version = await withAccountLock(user.id, async () => {
      const [row] = await query<{ session_version: number }>(
        `
        INSERT INTO accounts (id,username,name,tokens,token_expires_at) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET username=$2,name=$3,tokens=$4,token_expires_at=$5,
        session_version=accounts.session_version+1, last_error=NULL, retry_at=NULL
        RETURNING session_version`,
        [
          user.id,
          user.username,
          user.name,
          seal(tokens, `tokens:${user.id}`),
          new Date(Date.now() + tokens.expires_in * 1000),
        ],
      );
      return row.session_version;
    });
    jar.set(
      "xpeace_session",
      seal(
        { accountId: user.id, version, expires: Date.now() + 30 * 86400_000 },
        "session",
      ),
      { ...cookieOptions, maxAge: 30 * 86400 },
    );
    return NextResponse.redirect(appUrl());
  } catch {
    return NextResponse.redirect(`${appUrl()}/?auth_error=connection`);
  }
}
