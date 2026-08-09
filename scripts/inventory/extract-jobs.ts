import {
  listFiles,
  literalText,
  parseJavaScript,
  sourceLine,
  visitAst,
} from './legacy-source';
import type { JobCapability, UnresolvedDiagnostic } from './inventory.types';

export interface JobExtraction {
  readonly capabilities: readonly JobCapability[];
  readonly jobFiles: readonly string[];
  readonly unresolved: readonly UnresolvedDiagnostic[];
}

export function extractJobCapabilities(legacyRoot: string): JobExtraction {
  const jobFiles = listFiles(legacyRoot, 'jobs', '.js');
  const capabilities: JobCapability[] = [];
  const unresolved: UnresolvedDiagnostic[] = [];

  for (const file of jobFiles) {
    const parsed = parseJavaScript(legacyRoot, file);
    let ordinal = 0;
    visitAst(parsed, (node) => {
      if (!parsed.ts.isCallExpression(node)) return;
      if (node.expression.getText(parsed.sourceFile) !== 'cron.schedule')
        return;
      ordinal += 1;
      const schedule = literalText(parsed, node.arguments[0]);
      if (schedule === undefined) {
        unresolved.push({
          category: 'job',
          source: { file, line: sourceLine(parsed, node) },
          expression: node.getText(parsed.sourceFile),
          reason: 'cron expression is not a string literal',
        });
        return;
      }
      const line = sourceLine(parsed, node);
      const basename = file.replace(/^jobs\//, '').replace(/\.js$/, '');
      capabilities.push({
        id: `job:${basename}:${ordinal}:${file}:${line}`,
        kind: 'job',
        source: { file, line },
        owner: 'admin-support-jobs',
        risk: basename === 'settleEpoch' ? 'critical' : 'high',
        status: 'legacy',
        name: `${basename}#${ordinal}`,
        schedule,
      });
    });
  }

  return { capabilities, jobFiles, unresolved };
}
