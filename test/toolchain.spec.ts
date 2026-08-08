import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

describe('toolchain contracts', () => {
  it('locks the NestJS migration toolchain', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      packageManager?: string;
      engines?: { node?: string };
      scripts: Record<string, string | undefined>;
    };
    const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    const eslintSource = readFileSync(join(root, 'eslint.config.mjs'), 'utf8');
    const { compilerOptions } = tsconfig;

    expect(manifest.packageManager).toBe('pnpm@10.33.2');
    expect(manifest.engines?.node).toBe('>=24 <25');
    expect(manifest.scripts.postinstall).toBe('prisma generate');
    expect(manifest.scripts.build).toBe('nest build -b swc');
    expect(manifest.scripts.typecheck).toBe('tsc --noEmit --pretty false');
    expect(manifest.scripts['verify:fast']).toBe(
      'pnpm format:check && pnpm lint && pnpm typecheck && pnpm prisma:validate && pnpm build',
    );
    expect(compilerOptions.strict).toBe(true);
    expect(compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(compilerOptions.noImplicitOverride).toBe(true);
    expect(compilerOptions.noImplicitReturns).toBe(true);
    expect(eslintSource).toContain("'@typescript-eslint/no-explicit-any': 'error'");
    expect(eslintSource).toContain("'@typescript-eslint/no-non-null-assertion': 'error'");
  });
});
