import "server-only";
import { ZodError } from "zod";
import { HttpError } from "./auth";
import { BusyError } from "./db";
import { XError } from "./x";
import { BillingError } from "./billing-access";

export function apiError(error: unknown) {
  const status =
    error instanceof HttpError ||
    error instanceof XError ||
    error instanceof BillingError
      ? error.status
      : error instanceof BusyError
        ? 409
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 500;
  const message =
    error instanceof HttpError ||
    error instanceof XError ||
    error instanceof BillingError ||
    error instanceof BusyError
      ? error.message
      : status === 400
        ? "Revisa los datos enviados."
        : "No se pudo completar la operación. Comprueba la configuración del servidor.";
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
