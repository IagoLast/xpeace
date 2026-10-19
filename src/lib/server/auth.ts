import "server-only";
import { cookies } from "next/headers";
import { appUrl } from "./config";
import { unseal } from "./crypto";
import { getAccount } from "./x";

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
export type Session = { accountId: string; version: number; expires: number };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function sessionAccount() {
  const raw = (await cookies()).get("xpeace_session")?.value;
  if (!raw) return null;
  let session: Session;
  try {
    session = unseal<Session>(raw, "session");
  } catch {
    return null;
  }
  if (session.expires < Date.now()) return null;
  const account = await getAccount(session.accountId);
  return account.session_version === session.version ? account : null;
}

export async function authorize(request: Request) {
  const account = await sessionAccount();
  if (!account)
    throw new HttpError(401, "Conecta tu cuenta de X para continuar.");
  if (request.method !== "GET" && request.headers.get("origin") !== appUrl()) {
    throw new HttpError(403, "Origen de la petición no permitido.");
  }
  return account;
}
