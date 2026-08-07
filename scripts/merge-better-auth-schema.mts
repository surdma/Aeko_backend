import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const generatedPath = resolve(repositoryRoot, 'better-auth.generated.prisma');
const schemaPath = resolve(repositoryRoot, 'prisma/schema.prisma');
const startMarker = '// BEGIN BETTER AUTH V1 SCHEMA';
const endMarker = '// END BETTER AUTH V1 SCHEMA';

const modelNames = [
  'User',
  'Session',
  'Account',
  'Verification',
  'TwoFactor',
  'Passkey',
] as const;

const renamedModels = new Map<string, string>([
  ['User', 'AuthUser'],
  ['Session', 'AuthSession'],
  ['Account', 'AuthAccount'],
  ['Verification', 'AuthVerification'],
  ['TwoFactor', 'AuthTwoFactor'],
  ['Passkey', 'AuthPasskey'],
]);

function extractModel(schema: string, modelName: string): string {
  const expression = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, 'u');
  const match = expression.exec(schema);
  if (match === null) {
    throw new Error(`Better Auth CLI output is missing model ${modelName}`);
  }
  return match[0];
}

function renameModelReferences(model: string): string {
  let renamed = model;
  for (const [source, target] of renamedModels) {
    renamed = renamed.replace(new RegExp(`\\b${source}\\b`, 'gu'), target);
  }
  return renamed;
}

function extendAuthUser(model: string): string {
  const relationAnchor = '  passkeys         AuthPasskey[]';
  if (!model.includes(relationAnchor)) {
    throw new Error('Generated AuthUser model no longer has the expected passkey relation');
  }
  return model.replace(
    relationAnchor,
    `${relationAnchor}\n  profile          Profile?\n  migrationLink    AuthMigrationLink?`,
  );
}

function generatedFragment(generated: string): string {
  const models = modelNames.map((modelName) =>
    renameModelReferences(extractModel(generated, modelName)),
  );
  models[0] = extendAuthUser(models[0] ?? '');

  return `${startMarker}

enum AuthMigrationStatus {
  PENDING
  MIGRATED
  CONFLICT
  FAILED
}

${models.join('\n\n')}

model Profile {
  userId            String   @id
  bio               String?  @db.Text
  profilePicture    String?
  coverPhoto        String?
  location          String?
  blueTick          Boolean  @default(false)
  profileCompletion Json     @default("{}")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("profiles")
}

model AuthMigrationLink {
  id           String              @id @default(cuid())
  legacyUserId String              @unique
  authUserId   String              @unique
  status       AuthMigrationStatus @default(PENDING)
  details      Json?
  migratedAt   DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  authUser     AuthUser            @relation(fields: [authUserId], references: [id], onDelete: Cascade)

  @@index([status])
  @@map("auth_migration_links")
}

${endMarker}`;
}

function mergeSchema(current: string, fragment: string): string {
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if ((start === -1) !== (end === -1)) {
    throw new Error('Better Auth schema markers are incomplete');
  }
  if (start === -1) return `${current.trimEnd()}\n\n${fragment}\n`;

  const replacementEnd = end + endMarker.length;
  return `${current.slice(0, start)}${fragment}${current.slice(replacementEnd)}`;
}

const [generated, current] = await Promise.all([
  readFile(generatedPath, 'utf8'),
  readFile(schemaPath, 'utf8'),
]);

for (const modelName of modelNames) {
  const physicalTable = modelName === 'TwoFactor' ? 'twoFactor' : modelName.toLowerCase();
  if (!generated.includes(`@@map("${physicalTable}")`)) {
    throw new Error(`Better Auth CLI output changed the ${modelName} physical table mapping`);
  }
}

await writeFile(schemaPath, mergeSchema(current, generatedFragment(generated)), 'utf8');
