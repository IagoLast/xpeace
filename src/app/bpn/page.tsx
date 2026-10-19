import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Leaf, MessageCircle, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { BPN_REPLY } from "@/lib/domain";

export const metadata: Metadata = {
  title: "Block por nabo 🫜 — xpeace",
  description:
    "¿Has visto un «block por nabo»? Es xpeace: analiza respuestas y menciones, responde a los malos modos y bloquea automáticamente.",
};

export default function BpnPage() {
  return (
    <div className="workspace">
      <AppHeader />
      <main id="main-content" className="space-y-8 pb-10">
        <div className="intro">
          <p className="mb-4 text-sm text-primary!">Menos ruido. Más paz.</p>
          <h1>
            Block por nabo{" "}
            <span role="img" aria-label="nabo">
              🫜
            </span>
          </h1>
          <p>
            Internet ya tiene suficientes discusiones. No tienes que participar
            en todas.
          </p>
        </div>
        <div className="panel activity-panel">
          <p className="text-xs text-muted-foreground">
            ¿Has llegado desde una respuesta como esta?
          </p>
          <p className="mt-4 text-2xl font-medium tracking-tight">
            {BPN_REPLY}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Es xpeace. Una herramienta que cuida tus conversaciones en X y pone
            límites a los insultos y los malos modos.
          </p>
        </div>
        <section aria-labelledby="how-it-works" className="space-y-6">
          <h2 id="how-it-works" className="text-lg font-semibold">
            Así de sencillo
          </h2>
          {[
            {
              icon: MessageCircle,
              title: "Lee las respuestas y menciones",
              text: "BPN analiza las nuevas interacciones dirigidas a tu cuenta.",
            },
            {
              icon: ShieldCheck,
              title: "Si alguien se pasa, actúa",
              text: "Responde «block por nabo 🫜» con un enlace a esta página y bloquea al autor automáticamente.",
            },
            {
              icon: Leaf,
              title: "Tú sigues a lo tuyo",
              text: "Consulta el historial cuando quieras. Puedes pausar BPN desde tu cuenta.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-4">
              <Icon
                className="mt-1 size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {text}
                </p>
              </div>
            </div>
          ))}
        </section>
        <div className="border-t pt-7">
          <h2 className="text-lg font-semibold">
            Un poco más de paz para tu X.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicia sesión, suscríbete y activa BPN. Puedes cancelar desde tu
            cuenta.
          </p>
          <Button asChild className="mt-5">
            <Link href="/">
              Quiero xpeace
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </main>
      <footer className="app-footer">Tu cuenta, tus límites.</footer>
    </div>
  );
}
