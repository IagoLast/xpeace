import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "Block por nabo 🫜 — xpeace",
  description:
    "Este usuario utiliza xpeace. Tu respuesta se ha detectado como ofensiva y se te ha bloqueado automáticamente.",
};

export default function BpnPage() {
  return (
    <div className="workspace">
      <AppHeader showAboutLink={false} />
      <main id="main-content" className="intro">
        <h1>
          Block por nabo{" "}
          <span role="img" aria-label="nabo">
            🫜
          </span>
        </h1>
        <p>El usuario al que has respondido utiliza xpeace.</p>
        <p>
          Tu respuesta se ha detectado como ofensiva, así que se te ha bloqueado
          automáticamente.
        </p>
      </main>
    </div>
  );
}
