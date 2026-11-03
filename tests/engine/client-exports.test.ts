import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, test } from "vitest";
import { readRepoFile } from "../support/repo.ts";
import { wasm } from "../support/speed-dreams.ts";

const declarations = "apps/client/src/game/speed-dreams.d.ts";

interface Contract {
  functions: string[];
  objects: string[];
}

function cwrapTarget(member: ts.MethodSignature): string | null {
  const first = member.parameters[0]?.type;
  return first &&
    ts.isLiteralTypeNode(first) &&
    ts.isStringLiteral(first.literal)
    ? `_${first.literal.text}`
    : null;
}

function isCallable(member: ts.TypeElement): boolean {
  return (
    ts.isMethodSignature(member) ||
    (ts.isPropertySignature(member) &&
      member.type !== undefined &&
      ts.isFunctionTypeNode(member.type))
  );
}

function moduleInterface(node: ts.Node): ts.InterfaceDeclaration | undefined {
  if (ts.isInterfaceDeclaration(node) && node.name.text === "SpeedDreamsModule")
    return node;
  return ts.forEachChild(node, moduleInterface);
}

function clientContract(): Contract {
  const source = ts.createSourceFile(
    declarations,
    readRepoFile(declarations),
    ts.ScriptTarget.Latest,
  );
  const functions = new Set<string>();
  const objects = new Set<string>();
  for (const member of moduleInterface(source)?.members ?? []) {
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    const name = member.name.text;
    if (!isCallable(member)) objects.add(name);
    else functions.add(name);
    const wrapped =
      name === "cwrap" && ts.isMethodSignature(member)
        ? cwrapTarget(member)
        : null;
    if (wrapped) functions.add(wrapped);
  }
  return { functions: [...functions].sort(), objects: [...objects].sort() };
}

describe("the built engine provides everything the client calls", () => {
  const contract = clientContract();
  let module: Record<string, unknown> = {};

  beforeAll(async () => {
    if (!existsSync(wasm))
      throw new Error(
        `${wasm} is missing; build it with \`pnpm run build:engine\``,
      );
    const loaded = (await import(pathToFileURL(wasm).href)) as {
      default: (options: object) => Promise<Record<string, unknown>>;
    };
    module = await loaded.default({
      print: () => undefined,
      printErr: () => undefined,
    });
  });

  test("the client declares engine calls including the race start rules", () => {
    expect(contract.functions).toContain("_sdStewardsLights");
    expect(contract.functions).toContain("_sdRaceControlConfigure");
    expect(contract.functions).toContain("_sdInit");
  });

  test("every declared engine function is exported by the wasm build", () => {
    const missing = contract.functions.filter(
      (name) => typeof module[name] !== "function",
    );
    expect(
      missing,
      "rebuild with `pnpm run build:engine`, or export these from the engine",
    ).toEqual([]);
  });

  test("every declared runtime object is exported by the wasm build", () => {
    const missing = contract.objects.filter(
      (name) => typeof module[name] !== "object" || module[name] === null,
    );
    expect(missing).toEqual([]);
  });
});
