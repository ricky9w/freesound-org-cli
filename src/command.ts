import {
  runCommand,
  showUsage,
  type CommandDef,
  type ArgsDef,
  type SubCommandsDef,
} from "citty";
import { AppError } from "./core.js";

async function value<T>(
  v: T | Promise<T> | (() => T | Promise<T>) | undefined,
  fallback: T,
): Promise<T> {
  return v === undefined
    ? fallback
    : typeof v === "function"
      ? (v as () => T | Promise<T>)()
      : v;
}
export async function execute(
  root: CommandDef<any>,
  argv: string[],
  name: string,
) {
  const globals = await value<ArgsDef>(root.args, {});
  const tail: string[] = [],
    raw: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "").split("=")[0];
    if (argv[i].startsWith("--") && key in globals) {
      tail.push(argv[i]);
      if (globals[key].type === "string" && !argv[i].includes("=")) {
        if (!argv[i + 1])
          throw new AppError("INVALID_ARGUMENT", `${key} requires a value.`);
        tail.push(argv[++i]);
      }
    } else raw.push(argv[i]);
  }
  raw.push(...tail);
  let cmd = root;
  const names = [name];
  let consumed = 0;
  while (true) {
    const subs = await value<SubCommandsDef>(cmd.subCommands, {});
    const next = subs[raw[consumed]];
    if (!next) break;
    cmd = await value(next, {});
    names.push(raw[consumed++]);
  }
  if (!argv.length || raw.includes("--help") || raw.includes("-h")) {
    await showUsage({
      ...cmd,
      meta: { ...(await value(cmd.meta, {})), name: names.join(" ") },
    });
    return;
  }
  if (cmd.subCommands)
    throw new AppError(
      "COMMAND_REQUIRED",
      "Choose a valid command.",
      `Run ${names.join(" ")} --help.`,
    );
  const defs = await value<ArgsDef>(cmd.args, {});
  const flags = new Map<string, any>();
  let positionals = 0;
  for (const [key, def] of Object.entries(defs)) {
    if (def.type === "positional") positionals++;
    else {
      flags.set(key, def);
      for (const alias of "alias" in def
        ? typeof def.alias === "string"
          ? [def.alias]
          : def.alias || []
        : [])
        flags.set(alias, def);
    }
  }
  let seen = 0;
  for (let i = consumed; i < raw.length; i++) {
    if (raw[i] === "--") {
      seen += raw.length - i - 1;
      break;
    }
    if (!raw[i].startsWith("-")) {
      seen++;
      continue;
    }
    const key = raw[i].replace(/^--?/, "").replace(/^no-/, "").split("=")[0],
      def = flags.get(key);
    if (!def)
      throw new AppError(
        "INVALID_ARGUMENT",
        `Unknown option: ${key}.`,
        `See ${names.join(" ")} --help.`,
      );
    if (def.type !== "boolean" && !raw[i].includes("=")) {
      if (raw[i + 1] === undefined)
        throw new AppError("INVALID_ARGUMENT", `${key} requires a value.`);
      i++;
    }
  }
  if (seen > positionals)
    throw new AppError(
      "INVALID_ARGUMENT",
      "Too many positional arguments.",
      "Quote multiword queries.",
    );
  try {
    await runCommand(cmd, { rawArgs: raw.slice(consumed) });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const code = (e as { code?: string }).code;
    if (code?.startsWith("E_") || code === "EARG")
      throw new AppError(
        "INVALID_ARGUMENT",
        "Invalid or missing arguments.",
        `See ${names.join(" ")} --help.`,
      );
    throw e;
  }
}
