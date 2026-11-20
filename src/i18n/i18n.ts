// Langue de l'interface : l'anglais par défaut, le français proposé (menu Affichage > Langue). Les textes vivent dans
// `locales/<langue>.ts` ; l'anglais est la source des clés, et `Messages` oblige chaque autre langue à les avoir
// toutes (le typecheck échoue sinon). Le choix est gardé dans localStorage et change toute la fenêtre à la fois.
import { useSyncExternalStore } from "react";
import { en } from "./locales/en.ts";
import { fr } from "./locales/fr.ts";

export type Messages = typeof en;
export type Key = keyof Messages;
export type Lang = "en" | "fr";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

const KEY = "spawn.lang";
const catalogs: Record<Lang, Messages> = { en, fr };
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === "fr" || v === "en" ? v : "en";
  } catch {
    return "en";
  }
}

let current: Lang = read();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // stockage indisponible : le choix vaut pour la session
  }
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// À appeler dans le composant racine : il se redessine au changement de langue, et ses enfants avec lui.
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang);

// `{nom}` dans un message est remplacé par la valeur du même nom.
export function t(key: Key, params?: Record<string, string | number>): string {
  const text = catalogs[current][key];
  return params ? text.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m)) : text;
}
