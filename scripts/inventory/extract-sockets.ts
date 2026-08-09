import {
  listFiles,
  literalText,
  parseJavaScript,
  sourceLine,
  visitAst,
} from './legacy-source';
import type { SocketCapability, UnresolvedDiagnostic } from './inventory.types';

export interface SocketExtraction {
  readonly capabilities: readonly SocketCapability[];
  readonly socketFiles: readonly string[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
}

function namespaceForFile(
  legacyRoot: string,
  file: string,
): '/' | '/livestream' {
  const parsed = parseJavaScript(legacyRoot, file);
  let namespace: '/' | '/livestream' = '/';
  visitAst(parsed, (node) => {
    if (!parsed.ts.isCallExpression(node)) return;
    if (!node.expression.getText(parsed.sourceFile).endsWith('.of')) return;
    if (literalText(parsed, node.arguments[0]) === '/livestream') {
      namespace = '/livestream';
    }
  });
  return namespace;
}

export function extractSocketCapabilities(
  legacyRoot: string,
): SocketExtraction {
  const socketFiles = listFiles(legacyRoot, 'sockets', '.js');
  const capabilities: SocketCapability[] = [];
  const unresolved: UnresolvedDiagnostic[] = [];

  for (const file of socketFiles) {
    const parsed = parseJavaScript(legacyRoot, file);
    const namespace = namespaceForFile(legacyRoot, file);
    visitAst(parsed, (node) => {
      if (!parsed.ts.isCallExpression(node)) return;
      const expression = node.expression.getText(parsed.sourceFile);
      const match = /\.(on|emit)$/.exec(expression);
      if (match?.[1] === undefined) return;
      const event = literalText(parsed, node.arguments[0]);
      if (event === undefined) {
        unresolved.push({
          category: 'socket',
          source: { file, line: sourceLine(parsed, node) },
          expression: node.getText(parsed.sourceFile),
          reason: 'socket event is not a string literal',
        });
        return;
      }
      const direction = match[1] === 'on' ? 'inbound' : 'outbound';
      const line = sourceLine(parsed, node);
      capabilities.push({
        id: `socket:${namespace}:${direction}:${event}:${file}:${line}`,
        kind: 'socket',
        source: { file, line },
        owner: namespace === '/livestream' ? 'livestream' : 'chat-realtime',
        risk: namespace === '/livestream' ? 'high' : 'medium',
        status: 'legacy',
        namespace,
        direction,
        event,
      });
    });
  }

  return { capabilities, socketFiles, unresolved };
}
