"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import type { Billing, Usage } from "@/lib/domain";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

const meters: { key: keyof Usage; label: string }[] = [
  { key: "xCredits", label: "Créditos de actividad en X" },
  { key: "analyses", label: "Análisis con JEV" },
  { key: "cleanup", label: "Operaciones de limpieza" },
  { key: "xRequests", label: "Consultas a X, incluidas las vacías" },
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
    async (action: "checkout" | "portal" | "refresh") => {
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
          ? "Un plan para tu cuenta de X. Estos son tus cupos del período actual."
          : "2,99 USD/mes por cuenta. Incluye BPN y limpieza de historial para uso ligero, dentro de estos cupos compartidos. Revisa el total en Stripe antes de pagar."}
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {meters.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">
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
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Leer una publicación usa 1 crédito y consultar su autor, 2 más.
        Responder o bloquear usa 3; eliminar una publicación o un «me gusta», 2.
        Las vistas previas también consumen créditos. Los análisis y la limpieza
        comparten este saldo; sus máximos no se suman al cupo de X.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Si una consulta falla, cuenta el cupo reservado para ella. X requiere
        saldo para al menos 5 publicaciones por consulta. Sin saldo suficiente,
        la operación se pausa hasta la renovación. No hay cobros por exceso.
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
      {!billing.active && (
        <p className="notice mt-4">
          El procesamiento está pausado hasta que haya una suscripción pagada
          activa.
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
        {billing.hasCustomer && (
          <Button
            variant="ghost"
            disabled={!billing.configured || pending}
            onClick={() => void request("refresh")}
          >
            Comprobar pago
          </Button>
        )}
      </div>
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
