"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "./app-header";
import { toast } from "sonner";
import type { Snapshot } from "@/lib/domain";
import { ActivityPanel } from "./interactions";
import { BpnPanel, ConnectAccount, ConnectionPanel } from "./settings-panel";
import { BillingPanel } from "./billing-panel";
import { MutedUsersPanel } from "./muted-users";

export type Action = { action: string; [key: string]: unknown };
export type DashboardApi = {
  data: Snapshot;
  busy: boolean;
  act: (
    payload: Action,
    message?: string,
  ) => Promise<Record<string, unknown> | null>;
};
export function Dashboard({
  initial,
  missing,
  authError,
  billingReturn,
}: {
  initial: Snapshot | null;
  missing: string[];
  authError?: string;
  billingReturn?: string;
}) {
  return (
    <div className="workspace">
      <AppHeader />
      <main id="main-content" className="space-y-5">
        <div className="intro">
          <h1>Tu X, más tranquilo.</h1>
          <p>Los malos modos se quedan fuera. Tú sigues a lo tuyo.</p>
        </div>
        {authError && (
          <div role="alert" className="notice notice-error">
            {authError === "not_allowed"
              ? "Esta cuenta no está autorizada para este despliegue."
              : "No se pudo conectar X. Vuelve a intentarlo o revisa la configuración de la conexión."}
          </div>
        )}
        {initial ? (
          <ConnectedDashboard initial={initial} billingReturn={billingReturn} />
        ) : (
          <ConnectAccount missing={missing} />
        )}
        {!initial && (
          <section aria-labelledby="how-it-works" className="pt-3">
            <h2 id="how-it-works" className="text-sm font-semibold">
              Cómo funciona
            </h2>
            <ol className="mt-4 grid gap-5 sm:grid-cols-3">
              {[
                [
                  "Lee tus respuestas",
                  "Recoge las respuestas a tus tweets y tus menciones.",
                ],
                [
                  "Evalúa el contenido",
                  "Detecta si hay un insulto o una falta de respeto.",
                ],
                [
                  "Silencia si hace falta",
                  "Responde y silencia a quienes superan tu umbral de abuso.",
                ],
              ].map(([title, description], index) => (
                <li key={title} className="flex gap-3 sm:block">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-primary sm:mb-3"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
      <footer className="app-footer">Tu cuenta, tus decisiones.</footer>
    </div>
  );
}

function ConnectedDashboard({
  initial,
  billingReturn,
}: {
  initial: Snapshot;
  billingReturn?: string;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "La sesión ha caducado. Vuelve a conectar X."
          : "No se pudo actualizar el panel.",
      );
    setData(await response.json());
  }, []);

  const act = useCallback<DashboardApi["act"]>(
    async (payload, message) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
          // A partial external operation may already have changed the durable record.
          try {
            await refresh();
          } catch {
            /* Keep the original operation error. */
          }
          throw new Error(result.error ?? "No se pudo completar la operación.");
        }
        if (payload.action === "logout") {
          // Discard all account data and the router cache after invalidating the session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
          return {};
        }
        await refresh();
        if (message) toast.success(message);
        return result;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Algo ha fallado.",
        );
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    const timer = setInterval(async () => {
      if (busyRef.current || document.hidden) return;
      try {
        await refresh();
      } catch {
        /* Explicit refresh displays errors; polling stays quiet. */
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const api = { data, busy, act };

  return (
    <>
      {data.lastError && (
        <div role="alert" className="notice notice-error">
          {data.lastError}
        </div>
      )}
      <ConnectionPanel {...api} />
      <BpnPanel {...api} />
      <MutedUsersPanel {...api} />
      <BillingPanel
        billing={data.billing}
        returnState={billingReturn}
        refresh={refresh}
      />
      <section
        className="panel activity-panel"
        id="activity"
        aria-labelledby="activity-title"
      >
        <ActivityPanel {...api} />
      </section>
    </>
  );
}
