"use client";

import { useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { BPN_REPLY, type Interaction } from "@/lib/domain";
import type { DashboardApi } from "./dashboard";

const labels: Record<Interaction["status"], string> = {
  pending: "Pendiente",
  allowed: "Sin problema",
  review: "Pendiente de procesar",
  ignored: "Sin acción",
  sending: "Enviando",
  replied: "Respondida",
  blocked: "Respondida y bloqueada",
  error: "No se pudo completar",
};

export function ActivityPanel({ data, busy, act }: DashboardApi) {
  const [limit, setLimit] = useState(5);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="activity-title" className="text-base font-semibold">
            Actividad reciente
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            El historial de lo que BPN ha evaluado.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={
            busy ||
            !data.billing.active ||
            data.billing.used.xRequests >= data.billing.limits.xRequests ||
            data.billing.limits.xCredits - data.billing.used.xCredits < 15
          }
          onClick={() => void act({ action: "sync" }, "Actividad actualizada")}
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
          Actualizar
        </Button>
      </div>
      <div className="mt-4 divide-y" aria-live="polite">
        {!data.interactions.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todo tranquilo por aquí. Las evaluaciones aparecerán en este
            historial.
          </p>
        )}
        {data.interactions.slice(0, limit).map((item) => (
          <article key={item.id} className="interaction-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">@{item.username}</span>
              <span
                className={`text-xs ${item.status === "error" ? "text-destructive" : item.status === "blocked" ? "text-primary" : "text-muted-foreground"}`}
              >
                {labels[item.status]}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.text}
            </p>
            {item.reply_id && (
              <p className="mt-2 text-xs text-primary">↳ {BPN_REPLY}</p>
            )}
            {item.error && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {item.error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <time dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString("es-ES", {
                  timeZone: "Europe/Madrid",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              {item.decision && (
                <span>
                  {item.decision.label === "healthy"
                    ? "Sin malos modos"
                    : item.decision.label === "insult"
                      ? "Insulto detectado"
                      : "Malos modos detectados"}
                </span>
              )}
              <a
                className="ml-auto flex items-center gap-1 hover:text-foreground"
                href={`https://x.com/${item.username}/status/${item.id}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Ver publicación de ${item.username} en X`}
              >
                Ver en X<ArrowUpRight className="size-3" />
              </a>
            </div>
          </article>
        ))}
      </div>
      {data.interactions.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setLimit(limit + 10)}
        >
          Ver más ({data.interactions.length - limit})
        </Button>
      )}
      {data.lastSync && (
        <p className="mt-4 text-xs text-muted-foreground">
          Última actualización:{" "}
          {new Date(data.lastSync).toLocaleString("es-ES", {
            timeZone: "Europe/Madrid",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
