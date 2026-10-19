import { Dashboard } from "@/components/dashboard";
import { configuration } from "@/lib/server/config";
import { sessionAccount } from "@/lib/server/auth";
import { snapshot } from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";
export default async function UtilitiesPage() {
  const missing = configuration();
  const account = missing.length ? null : await sessionAccount();
  return (
    <Dashboard
      key={account?.id ?? "disconnected"}
      initial={account ? await snapshot(account) : null}
      missing={missing}
      section="utilities"
    />
  );
}
