import { Inject, Injectable } from '@nestjs/common';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type {
  AddSupportMessageBody,
  CreateSupportTicketBody,
  ListAdminSupportTicketsQuery,
  UpdateSupportTicketPriorityBody,
  UpdateSupportTicketStatusBody,
} from './support.schemas.js';
import {
  SUPPORT_REPOSITORY,
  type AdminSupportTicketFilter,
  type AdminSupportTicketPage,
  type SupportMessageWithSenderRecord,
  type SupportRepository,
  type SupportTicketDetailsRecord,
  type SupportTicketListRecord,
  type SupportTicketRecord,
} from './support.repository.js';

type SupportActor = Readonly<Pick<AuthenticatedUser, 'id' | 'isAdmin'>>;
type UnexpectedResult = Readonly<{ kind: 'unexpected' }>;

export type CreateSupportTicketResult =
  | Readonly<{ kind: 'success'; ticket: SupportTicketRecord }>
  | UnexpectedResult;

export type ListUserSupportTicketsResult =
  | Readonly<{
      kind: 'success';
      tickets: readonly SupportTicketListRecord[];
    }>
  | UnexpectedResult;

export type SupportTicketDetailsResult =
  | Readonly<{ kind: 'success'; ticket: SupportTicketDetailsRecord }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'forbidden' }>
  | UnexpectedResult;

export type AddSupportMessageResult =
  | Readonly<{
      kind: 'success';
      message: SupportMessageWithSenderRecord;
    }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'forbidden' }>
  | UnexpectedResult;

export type UpdateSupportTicketStatusResult =
  | Readonly<{ kind: 'success'; ticket: SupportTicketRecord }>
  | Readonly<{ kind: 'not-found' }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'user-status-forbidden' }>
  | UnexpectedResult;

export type ListAdminSupportTicketsResult =
  | Readonly<{ kind: 'success'; page: AdminSupportTicketPage }>
  | UnexpectedResult;

export type UpdateSupportTicketPriorityResult =
  | Readonly<{ kind: 'success'; ticket: SupportTicketRecord }>
  | UnexpectedResult;

@Injectable()
export class SupportService {
  public constructor(
    @Inject(SUPPORT_REPOSITORY)
    private readonly repository: SupportRepository,
    private readonly logger: SanitizedLogger,
  ) {}

  public async createTicket(
    userId: string,
    input: CreateSupportTicketBody,
  ): Promise<CreateSupportTicketResult> {
    try {
      return {
        kind: 'success',
        ticket: await this.repository.createTicket({
          userId,
          subject: input.subject,
          description: input.description,
          category: input.category,
          priority: input.priority,
        }),
      };
    } catch (error: unknown) {
      return this.unexpected('create support ticket', error);
    }
  }

  public async listUserTickets(
    userId: string,
  ): Promise<ListUserSupportTicketsResult> {
    try {
      return {
        kind: 'success',
        tickets: await this.repository.listUserTickets(userId),
      };
    } catch (error: unknown) {
      return this.unexpected('list user support tickets', error);
    }
  }

  public async getTicket(
    actor: SupportActor,
    ticketId: string,
  ): Promise<SupportTicketDetailsResult> {
    try {
      const ticket = await this.repository.findTicketDetails(ticketId);
      if (ticket === null) return { kind: 'not-found' };
      if (ticket.userId !== actor.id && !actor.isAdmin) {
        return { kind: 'forbidden' };
      }
      return { kind: 'success', ticket };
    } catch (error: unknown) {
      return this.unexpected('get support ticket', error);
    }
  }

  public async addMessage(
    actor: SupportActor,
    ticketId: string,
    input: AddSupportMessageBody,
  ): Promise<AddSupportMessageResult> {
    try {
      const ticket = await this.repository.findTicketById(ticketId);
      if (ticket === null) return { kind: 'not-found' };
      if (ticket.userId !== actor.id && !actor.isAdmin) {
        return { kind: 'forbidden' };
      }

      const nextStatus = actor.isAdmin
        ? 'in_progress'
        : ticket.status === 'closed' || ticket.status === 'resolved'
          ? 'open'
          : undefined;

      return {
        kind: 'success',
        message: await this.repository.createMessageWithStatus({
          ticketId,
          senderId: actor.id,
          message: input.message,
          attachments: input.attachments,
          ...(nextStatus === undefined ? {} : { nextStatus }),
        }),
      };
    } catch (error: unknown) {
      return this.unexpected('add support ticket message', error);
    }
  }

  public async updateStatus(
    actor: SupportActor,
    ticketId: string,
    input: UpdateSupportTicketStatusBody,
  ): Promise<UpdateSupportTicketStatusResult> {
    try {
      const ticket = await this.repository.findTicketById(ticketId);
      if (ticket === null) return { kind: 'not-found' };

      if (!actor.isAdmin) {
        if (ticket.userId !== actor.id) return { kind: 'forbidden' };
        if (input.status !== 'closed' && input.status !== 'resolved') {
          return { kind: 'user-status-forbidden' };
        }
      }

      return {
        kind: 'success',
        ticket: await this.repository.updateTicketStatus(ticketId, input.status),
      };
    } catch (error: unknown) {
      return this.unexpected('update support ticket status', error);
    }
  }

  public async listAdminTickets(
    query: ListAdminSupportTicketsQuery,
  ): Promise<ListAdminSupportTicketsResult> {
    try {
      const filter: AdminSupportTicketFilter = {
        page: query.page,
        limit: query.limit,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.priority === undefined ? {} : { priority: query.priority }),
      };

      return {
        kind: 'success',
        page: await this.repository.listAdminTickets(filter),
      };
    } catch (error: unknown) {
      return this.unexpected('list administrator support tickets', error);
    }
  }

  public async updatePriority(
    ticketId: string,
    input: UpdateSupportTicketPriorityBody,
  ): Promise<UpdateSupportTicketPriorityResult> {
    try {
      return {
        kind: 'success',
        ticket: await this.repository.updateTicketPriority(
          ticketId,
          input.priority,
        ),
      };
    } catch (error: unknown) {
      return this.unexpected('update support ticket priority', error);
    }
  }

  private unexpected(operation: string, error: unknown): UnexpectedResult {
    this.logger.error(`Failed to ${operation}`, { error });
    return { kind: 'unexpected' };
  }
}
