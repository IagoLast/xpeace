"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AppHeader } from "./app-header";
import { toast } from "sonner";
import type { Snapshot } from "@/lib/domain";
import { ActivityPanel } from "./interactions";
import { CleanupPanel } from "./cleanup-panel";
import { BpnPanel, ConnectAccount, ConnectionPanel } from "./settings-panel";
import { BillingPanel } from "./billing-panel";

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
  section = "activity",
}: {
  initial: Snapshot | null;
  missing: string[];
  authError?: string;
  billingReturn?: string;
  section?: "activity" | "utilities";
}) {
  return (
    <div className="workspace">
      <AppHeader />
      <main id="main-content" className="space-y-5">
        <div className="intro">
          <h1>
            {section === "utilities"
              ? "Haz sitio para lo que viene."
              : "Tu X, más tranquilo."}
          </h1>
          <p>
            {section === "utilities"
              ? "Utilidades para poner tu cuenta a punto."
              : "Los malos modos se quedan fuera. Tú sigues a lo tuyo."}
          </p>
        </div>
        {authError && (
          <div role="alert" className="notice notice-error">
            {authError === "not_allowed"
              ? "Esta cuenta no está autorizada para este despliegue."
              : "No se pudo conectar X. Vuelve a intentarlo o revisa la configuración de la conexión."}
          </div>
        )}
        {initial ? (
          <ConnectedDashboard
            initial={initial}
            billingReturn={billingReturn}
            section={section}
          />
        ) : (
          <ConnectAccount missing={missing} />
        )}
      </main>
      <footer className="app-footer">Tu cuenta, tus decisiones.</footer>
    </div>
  );
}

function ConnectedDashboard({
  initial,
  billingReturn,
  section,
}: {
  initial: Snapshot;
  billingReturn?: string;
  section: "activity" | "utilities";
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
      if (
        data.billing.active &&
        data.billing.used.xRequests < data.billing.limits.xRequests &&
        data.jobs.some(
          (j) =>
            (j.status === "scanning" &&
              data.billing.limits.xCredits - data.billing.used.xCredits >= 5) ||
            (j.status === "running" &&
              data.billing.limits.xCredits - data.billing.used.xCredits >= 2 &&
              data.billing.used.cleanup < data.billing.limits.cleanup),
        )
      )
        await act({ action: "work" });
      else {
        try {
          await refresh();
        } catch {
          /* Explicit refresh displays errors; polling stays quiet. */
        }
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [act, data.jobs, data.billing, refresh]);

  const api = { data, busy, act };

  return (
    <>
      {data.lastError && (
        <div role="alert" className="notice notice-error">
          {data.lastError}
        </div>
      )}
      <ConnectionPanel {...api} />
      <nav className="section-nav" aria-label="Tu cuenta">
        <Link
          href="/"
          aria-current={section === "activity" ? "page" : undefined}
        >
          BPN y actividad
        </Link>
        <Link
          href="/utilities"
          aria-current={section === "utilities" ? "page" : undefined}
        >
          Utilidades
        </Link>
      </nav>
      {section === "activity" ? (
        <>
          <BpnPanel {...api} />
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
          <Link href="/utilities" className="utility-link">
            <span>¿Quieres limpiar tus tweets y likes?</span>
            <ArrowUpRight className="size-4" />
          </Link>
        </>
      ) : (
        <section
          className="panel activity-panel"
          aria-labelledby="cleanup-title"
        >
          <h2 id="cleanup-title" className="text-base font-semibold">
            Limpiar historial
          </h2>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">
            Borra tus tweets y respuestas, o retira tus likes.
          </p>
          {!data.billing.active && (
            <p className="notice mb-5">
              Necesitas una suscripción activa.{" "}
              <Link href="/#billing" className="underline">
                Ver suscripción
              </Link>
            </p>
          )}
          <CleanupPanel {...api} />
        </section>
      )}

      {busy && (
        <span className="sr-only" role="status">
          Procesando
        </span>
      )}
    </>
  );
}
