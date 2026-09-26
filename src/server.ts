// Process entry point: the imperative shell. It validates the environment
// before anything else runs and stops the process if the configuration is
// invalid.
import { describeEnvError, parseEnv } from "./config/env.ts";

const env = parseEnv(process.env);

if (!env.ok) {
  process.stderr.write(`${describeEnvError(env.error)}\n`);
  process.exit(1);
}
