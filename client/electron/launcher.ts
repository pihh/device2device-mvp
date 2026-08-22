import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const electronPath =
  process.platform === "win32"
    ? path.join(
        __dirname,
        "..",
        "node_modules",
        "electron",
        "dist",
        "electron.exe"
      )
    : path.join(
        __dirname,
        "..",
        "node_modules",
        "electron",
        "dist",
        "electron"
      );

const mainPath = path.join(
  __dirname,
  "main.ts"
);

const child = spawn(
  electronPath,
  [mainPath],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined
    }
  }
);

child.on("exit", code => {
  process.exit(code ?? 0);
});