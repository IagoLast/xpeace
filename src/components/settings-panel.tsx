"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { BPN_REPLY } from "@/lib/domain";
import type { DashboardApi } from "./dashboard";

export function BpnPanel({ data, busy, act }: DashboardApi) {
  const active = data.settings.enabled && data.billing.active;
  return (
    <Card className="panel bpn-panel">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Block por nabo</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${active ? "bg-primary" : "bg-muted-foreground"}`}
          />
          {active ? "Activo" : "En pausa"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Analiza las respuestas a tus tweets y tus menciones. Si alguien se pasa,
        responde y solicita el bloqueo.
      </p>
      <p className="notice mt-4 text-sm">
        X exige acceso Enterprise para bloquear desde una aplicación. Si X
        rechaza el bloqueo, verás el motivo y un enlace al perfil para hacerlo
        manualmente. Una respuesta enviada no confirma un bloqueo.
      </p>
      <div className="reply-preview mt-5">
        <p className="text-sm font-medium">{BPN_REPLY}</p>
        <Link
          href="/bpn"
          className="mt-1 inline-block text-xs text-primary underline underline-offset-4"
        >
          Conoce xpeace →
        </Link>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada respuesta incluye un enlace al proyecto.
        </p>
      </div>
      <div className="setting-row border-0 pb-0!">
        <div>
          <Label htmlFor="bpn-enabled">Activar BPN</Label>
          <p>
            {data.billing.active
              ? "Tú sigues a lo tuyo. BPN se encarga."
              : "Suscríbete para activar la protección."}
          </p>
        </div>
        <Switch
          id="bpn-enabled"
          checked={data.settings.enabled}
          disabled={busy || (!data.billing.active && !data.settings.enabled)}
          onCheckedChange={(enabled) =>
            void act(
              {
                action: "settings",
                settings: { ...data.settings, enabled },
              },
              enabled ? "BPN activado" : "BPN en pausa",
            )
          }
        />
      </div>
      <BpnThreshold
        key={data.settings.threshold}
        data={data}
        busy={busy}
        act={act}
      />
    </Card>
  );
}

function BpnThreshold({ data, busy, act }: DashboardApi) {
  const saved = Math.round(data.settings.threshold * 100);
  const [percentage, setPercentage] = useState(saved);
  const sensitivity =
    percentage >= 90 ? "Baja" : percentage >= 75 ? "Media" : "Alta";
  const disabled = busy || (data.settings.enabled && !data.billing.active);
  return (
    <form
      className="mt-5 border-t pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || percentage === saved) return;
        void act(
          {
            action: "settings",
            settings: { ...data.settings, threshold: percentage / 100 },
          },
          "Sensibilidad guardada",
        );
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="bpn-sensitivity">Sensibilidad de BPN</Label>
        <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary">
          {sensitivity}
        </span>
      </div>
      <input
        id="bpn-sensitivity"
        type="range"
        min={0}
        max={39}
        step={1}
        value={99 - percentage}
        onChange={(event) => setPercentage(99 - Number(event.target.value))}
        disabled={disabled}
        aria-valuetext={`${sensitivity}; umbral de bloqueo ${percentage} %`}
        aria-describedby="bpn-sensitivity-help bpn-sensitivity-scope"
        className="mt-3 h-8 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div
        className="flex justify-between text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span>Menos sensible</span>
        <span>Más sensible</span>
      </div>
      <p
        id="bpn-sensitivity-help"
        className="mt-4 text-sm leading-relaxed text-muted-foreground"
      >
        Responde y bloquea a partir de un{" "}
        <output
          htmlFor="bpn-sensitivity"
          className="font-semibold tabular-nums text-foreground"
        >
          {percentage} %
        </output>{" "}
        de probabilidad de abuso. Más sensibilidad hace que actúe ante más
        mensajes.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={disabled || percentage === saved}
        >
          Guardar sensibilidad
        </Button>
        {percentage !== saved && (
          <span className="text-xs text-muted-foreground">
            Cambios sin guardar
          </span>
        )}
      </div>
      <p
        id="bpn-sensitivity-scope"
        className="mt-3 text-xs leading-relaxed text-muted-foreground"
      >
        Se aplica a los mensajes pendientes y nuevos. No vuelve a procesar el
        historial.
      </p>
    </form>
  );
}

export function ConnectionPanel({ data, busy, act }: DashboardApi) {
  return (
    <div className="connected-account">
      <div className="flex min-w-0 items-center gap-3">
        <span className="account-avatar">
          {data.account.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            @{data.account.username}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3" />
            Sesión iniciada
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        disabled={busy}
        onClick={() => void act({ action: "logout" })}
      >
        <LogOut className="size-3.5" />
        Cerrar sesión
      </Button>
    </div>
  );
}

export function ConnectAccount({ missing }: { missing: string[] }) {
  return (
    <Card className="panel connect-panel">
      <div className="connection-mark" aria-hidden="true">
        𝕏
      </div>
      <h2 className="mt-5 text-lg font-semibold">
        Tu tranquilidad empieza aquí
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Inicia sesión con X y suscríbete para que BPN se encargue de los malos
        modos.
      </p>
      {missing.length ? (
        <Button className="mt-6" disabled>
          Inicio de sesión no disponible
        </Button>
      ) : (
        <Button asChild className="mt-6">
          <a href="/api/auth/x">
            Iniciar sesión con X<ArrowRight />
          </a>
        </Button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Suscríbete y cancela cuando quieras desde tu cuenta.
      </p>
      {!!missing.length && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estamos preparando la conexión. Vuelve en unos instantes.
        </p>
      )}
    </Card>
  );
}
