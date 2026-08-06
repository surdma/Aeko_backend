import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { SupportAdminAccessGuard } from './support-admin-access.guard.js';
import type {
  AdminSupportTicketRecord,
  SupportMessageWithSenderRecord,
  SupportTicketDetailsRecord,
  SupportTicketListRecord,
  SupportTicketRecord,
} from './support.repository.js';
import {
  addSupportMessageSchema,
  type AddSupportMessageBody,
  createSupportTicketSchema,
  type CreateSupportTicketBody,
  listAdminSupportTicketsQuerySchema,
  type ListAdminSupportTicketsQuery,
  updateSupportTicketPrioritySchema,
  type UpdateSupportTicketPriorityBody,
  updateSupportTicketStatusSchema,
  type UpdateSupportTicketStatusBody,
} from './support.schemas.js';
import { SupportService } from './support.service.js';
import { SupportValidationPipe } from './support-validation.pipe.js';

type TicketResponse = Readonly<{
  success: true;
  ticket: SupportTicketRecord;
}>;
type TicketDetailsResponse = Readonly<{
  success: true;
  ticket: SupportTicketDetailsRecord;
}>;
type TicketListResponse = Readonly<{
  success: true;
  tickets: readonly SupportTicketListRecord[];
}>;
type MessageResponse = Readonly<{
  success: true;
  message: SupportMessageWithSenderRecord;
}>;
type AdminTicketListResponse = Readonly<{
  success: true;
  tickets: readonly AdminSupportTicketRecord[];
  pagination: Readonly<{
    total: number;
    page: number;
    pages: number;
    limit: number;
  }>;
}>;

@Controller('api/support')
@UseGuards(ThrottlerGuard, JwtAuthGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
@Throttle({ default: { limit: 100, ttl: minutes(15) } })
export class SupportController {
  public constructor(private readonly service: SupportService) {}

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  public async createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      new SupportValidationPipe(
        createSupportTicketSchema,
        'Subject, description and valid category are required',
      ),
    )
    input: CreateSupportTicketBody,
  ): Promise<TicketResponse> {
    const result = await this.service.createTicket(user.id, input);
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, ticket: result.ticket };
  }

  @Get('tickets')
  public async listUserTickets(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TicketListResponse> {
    const result = await this.service.listUserTickets(user.id);
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, tickets: result.tickets };
  }

  @Get('tickets/:id')
  public async getTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') ticketId: string,
  ): Promise<TicketDetailsResponse> {
    const result = await this.service.getTicket(user, ticketId);
    if (result.kind === 'not-found') {
      throw new NotFoundException({ error: 'Ticket not found' });
    }
    if (result.kind === 'forbidden') {
      throw new ForbiddenException({ error: 'Access denied' });
    }
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, ticket: result.ticket };
  }

  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  public async addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') ticketId: string,
    @Body(
      new SupportValidationPipe(
        addSupportMessageSchema,
        'Message is required',
      ),
    )
    input: AddSupportMessageBody,
  ): Promise<MessageResponse> {
    const result = await this.service.addMessage(user, ticketId, input);
    if (result.kind === 'not-found') {
      throw new NotFoundException({ error: 'Ticket not found' });
    }
    if (result.kind === 'forbidden') {
      throw new ForbiddenException({ error: 'Access denied' });
    }
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, message: result.message };
  }

  @Patch('tickets/:id/status')
  public async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') ticketId: string,
    @Body(
      new SupportValidationPipe(
        updateSupportTicketStatusSchema,
        'Status is required',
      ),
    )
    input: UpdateSupportTicketStatusBody,
  ): Promise<TicketResponse> {
    const result = await this.service.updateStatus(user, ticketId, input);
    if (result.kind === 'not-found') {
      throw new NotFoundException({ error: 'Ticket not found' });
    }
    if (result.kind === 'forbidden') {
      throw new ForbiddenException({ error: 'Access denied' });
    }
    if (result.kind === 'user-status-forbidden') {
      throw new ForbiddenException({
        error: 'Users can only close or resolve tickets',
      });
    }
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, ticket: result.ticket };
  }

  @Get('admin/tickets')
  @UseGuards(SupportAdminAccessGuard)
  public async listAdminTickets(
    @Query(
      new SupportValidationPipe(
        listAdminSupportTicketsQuerySchema,
        'Invalid support ticket filters',
      ),
    )
    query: ListAdminSupportTicketsQuery,
  ): Promise<AdminTicketListResponse> {
    const result = await this.service.listAdminTickets(query);
    if (result.kind === 'unexpected') return this.serverError();

    return {
      success: true,
      tickets: result.page.tickets,
      pagination: {
        total: result.page.total,
        page: query.page,
        pages: Math.ceil(result.page.total / query.limit),
        limit: query.limit,
      },
    };
  }

  @Patch('admin/tickets/:id/priority')
  @UseGuards(SupportAdminAccessGuard)
  public async updatePriority(
    @Param('id') ticketId: string,
    @Body(
      new SupportValidationPipe(
        updateSupportTicketPrioritySchema,
        'Priority is required',
      ),
    )
    input: UpdateSupportTicketPriorityBody,
  ): Promise<TicketResponse> {
    const result = await this.service.updatePriority(ticketId, input);
    if (result.kind === 'unexpected') return this.serverError();
    return { success: true, ticket: result.ticket };
  }

  private serverError(): never {
    throw new InternalServerErrorException({ error: 'Server error' });
  }
}
