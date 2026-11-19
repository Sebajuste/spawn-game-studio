// Connexion au service de l'app : fournie par Tauri (commande « service »), ou par l'URL en développement
// (`http://localhost:1420/?port=…&token=…`, valeurs imprimées par `node service/src/main.ts`).
import type {
  AgentEvent,
  AgentName,
  ConversationEnd,
  ConversationEvent,
  ConversationTurn,
  ConversationView,
  KnownEngine,
  ModuleState,
  ProgressStep,
  ProjectSettings,
  ProjectView,
  StoryCapture,
  StoryDetail,
  StoryFiles,
  StoryGroup,
  StoryStateDetail,
  StoryView,
  TouchedFile,
} from "../service/src/contract.ts";

export type {
  AgentEvent,
  AgentName,
  ConversationEnd,
  ConversationEvent,
  ConversationTurn,
  ConversationView,
  KnownEngine,
  ModuleState,
  ProgressStep,
  ProjectSettings,
  ProjectView,
  StoryCapture,
  StoryDetail,
  StoryFiles,
  StoryGroup,
  StoryStateDetail,
  StoryView,
  TouchedFile,
};

export const inTauri = () => "__TAURI_INTERNALS__" in window;

// Sélecteur de dossier de Windows (Tauri) ; null hors de Tauri ou si l'utilisateur annule.
export async function pickFolder(title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const choice = await open({ directory: true, multiple: false, title });
  return typeof choice === "string" ? choice : null;
}

export interface Connection {
  port: number;
  token: string;
}

export async function connect(): Promise<Connection> {
  const url = new URLSearchParams(window.location.search);
  const port = Number(url.get("port"));
  const token = url.get("token");
  if (port && token) return { port, token };
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Connection>("service");
  }
  throw new Error("service introuvable : lancer l'app par Tauri, ou ouvrir cette page avec ?port=…&token=… (sortie de node service/src/main.ts)");
}

export class Api {
  private readonly base: string;
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
    this.base = `http://127.0.0.1:${connection.port}`;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.connection.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await r.json()) as T & { error?: string };
    if (!r.ok) throw new Error(data.error ?? `erreur ${r.status}`);
    return data;
  }

  // Adresse d'un fichier du projet, pour <img>, <video>, <audio> (qui n'envoient pas d'en-tête : jeton dans l'URL).
  fileUrl(project: string, access: string): string {
    return `${this.base}/api/projects/${encodeURIComponent(project)}/file?path=${encodeURIComponent(access)}&token=${encodeURIComponent(this.connection.token)}`;
  }

  async text(project: string, access: string): Promise<string> {
    const r = await fetch(this.fileUrl(project, access));
    if (!r.ok) throw new Error(`lecture impossible (${r.status})`);
    return r.text();
  }

  events(): EventSource {
    return new EventSource(`${this.base}/api/events?token=${encodeURIComponent(this.connection.token)}`);
  }
}
