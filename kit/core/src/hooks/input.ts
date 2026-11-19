// Lecture de l'entrée JSON d'un hook Claude Code sur stdin.
export async function readInput<T>(): Promise<T> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk as string;
  return JSON.parse(text) as T;
}

export function fail(message: string, code = 1): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}
