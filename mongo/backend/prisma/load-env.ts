import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});
