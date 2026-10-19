"use client";

import { useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import type { Interaction } from "@/lib/domain";
import type { DashboardApi } from "./dashboard";

const labels: Record<Interaction["status"], string> = {
  pending: "Pendiente",
  allowed: "Sin problema",
  review: "Por revisar",
  ignored: "Ignorada",
  sending: "Enviando",
  replied: "Respondida",
  blocked: "Bloqueada",
  error: "Revisar error",
};

export function ActivityPanel({ data, busy, act }: DashboardApi) {
  const [filter, setFilter] = useState(
    data.interactions.some((i) => i.status === "review") ? "review" : "all",
  );
  const [limit, setLimit] = useState(5);
  const reviews = data.interactions.filter((i) => i.status === "review");
  const items = filter === "review" ? reviews : data.interactions;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value);
            setLimit(5);
          }}
        >
          <TabsList>
            <TabsTrigger value="review">
              Por revisar ({reviews.length})
            </TabsTrigger>
            <TabsTrigger value="all">Todas</TabsTrigger>
          </TabsList>
        </Tabs>
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
        {!items.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filter === "review"
              ? "Todo al día. No hay respuestas pendientes."
              : "Aquí aparecerán tus menciones y respuestas tras actualizar."}
          </p>
        )}
        {items.slice(0, limit).map((item) => (
          <article key={item.id} className="interaction-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">@{item.username}</span>
              <span
                className={`text-xs ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {labels[item.status]}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.text}
            </p>
            {item.reply_id && (
              <p className="mt-2 text-xs text-primary">↳ block por nabo</p>
            )}
            {item.error && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {item.error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {item.status === "review" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      !data.billing.active ||
                      data.billing.limits.xRequests -
                        data.billing.used.xRequests <
                        (data.settings.block ? 3 : 2) ||
                      data.billing.limits.xCredits -
                        data.billing.used.xCredits <
                        (data.settings.block ? 7 : 4)
                    }
                    onClick={() =>
                      void act(
                        { action: "moderate", id: item.id, choice: "apply" },
                        "Interacción procesada",
                      )
                    }
                  >
                    Aplicar BPN
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        { action: "moderate", id: item.id, choice: "ignore" },
                        "Interacción ignorada",
                      )
                    }
                  >
                    Ignorar
                  </Button>
                </>
              )}
              <a
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
      {items.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setLimit(limit + 10)}
        >
          Ver más ({items.length - limit})
        </Button>
      )}
      {data.lastSync && (
        <p className="mt-3 text-xs text-muted-foreground">
          Última revisión:{" "}
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
