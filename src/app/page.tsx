import { Dashboard } from "@/components/dashboard";
import { configuration } from "@/lib/server/config";
import { sessionAccount } from "@/lib/server/auth";
import { snapshot } from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const missing = configuration();
  const account = missing.length ? null : await sessionAccount();
  const params = await searchParams;
  return (
    <Dashboard
      key={account?.id ?? "disconnected"}
      initial={account ? await snapshot(account) : null}
      missing={missing}
      authError={
        typeof params.auth_error === "string" ? params.auth_error : undefined
      }
      billingReturn={
        typeof params.billing === "string" ? params.billing : undefined
      }
    />
  );
}
