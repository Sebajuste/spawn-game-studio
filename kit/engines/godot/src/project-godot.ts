// Lecture et complément du texte de `project.godot`, sans accès disque.

// Valeur brute (après `=`) de `key` dans la section `[section]` ; `null` si absente.
export function readSetting(text: string, section: string, key: string): string | null {
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const title = /^\[([^\]]+)\]$/.exec(line);
    if (title !== null) {
      current = title[1] ?? "";
      continue;
    }
    if (current !== section) continue;
    const equals = line.indexOf("=");
    if (equals > 0 && line.slice(0, equals).trim() === key) return line.slice(equals + 1).trim();
  }
  return null;
}

// Chaînes d'un `PackedStringArray("a", "b")` ou d'une chaîne seule `"a"`.
export function quotedStrings(value: string): string[] {
  return [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? "").replace(/\\(.)/g, "$1"));
}

// `config/features=PackedStringArray("4.7", "Forward Plus")` → "4.7" : la première entrée qui est un numéro.
export function readVersion(text: string): string | null {
  const features = readSetting(text, "application", "config/features");
  if (features === null) return null;
  return quotedStrings(features).find((f) => /^\d+(\.\d+)*$/.test(f)) ?? null;
}

export function readName(text: string): string | null {
  const value = readSetting(text, "application", "config/name");
  return value === null ? null : (quotedStrings(value)[0] ?? null);
}

function escape(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function enabledLine(plugins: readonly string[]): string {
  return `enabled=PackedStringArray(${plugins.map((p) => `"${escape(p)}"`).join(", ")})`;
}

// Active `plugin` dans `[editor_plugins]` en gardant les greffons déjà listés ; rend le même texte s'il l'est déjà.
// Les fins de ligne du fichier sont gardées : un projet en CRLF reste en CRLF.
export function enablePlugin(text: string, plugin: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => l.trim() === "[editor_plugins]");
  if (header < 0) {
    const base = text === "" || text.endsWith(eol) ? text : text + eol;
    const separator = base === "" || base.endsWith(eol + eol) ? "" : eol;
    return `${base}${separator}[editor_plugins]${eol}${eol}${enabledLine([plugin])}${eol}`;
  }
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i++) {
    if (/^\[[^\]]+\]$/.test((lines[i] ?? "").trim())) {
      end = i;
      break;
    }
  }
  for (let i = header + 1; i < end; i++) {
    const m = /^\s*enabled\s*=(.*)$/.exec(lines[i] ?? "");
    if (m === null) continue;
    const plugins = quotedStrings(m[1] ?? "");
    if (plugins.includes(plugin)) return text;
    lines[i] = enabledLine([...plugins, plugin]);
    return lines.join(eol);
  }
  const at = lines[header + 1]?.trim() === "" ? header + 2 : header + 1;
  lines.splice(at, 0, enabledLine([plugin]));
  return lines.join(eol);
}
