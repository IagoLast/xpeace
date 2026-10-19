"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-content-center gap-5 p-8 text-center">
      <h1 className="text-2xl font-semibold">No pudimos abrir tu espacio</h1>
      <p className="text-muted-foreground">
        Comprueba la conexión y la configuración de la base de datos.
      </p>
      <Button onClick={reset}>Volver a intentar</Button>
    </main>
  );
}
