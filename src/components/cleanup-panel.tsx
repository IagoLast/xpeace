"use client";
import { useState } from "react";
import { Check, CircleCheck, Eye, Loader2, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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
import { cn } from "@/lib/utils";
import { ALL_HISTORY_BEFORE, type Kind } from "@/lib/domain";
import type { DashboardApi } from "./dashboard";

const kinds: { id: Kind; label: string }[] = [
  { id: "tweets", label: "Tweets" },
  { id: "likes", label: "Likes" },
  { id: "replies", label: "Respuestas" },
];
const statuses = {
  scanning: "Preparando vista previa",
  ready: "Lista para revisar",
  running: "Limpieza en curso",
  completed: "Limpieza terminada",
  cancelled: "Cancelada",
  error: "Revisar error",
};

export function CleanupPanel({ data, busy, act }: DashboardApi) {
  const [selected, setSelected] = useState<Kind[]>([
    "tweets",
    "likes",
    "replies",
  ]);
  const [scope, setScope] = useState("all");
  const [before, setBefore] = useState("2025-01-01");
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const job = data.jobs[0];
  const active = !!job && ["scanning", "ready", "running"].includes(job.status);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">Qué quieres limpiar</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {kinds.map(({ id, label }) => (
            <Button
              key={id}
              variant="outline"
              disabled={active || busy}
              className={cn(
                selected.includes(id) &&
                  "border-primary/50 bg-primary/10 text-primary",
              )}
              aria-pressed={selected.includes(id)}
              onClick={() =>
                setSelected((current) =>
                  current.includes(id)
                    ? current.filter((k) => k !== id)
                    : [...current, id],
                )
              }
            >
              {selected.includes(id) && <Check />}
              {label}
            </Button>
          ))}
        </div>
      </div>
      <fieldset disabled={active || busy} className="space-y-3">
        <legend className="text-sm font-medium">Qué período</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="cleanup-scope"
            value="all"
            checked={scope === "all"}
            onChange={() => setScope("all")}
            className="accent-primary"
          />
          Todo el historial
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="cleanup-scope"
            value="before"
            checked={scope === "before"}
            onChange={() => setScope("before")}
            className="accent-primary"
          />
          Antes de una fecha
        </label>
        {scope === "before" && (
          <div>
            <Label htmlFor="before">Publicados antes del</Label>
            <Input
              type="date"
              id="before"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
              className="mt-2 max-w-xs"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              También para likes: cuenta la fecha del post. El día elegido queda
              fuera (UTC).
            </p>
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={
            busy ||
            active ||
            !selected.length ||
            (scope === "before" && !before) ||
            !data.billing.active ||
            data.billing.used.xRequests >= data.billing.limits.xRequests ||
            data.billing.limits.xCredits - data.billing.used.xCredits < 5
          }
          onClick={() =>
            void act(
              {
                action: "preview",
                kinds: selected,
                before: scope === "all" ? ALL_HISTORY_BEFORE : before,
              },
              "Vista previa preparada",
            )
          }
        >
          <Eye />
          Preparar vista previa
        </Button>
        <span className="text-xs text-muted-foreground">
          Revisas antes de borrar.
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Solo se incluye el historial accesible a través de X. No incluye reposts
        ni importa el archivo completo de tu cuenta.
      </p>
      {job && (
        <div className="border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{statuses[job.status]}</h3>
            </div>
            <Badge
              variant="outline"
              className={job.status === "completed" ? "status-green" : ""}
            >
              {job.total} elementos
            </Badge>
          </div>
          {job.error && (
            <p className="notice notice-error mt-3" role="alert">
              {job.error}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {job.scanned} publicaciones revisadas · {job.done} eliminadas ·{" "}
            {job.failed} con error
          </p>
          {["scanning", "running"].includes(job.status) && (
            <div className="mt-5">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-all",
                    job.status === "scanning" && "animate-pulse",
                  )}
                  style={{
                    width: `${job.status === "scanning" ? 30 : job.total ? ((job.done + job.failed) / job.total) * 100 : 100}%`,
                  }}
                />
              </div>
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                El progreso se guarda entre ejecuciones.
              </p>
            </div>
          )}
          {job.status === "completed" && (
            <div className="mt-5 flex items-center gap-3 rounded-lg bg-primary/5 p-4">
              <CircleCheck className="size-5 text-primary" />
              <p className="text-sm">
                {job.failed
                  ? `Proceso terminado con ${job.failed} errores. Crea otra vista previa para reintentar.`
                  : "La limpieza ha terminado."}
              </p>
            </div>
          )}
          {job.status === "ready" && (
            <>
              <div className="my-5 divide-y rounded-lg border">
                {data.preview.length ? (
                  data.preview.map((p) => (
                    <div
                      key={`${p.kind}-${p.id}`}
                      className="flex items-start gap-3 p-3"
                    >
                      <Badge
                        variant="secondary"
                        className="mt-0.5 shrink-0 text-xs"
                      >
                        {kinds.find((k) => k.id === p.kind)?.label}
                      </Badge>
                      <div>
                        <p className="text-sm leading-relaxed">{p.text}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString("es-ES", {
                            timeZone: "UTC",
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">
                    No hay elementos que coincidan con estos filtros.
                  </p>
                )}
              </div>
              {job.total > data.preview.length && (
                <p className="mb-4 text-xs text-muted-foreground">
                  Mostrando {data.preview.length} de {job.total} elementos.
                </p>
              )}
              <AlertDialog
                open={open}
                onOpenChange={(value) => {
                  setOpen(value);
                  setConfirmation("");
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={
                      !job.total ||
                      busy ||
                      !data.billing.active ||
                      data.billing.used.cleanup >=
                        data.billing.limits.cleanup ||
                      data.billing.used.xRequests >=
                        data.billing.limits.xRequests ||
                      data.billing.limits.xCredits -
                        data.billing.used.xCredits <
                        2
                    }
                  >
                    <Trash2 />
                    Eliminar elementos
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {`Eliminar ${job.total} elementos`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borrarán los tweets y respuestas de esta vista previa y
                      se retirarán los likes seleccionados. Los posts eliminados
                      no se pueden recuperar. Escribe BORRAR para continuar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Label htmlFor="confirmation" className="sr-only">
                    Confirmación
                  </Label>
                  <Input
                    id="confirmation"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="BORRAR"
                    autoComplete="off"
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Volver</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      disabled={
                        confirmation !== "BORRAR" ||
                        busy ||
                        !data.billing.active
                      }
                      onClick={async () => {
                        const result = await act(
                          { action: "confirm", id: job.id, confirmation },
                          "Limpieza iniciada",
                        );
                        if (result) setOpen(false);
                      }}
                    >
                      Confirmar limpieza
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 ml-2 text-muted-foreground"
              disabled={busy}
              onClick={() =>
                void act({ action: "cancel", id: job.id }, "Limpieza cancelada")
              }
            >
              Cancelar {job.status === "ready" ? "vista previa" : "proceso"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
