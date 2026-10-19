"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import {
  BPN_REPLY,
  settingsSchema,
  type Decision,
  type Settings,
} from "@/lib/domain";
import type { DashboardApi } from "./dashboard";

export function BpnPanel({ data, busy, act }: DashboardApi) {
  // Keep unsaved edits through background refreshes; otherwise use the latest saved settings.
  const [draft, setDraft] = useState<Settings | null>(null);
  const settings = draft ?? data.settings;
  const [allowlist, setAllowlist] = useState<string | null>(null);
  const [text, setText] = useState("ERES GILIPOLLAS");
  const [result, setResult] = useState<Decision | null>(null);
  const dirty =
    (draft !== null &&
      JSON.stringify(draft) !== JSON.stringify(data.settings)) ||
    (allowlist !== null && allowlist !== data.settings.allowlist.join(", "));
  function change(patch: Partial<Settings>) {
    setDraft({ ...settings, ...patch });
  }
  async function save() {
    const parsed = settingsSchema.safeParse({
      ...settings,
      allowlist: (allowlist ?? data.settings.allowlist.join(", "))
        .split(/[\s,]+/)
        .map((u) => u.replace(/^@/, ""))
        .filter(Boolean),
    });
    if (!parsed.success) {
      toast.error(
        "Usa nombres de X válidos separados por comas (hasta 100 usuarios).",
      );
      return;
    }
    const response = await act(
      { action: "settings", settings: parsed.data },
      "Configuración guardada",
    );
    if (response) {
      setDraft(null);
      setAllowlist(null);
    }
  }
  return (
    <Card className="panel bpn-panel">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-primary" />
        <h2 className="text-base font-semibold">Block por nabo</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${data.settings.enabled ? "bg-primary" : "bg-muted-foreground"}`}
          />
          {data.settings.enabled ? "Activo" : "En pausa"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        JEV detecta insultos y malos modos. BPN responde «{BPN_REPLY}»
        {settings.block ? " y bloquea al autor." : "."}
      </p>
      <div className="setting-row">
        <div>
          <Label htmlFor="bpn-enabled">Activar BPN</Label>
          <p>Revisar nuevas menciones y respuestas.</p>
        </div>
        <Switch
          id="bpn-enabled"
          checked={settings.enabled}
          disabled={busy || !data.billing.active}
          onCheckedChange={(enabled) => change({ enabled })}
        />
      </div>
      <div className="setting-row">
        <div>
          <Label htmlFor="bpn-review">Revisar antes de responder</Label>
          <p>
            {settings.mode === "review"
              ? "Tú decides qué respuestas enviar."
              : "BPN responde automáticamente a las respuestas directas."}
          </p>
        </div>
        <Switch
          id="bpn-review"
          checked={settings.mode === "review"}
          disabled={busy}
          onCheckedChange={(review) =>
            change({ mode: review ? "review" : "automatic" })
          }
        />
      </div>
      {settings.mode === "automatic" && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Las respuestas automáticas con IA requieren aprobación previa de X.
          Las menciones quedan en revisión.{" "}
          <a
            href="https://help.x.com/en/rules-and-policies/x-automation"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Ver requisitos
          </a>
          .
        </p>
      )}
      <details className="disclosure advanced">
        <summary>
          <span>Opciones avanzadas</span>
          <ChevronDown className="disclosure-chevron" />
        </summary>
        <div className="space-y-6 pt-2 pb-4">
          <div className="setting-row border-0 pt-0!">
            <div>
              <Label htmlFor="block-user">Bloquear después de responder</Label>
              <p>Si lo desactivas, solo se enviará la respuesta.</p>
            </div>
            <Switch
              id="block-user"
              checked={settings.block}
              disabled={busy}
              onCheckedChange={(block) => change({ block })}
            />
          </div>
          <div>
            <Label htmlFor="threshold">
              Confianza mínima: {Math.round(settings.threshold * 100)}%
            </Label>
            <Slider
              id="threshold"
              aria-label="Confianza mínima"
              className="mt-4"
              value={[Math.round(settings.threshold * 100)]}
              min={60}
              max={99}
              step={1}
              disabled={busy}
              onValueChange={([value]) => change({ threshold: value / 100 })}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Un valor alto reduce los falsos positivos. Por defecto: 90%.
            </p>
          </div>
          <div>
            <Label htmlFor="allowlist">Usuarios excluidos</Label>
            <Input
              id="allowlist"
              className="mt-2"
              placeholder="@amigo, @otra_cuenta"
              value={allowlist ?? data.settings.allowlist.join(", ")}
              disabled={busy}
              onChange={(event) => setAllowlist(event.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              BPN no actuará sobre estas cuentas.
            </p>
          </div>
          <div className="border-t pt-5">
            <Label htmlFor="test-text">Probar una frase</Label>
            <Textarea
              id="test-text"
              className="mt-2 min-h-20 resize-y"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy ||
                  !text.trim() ||
                  !data.billing.active ||
                  data.billing.used.analyses >= data.billing.limits.analyses
                }
                onClick={async () => {
                  setResult(null);
                  const response = await act({ action: "test", text });
                  if (response?.decision) setResult(response.decision);
                }}
              >
                {busy && <Loader2 className="animate-spin" />}
                Evaluar con JEV
              </Button>
              <span className="text-xs text-muted-foreground">
                Solo prueba. No envía nada.
              </span>
            </div>
            {result && (
              <p className="mt-3 text-sm text-primary" role="status">
                {result.optOut >= 0.5
                  ? "Petición de baja: no responder"
                  : result.abuse >= settings.threshold
                    ? "BPN detectado"
                    : "Una conversación sin problema"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {Math.round(result.abuse * 100)}% de abuso
                </span>
              </p>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Máximo 25 respuestas al día y una por usuario cada 24 horas. «STOP»
            o «no me respondas» excluyen al autor. Informa de esta opción en tu
            perfil.
          </p>
        </div>
      </details>
      <div className="save-row">
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {dirty ? (
            "Cambios sin guardar"
          ) : (
            <>
              <Check className="size-3.5" />
              Todo guardado
            </>
          )}
        </span>
        <Button disabled={busy || !dirty} onClick={() => void save()}>
          {busy && <Loader2 className="animate-spin" />}Guardar cambios
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Revisión diaria. Puedes actualizar manualmente en Actividad.
      </p>
    </Card>
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
            Cuenta conectada
          </p>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            Desconectar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar tu cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se detendrá BPN, se cancelarán las limpiezas pendientes y se
              eliminarán las credenciales guardadas. El registro de actividad se
              conservará. Desconectar X no cancela tu suscripción; puedes
              cancelarla antes desde «Gestionar suscripción».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void act({ action: "disconnect" })}
            >
              Desconectar cuenta
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        Empieza por conectar tu cuenta
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Filtra los malos modos con BPN y limpia tu historial cuando quieras.
      </p>
      {missing.length ? (
        <Button className="mt-6" disabled>
          Conexión pendiente de configurar
        </Button>
      ) : (
        <Button asChild className="mt-6">
          <a href="/api/auth/x">
            Conectar X<ArrowRight />
          </a>
        </Button>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Después podrás contratar tu plan mensual para activar el servicio.
      </p>
      {!!missing.length && (
        <details className="mt-4 w-full text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Ver configuración pendiente
          </summary>
          <p className="mt-2 break-words">
            Falta configurar: {missing.join(", ")}.
          </p>
        </details>
      )}
    </Card>
  );
}
