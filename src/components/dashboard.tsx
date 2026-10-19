"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Leaf } from "lucide-react";
import { toast } from "sonner";
import type { Decision, Snapshot } from "@/lib/domain";
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
  ) => Promise<{ decision?: Decision } | null>;
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
      <header className="app-header">
        <Link href="/" className="brand" aria-label="xpeace, inicio">
          <Leaf className="size-5 text-primary" strokeWidth={1.8} />
          <span>
            xpeace<span className="text-primary">.</span>
          </span>
        </Link>
        <span className="text-xs text-muted-foreground">
          Menos ruido. Más paz.
        </span>
      </header>
      <main id="main-content" className="space-y-5">
        <div className="intro">
          <h1>Tu X, más tranquilo.</h1>
          <p>Conecta tu cuenta. Pon tus límites. Y listo.</p>
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
  const router = useRouter();
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
        if (payload.action === "disconnect") {
          router.refresh();
          router.push("/");
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
    [refresh, router],
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
  const reviews = data.interactions.filter((i) => i.status === "review").length;
  const errors = data.interactions.filter((i) => i.error).length;
  const job = data.jobs[0];
  const cleanupLabel =
    job?.status === "scanning"
      ? "Preparando vista previa…"
      : job?.status === "running"
        ? `Limpieza en curso · ${job.done} de ${job.total}`
        : job?.status === "ready"
          ? `${job.total} elementos para revisar`
          : job?.status === "error"
            ? "La limpieza necesita atención"
            : "Borra tweets, likes y respuestas antiguos";

  return (
    <>
      {data.lastError && (
        <div role="alert" className="notice notice-error">
          {data.lastError}
        </div>
      )}
      <ConnectionPanel {...api} />
      <BillingPanel
        billing={data.billing}
        returnState={billingReturn}
        refresh={refresh}
      />
      <BpnPanel {...api} />
      <details className="disclosure panel" id="activity">
        <summary>
          <div>
            <h2>
              {reviews
                ? `${reviews} ${reviews === 1 ? "respuesta por revisar" : "respuestas por revisar"}`
                : "Actividad reciente"}
            </h2>
            <p className={errors ? "text-destructive" : ""}>
              {errors
                ? `${errors} ${errors === 1 ? "error necesita" : "errores necesitan"} atención`
                : "Revisa las decisiones de BPN"}
            </p>
          </div>
          {reviews > 0 && <span className="review-dot" aria-hidden="true" />}
          <ChevronDown className="disclosure-chevron" />
        </summary>
        <div className="disclosure-body">
          <ActivityPanel {...api} />
        </div>
      </details>
      <details className="disclosure panel" id="cleanup">
        <summary>
          <div>
            <h2>Limpiar historial</h2>
            <p>{cleanupLabel}</p>
          </div>
          <ChevronDown className="disclosure-chevron" />
        </summary>
        <div className="disclosure-body">
          <CleanupPanel {...api} />
        </div>
      </details>

      {busy && (
        <span className="sr-only" role="status">
          Procesando
        </span>
      )}
    </>
  );
}
