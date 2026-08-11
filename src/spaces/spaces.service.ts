import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import type { JsonValue } from '../common/json/json-value';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  parseHighlightEntry,
  parseSpaceCreate,
  type SpaceView,
} from './space.contract';
import {
  createSpacePrismaClient,
  type SpacePrismaClient,
  type SpaceRecord,
} from './space-prisma.client';

@Injectable()
export class SpacesService {
  constructor(private readonly prisma: PrismaService) {}

  private get spaces(): SpacePrismaClient {
    return createSpacePrismaClient(this.prisma.db);
  }

  async create(
    principal: AuthenticatedPrincipal,
    body: unknown,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    const input = parseSpaceCreate(body);
    const record = await this.spaces.create({
      title: input.title,
      hostId: principal.userId,
      participants: Object.freeze([]),
      isLive: true,
    });
    return Object.freeze({ success: true as const, space: project(record) });
  }

  /** Host-only and idempotent, both exactly as Express had it. */
  async end(
    principal: AuthenticatedPrincipal,
    spaceId: string,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    const record = await this.requireHost(principal, spaceId);
    if (!record.isLive) {
      return Object.freeze({ success: true as const, space: project(record) });
    }
    const updated = await this.spaces.update(spaceId, { isLive: false });
    return Object.freeze({ success: true as const, space: project(updated) });
  }

  /**
   * Legacy performed no authorization here, so any authenticated user could
   * append highlights to anyone's space. It is now the host's, and the append
   * runs in a serializable transaction instead of a read-modify-write.
   */
  async addHighlight(
    principal: AuthenticatedPrincipal,
    spaceId: string,
    body: unknown,
  ): Promise<{ readonly success: true; readonly space: SpaceView }> {
    const entry = parseHighlightEntry(body);
    await this.requireHost(principal, spaceId);
    const now = new Date();

    return this.spaces.runSerializable(async (transaction) => {
      const record = await transaction.findById(spaceId);
      if (record === null) throw notFound();
      const highlights: readonly JsonValue[] = Array.isArray(record.highlights)
        ? record.highlights
        : [];
      const updated = await transaction.update(spaceId, {
        highlights: Object.freeze([
          ...highlights,
          Object.freeze({
            videoUrl: entry.videoUrl,
            timestamp: now.toISOString(),
          }),
        ]),
      });
      return Object.freeze({ success: true as const, space: project(updated) });
    });
  }

  private async requireHost(
    principal: AuthenticatedPrincipal,
    spaceId: string,
  ): Promise<SpaceRecord> {
    const record = await this.spaces.findById(spaceId);
    if (record === null) throw notFound();
    if (record.hostId !== principal.userId) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'Only the host can change this space.',
      );
    }
    return record;
  }
}

const project = (record: SpaceRecord): SpaceView =>
  Object.freeze({
    id: record.id,
    title: record.title,
    hostId: record.hostId,
    host: record.host,
    participants: record.participants,
    highlights: record.highlights,
    isLive: record.isLive,
    createdAt: record.createdAt.toISOString(),
  });

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'Space not found.');
}
