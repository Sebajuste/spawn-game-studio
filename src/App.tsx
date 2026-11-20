// Point d'entrée de l'app : se connecte au service, puis confie toute la fenêtre à la coque (shell/Shell.tsx).
import { useEffect, useState } from "react";
import { Api, connect } from "./shared/api.ts";
import { t, useLang } from "./i18n/i18n.ts";
import { Shell } from "./shell/Shell.tsx";
import "./styles/base.css";

export default function App() {
  useLang();
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    connect()
      .then((c) => setApi(new Api(c)))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (!api) return <main className="empty">{error ?? t("app.connecting")}</main>;
  return <Shell api={api} />;
}