// Hook git commit-msg : `node commit-msg.ts <fichier du message>`.
import { readFileSync } from "node:fs";
import { aiAttribution } from "./attribution.ts";

const file = process.argv[2];
if (!file) {
  process.stderr.write("commit-msg : fichier du message attendu\n");
  process.exit(1);
}
const reason = aiAttribution(readFileSync(file, "utf8"));
if (reason) {
  process.stderr.write(`commit refusé : ${reason}. Aucune attribution IA dans les commits (seul auteur : le propriétaire du dépôt).\n`);
  process.exit(1);
}
