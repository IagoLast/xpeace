"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, CreditCard } from "lucide-react";
import type { Billing, Usage } from "@/lib/domain";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

const meters: { key: keyof Usage; label: string }[] = [
  { key: "xCredits", label: "Créditos de actividad en X" },
  { key: "analyses", label: "Evaluaciones" },
  { key: "cleanup", label: "Operaciones de limpieza" },
  { key: "xRequests", label: "Consultas a X" },
];

export function BillingPanel({
  billing,
  returnState,
  refresh,
}: {
  billing: Billing;
  returnState?: string;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const checkedReturn = useRef(false);
  const request = useCallback(
    async (action: "checkout" | "portal" | "cancel" | "refresh") => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError("");
      setMessage("");
      try {
        const response = await fetch(`/api/billing/${action}`, {
          method: "POST",
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ?? "No se pudo consultar tu suscripción.",
          );
        if (action === "refresh") {
          await refresh();
          setMessage(
            result.active
              ? "Suscripción actualizada."
              : "Todavía no hay un período pagado activo. Si acabas de pagar, vuelve a comprobarlo en unos instantes.",
          );
        } else {
          window.location.assign(result.url);
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo abrir la facturación.",
        );
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (
      checkedReturn.current ||
      !billing.configured ||
      !["success", "return"].includes(returnState ?? "")
    )
      return;
    checkedReturn.current = true;
    void request("refresh");
  }, [billing.configured, returnState, request]);

  const exhausted = meters.some(
    ({ key }) => billing.used[key] >= billing.limits[key],
  );
  const status = !billing.configured
    ? "Suscripciones próximamente"
    : billing.active
      ? billing.cancelAtPeriodEnd
        ? "Baja programada"
        : "Suscripción activa"
      : billing.status === "past_due" || billing.status === "unpaid"
        ? "Pago pendiente"
        : billing.status === "canceled"
          ? "Suscripción cancelada"
          : "Activa tu plan mensual";

  return (
    <Card className="panel billing-panel" id="billing">
      <div className="flex items-center gap-2.5">
        <CreditCard className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Tu suscripción</h2>
      </div>
      <p className="mt-3 text-sm font-medium">{status}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {billing.active
          ? "BPN y limpieza de historial incluidos en tu plan."
          : "2,99 USD/mes. BPN y limpieza de historial, con los límites de uso de tu plan. Cancela cuando quieras."}
      </p>
      {billing.periodEnd && (
        <p className="mt-3 text-xs text-muted-foreground">
          {billing.active
            ? billing.cancelAtPeriodEnd
              ? "Acceso hasta el "
              : "Fin del período y próxima renovación: "
            : "Último período hasta el "}
          {new Date(billing.periodEnd).toLocaleDateString("es-ES", {
            timeZone: "UTC",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          .
        </p>
      )}
      {billing.active && exhausted && (
        <p className="notice mt-4" role="status">
          Has agotado un cupo. Tu progreso queda guardado.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {!billing.active && (
          <Button
            disabled={!billing.configured || pending}
            onClick={() => void request("checkout")}
          >
            {pending
              ? "Abriendo…"
              : billing.status === "past_due" || billing.status === "unpaid"
                ? "Resolver pago"
                : "Suscribirme"}
          </Button>
        )}
        {billing.hasCustomer && (
          <Button
            variant="outline"
            disabled={!billing.configured || pending}
            onClick={() => void request("portal")}
          >
            Gestionar suscripción
          </Button>
        )}
        {billing.hasCustomer &&
          !billing.cancelAtPeriodEnd &&
          ["active", "trialing", "past_due", "unpaid", "paused"].includes(
            billing.status,
          ) && (
            <Button
              variant="ghost"
              disabled={!billing.configured || pending}
              onClick={() => void request("cancel")}
            >
              Cancelar suscripción
            </Button>
          )}
      </div>
      <details className="disclosure usage-details mt-5 border-t">
        <summary className="px-0! py-4! text-xs text-muted-foreground">
          Uso de este mes
          <ChevronDown className="disclosure-chevron" />
        </summary>
        <dl className="grid gap-4 sm:grid-cols-2">
          {meters.map(({ key, label }) => (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm tabular-nums">
                {billing.used[key].toLocaleString("es-ES")} /{" "}
                {billing.limits[key].toLocaleString("es-ES")}
              </dd>
              <progress
                className="mt-2 h-1.5 w-full accent-primary"
                aria-label={label}
                value={billing.used[key]}
                max={billing.limits[key]}
              />
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          BPN y las utilidades comparten el saldo de actividad en X. Cuando se
          agota, las tareas se pausan hasta la renovación. No hay cobros por
          exceso.
        </p>
      </details>
      {billing.hasCustomer && !billing.active && (
        <Button
          className="mt-3"
          variant="ghost"
          size="sm"
          disabled={!billing.configured || pending}
          onClick={() => void request("refresh")}
        >
          Comprobar pago
        </Button>
      )}
      {returnState === "cancelled" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Has vuelto sin completar el pago.
        </p>
      )}
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice-error mt-3" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
