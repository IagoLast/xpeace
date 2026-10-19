import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "Block por nabo 🫜 — xpeace",
  description:
    "xpeace analiza respuestas y menciones en X. Una respuesta automática indica una detección; el bloqueo depende del acceso de la aplicación a X.",
};

export default function BpnPage() {
  return (
    <div className="workspace">
      <AppHeader showAboutLink={false} />
      <main id="main-content" className="space-y-7 pb-12">
        <div className="intro">
          <h1>
            Block por nabo{" "}
            <span role="img" aria-label="nabo">
              🫜
            </span>
          </h1>
          <p>
            Si has llegado aquí desde una respuesta automática, BPN ha marcado
            tu mensaje como ofensivo. La respuesta y el bloqueo son acciones
            separadas.
          </p>
        </div>
        <section aria-labelledby="what-happened" className="space-y-3">
          <h2 id="what-happened" className="text-base font-semibold">
            ¿Qué ha pasado?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            El usuario al que has respondido utiliza xpeace para filtrar los
            insultos y los malos modos en X. Cuando una respuesta o mención se
            supera el umbral de abuso, BPN responde y solicita el bloqueo. X
            puede rechazar el bloqueo aunque la respuesta se haya publicado.
          </p>
        </section>
        <section
          className="panel activity-panel"
          aria-labelledby="how-it-works"
        >
          <h2 id="how-it-works" className="text-base font-semibold">
            Cómo funciona
          </h2>
          <ol className="mt-5 space-y-4 text-sm leading-relaxed">
            {[
              [
                "Analiza",
                "xpeace evalúa las respuestas y menciones que recibe la cuenta.",
              ],
              [
                "Responde",
                "Si detecta contenido ofensivo, contesta «block por nabo 🫜» con un enlace a esta página.",
              ],
              [
                "Bloquea",
                "El bloqueo automático requiere acceso Enterprise de X. Si no está disponible, el usuario puede bloquear desde X; la respuesta no confirma que ya lo haya hecho.",
              ],
            ].map(([title, description], index) => (
              <li key={title} className="flex gap-3">
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-primary"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <p>
                  <span className="font-medium">{title}.</span>{" "}
                  <span className="text-muted-foreground">{description}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>
        <Link
          href="/"
          className="inline-flex text-sm text-primary underline underline-offset-4"
        >
          Conoce xpeace →
        </Link>
      </main>
    </div>
  );
}
