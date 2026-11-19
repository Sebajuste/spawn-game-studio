import { main } from "./fake.ts";

process.exitCode = main(process.argv.slice(2), { liar: true });
