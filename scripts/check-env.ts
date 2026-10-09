// `pnpm env:check`: the configuration check the server runs at start, run
// first in the Vercel build so a misconfigured deploy fails before it ships.
import { checkEnv, describeEnvErrors } from "../src/lib/server/env";

const { errors, warnings } = checkEnv();
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(describeEnvErrors(errors));
  process.exit(1);
}
console.log("Configuration OK.");
