import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface AstNode {
  readonly kind: number;
  readonly pos: number;
  readonly end: number;
  getStart(sourceFile?: AstSourceFile): number;
  getText(sourceFile?: AstSourceFile): string;
}

export interface AstSourceFile extends AstNode {
  getLineAndCharacterOfPosition(position: number): { readonly line: number };
}

export interface CallExpressionNode extends AstNode {
  readonly expression: AstNode;
  readonly arguments: readonly AstNode[];
}

export interface TypeScriptApi {
  readonly ScriptTarget: { readonly Latest: number };
  readonly ScriptKind: { readonly JS: number };
  createSourceFile(
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes: boolean,
    scriptKind: number,
  ): AstSourceFile;
  forEachChild(node: AstNode, callback: (child: AstNode) => void): void;
  isCallExpression(node: AstNode): node is CallExpressionNode;
  isStringLiteralLike(node: AstNode): boolean;
}

export interface ParsedJavaScript {
  readonly absoluteFile: string;
  readonly relativeFile: string;
  readonly text: string;
  readonly sourceFile: AstSourceFile;
  readonly ts: TypeScriptApi;
}

const workspaceRequire = createRequire(join(process.cwd(), 'package.json'));

function pnpmPackageDirectoryName(packageName: string): string {
  return packageName.replace('/', '+');
}

export function resolveInstalledPackage(
  packageName: string,
  entry: string,
): string {
  try {
    return workspaceRequire.resolve(packageName);
  } catch (error: unknown) {
    const pnpmRoot = join(process.cwd(), 'node_modules', '.pnpm');
    const prefix = `${pnpmPackageDirectoryName(packageName)}@`;
    const packageDirectory = existsSync(pnpmRoot)
      ? readdirSync(pnpmRoot)
          .filter((name) => name.startsWith(prefix))
          .sort()[0]
      : undefined;

    if (packageDirectory === undefined) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot resolve installed package ${packageName}: ${detail}`,
      );
    }

    const resolvedEntry = join(
      pnpmRoot,
      packageDirectory,
      'node_modules',
      ...packageName.split('/'),
      entry,
    );
    if (!existsSync(resolvedEntry)) {
      throw new Error(
        `Installed package entry does not exist: ${resolvedEntry}`,
      );
    }
    return resolvedEntry;
  }
}

function isTypeScriptApi(value: unknown): value is TypeScriptApi {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TypeScriptApi>;
  return (
    typeof candidate.createSourceFile === 'function' &&
    typeof candidate.forEachChild === 'function' &&
    typeof candidate.isCallExpression === 'function' &&
    typeof candidate.isStringLiteralLike === 'function' &&
    candidate.ScriptTarget !== undefined &&
    candidate.ScriptKind !== undefined
  );
}

let cachedTypeScript: TypeScriptApi | undefined;

export function loadTypeScript(): TypeScriptApi {
  if (cachedTypeScript !== undefined) return cachedTypeScript;
  const loaded: unknown = workspaceRequire(
    resolveInstalledPackage('typescript', 'lib/typescript.js'),
  );
  if (!isTypeScriptApi(loaded)) {
    throw new Error(
      'Installed TypeScript package does not expose the compiler API',
    );
  }
  cachedTypeScript = loaded;
  return loaded;
}

export function normalizeRelativePath(root: string, file: string): string {
  return relative(resolve(root), resolve(file)).split(sep).join('/');
}

export function readLegacyFile(root: string, relativeFile: string): string {
  return readFileSync(join(resolve(root), ...relativeFile.split('/')), 'utf8');
}

export function parseJavaScript(
  legacyRoot: string,
  relativeFile: string,
): ParsedJavaScript {
  const absoluteFile = join(resolve(legacyRoot), ...relativeFile.split('/'));
  const text = readFileSync(absoluteFile, 'utf8');
  const ts = loadTypeScript();
  const sourceFile = ts.createSourceFile(
    absoluteFile,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  return { absoluteFile, relativeFile, text, sourceFile, ts };
}

export function visitAst(
  parsed: ParsedJavaScript,
  visitor: (node: AstNode) => void,
): void {
  const walk = (node: AstNode): void => {
    visitor(node);
    parsed.ts.forEachChild(node, walk);
  };
  walk(parsed.sourceFile);
}

export function sourceLine(parsed: ParsedJavaScript, node: AstNode): number {
  return (
    parsed.sourceFile.getLineAndCharacterOfPosition(
      node.getStart(parsed.sourceFile),
    ).line + 1
  );
}

export function literalText(
  parsed: ParsedJavaScript,
  node: AstNode | undefined,
): string | undefined {
  if (node === undefined || !parsed.ts.isStringLiteralLike(node))
    return undefined;
  const text = node.getText(parsed.sourceFile);
  return text.length >= 2 ? text.slice(1, -1) : undefined;
}

export function listFiles(
  root: string,
  relativeDirectory: string,
  extension: string,
): readonly string[] {
  const absoluteDirectory = join(
    resolve(root),
    ...relativeDirectory.split('/'),
  );
  if (!existsSync(absoluteDirectory)) return [];

  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return visit(absolute);
      return entry.isFile() && entry.name.endsWith(extension)
        ? [normalizeRelativePath(root, absolute)]
        : [];
    });

  return visit(absoluteDirectory).sort();
}

export function containingDirectory(file: string): string {
  return dirname(file).split(sep).join('/');
}
