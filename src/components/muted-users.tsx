"use client";

import { useState } from "react";
import { ArrowUpRight, RefreshCw, Volume2, VolumeX } from "lucide-react";
import type { MutedPage } from "@/lib/domain";
import type { DashboardApi } from "./dashboard";
import { Button } from "./ui/button";

export function MutedUsersPanel({ data, busy, act }: DashboardApi) {
  const [page, setPage] = useState<MutedPage | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unmutingId, setUnmutingId] = useState<string | null>(null);
  const [unmuteFailed, setUnmuteFailed] = useState<string | null>(null);
  const available =
    data.billing.active &&
    data.billing.used.xRequests < data.billing.limits.xRequests &&
    data.billing.used.xCredits < data.billing.limits.xCredits;

  async function load(cursor?: string) {
    if (busy || loading || unmutingId) return;
    setLoading(true);
    setFailed(false);
    const result = await act({
      action: "mutes",
      ...(cursor ? { cursor } : {}),
    });
    if (result) {
      setUnmuteFailed(null);
      const next = result as unknown as MutedPage;
      setPage((previous) => ({
        users:
          cursor && previous
            ? [
                ...new Map(
                  [...previous.users, ...next.users].map((user) => [
                    user.id,
                    user,
                  ]),
                ).values(),
              ]
            : next.users,
        nextCursor: next.nextCursor,
      }));
      setLoadedAt(
        new Date().toLocaleTimeString("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } else {
      setFailed(true);
    }
    setLoading(false);
  }

  async function unmute(user: MutedPage["users"][number]) {
    if (busy || loading || unmutingId) return;
    setUnmutingId(user.id);
    setUnmuteFailed(null);
    const result = await act(
      { action: "unmute", userId: user.id },
      `Has dejado de silenciar a @${user.username}`,
    );
    if (result?.ok === true) {
      setPage((previous) =>
        previous
          ? {
              ...previous,
              users: previous.users.filter((item) => item.id !== user.id),
            }
          : previous,
      );
    } else {
      setUnmuteFailed(user.username);
    }
    setUnmutingId(null);
  }

  return (
    <section
      className="panel activity-panel"
      id="muted-users"
      aria-labelledby="muted-users-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="muted-users-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <VolumeX className="size-5 text-primary" aria-hidden="true" />
          Usuarios silenciados
        </h2>
        {data.muteAccess.read && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || loading || !!unmutingId || !available}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading
              ? "Consultando…"
              : page
                ? "Actualizar lista"
                : "Ver silenciados"}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Las cuentas que tienes silenciadas en X, incluidas las silenciadas fuera
        de BPN. La lista se consulta solo cuando la pides y consume cupo de X.
      </p>
      {!data.muteAccess.read ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Reconecta X en el panel de BPN para consultar la lista.
        </p>
      ) : (
        !available && (
          <p className="mt-4 text-sm text-muted-foreground">
            Necesitas una suscripción activa y cupo disponible para consultar X.
          </p>
        )
      )}
      {data.muteAccess.read && !data.muteAccess.write && (
        <p className="mt-4 text-sm text-muted-foreground">
          Reconecta X en el panel de BPN para poder dejar de silenciar usuarios.
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          No se pudo actualizar la lista.{" "}
          {page
            ? "Se conservan los últimos resultados; puedes volver a intentarlo."
            : "Puedes volver a intentarlo."}
        </p>
      )}
      {unmuteFailed && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          No se ha podido confirmar el cambio para @{unmuteFailed}. Actualiza la
          lista para comprobar su estado o vuelve a intentarlo.
        </p>
      )}
      {page && (
        <div
          className="mt-4"
          aria-live="polite"
          aria-busy={loading || !!unmutingId}
        >
          {!page.users.length && !page.nextCursor ? (
            <p className="py-4 text-sm text-muted-foreground">
              No tienes usuarios silenciados en X.
            </p>
          ) : (
            <ul className="divide-y">
              {page.users.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      @{user.username}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <a
                      href={`https://x.com/${user.username}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Ver perfil de ${user.username} en X`}
                      className="inline-flex items-center gap-1 text-xs text-primary"
                    >
                      Ver en X <ArrowUpRight className="size-3" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Dejar de silenciar a @${user.username}`}
                      disabled={
                        busy ||
                        loading ||
                        !!unmutingId ||
                        !available ||
                        !data.muteAccess.write
                      }
                      onClick={() => void unmute(user)}
                    >
                      {unmutingId === user.id ? (
                        <RefreshCw className="animate-spin" />
                      ) : (
                        <Volume2 />
                      )}
                      {unmutingId === user.id
                        ? "Quitando silencio…"
                        : "Dejar de silenciar"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {page.users.length}{" "}
            {page.nextCursor
              ? "cuentas cargadas; hay más resultados"
              : "cuentas en la lista"}
            . Consultada a las {loadedAt}.
          </p>
          {page.nextCursor && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy || loading || !!unmutingId || !available}
              onClick={() => void load(page.nextCursor!)}
            >
              Cargar más silenciados
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
