import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminSupportTicketFilter,
  AdminSupportTicketPage,
  CreateSupportMessagePersistenceInput,
  CreateSupportTicketPersistenceInput,
  SupportMessageWithSenderRecord,
  SupportRepository,
  SupportTicketDetailsRecord,
  SupportTicketListRecord,
  SupportTicketRecord,
} from '../../../modules/support/support.repository.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PrismaSupportRepository implements SupportRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public createTicket(
    input: CreateSupportTicketPersistenceInput,
  ): Promise<SupportTicketRecord> {
    return this.prisma.supportTicket.create({ data: input });
  }

  public listUserTickets(
    userId: string,
  ): Promise<readonly SupportTicketListRecord[]> {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  public findTicketDetails(
    id: string,
  ): Promise<SupportTicketDetailsRecord | null> {
    return this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
                profilePicture: true,
                isAdmin: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            profilePicture: true,
          },
        },
      },
    });
  }

  public findTicketById(id: string): Promise<SupportTicketRecord | null> {
    return this.prisma.supportTicket.findUnique({ where: { id } });
  }

  public createMessageWithStatus(
    input: CreateSupportMessagePersistenceInput,
  ): Promise<SupportMessageWithSenderRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.supportMessage.create({
        data: {
          ticketId: input.ticketId,
          senderId: input.senderId,
          message: input.message,
          attachments: [...input.attachments],
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              profilePicture: true,
              isAdmin: true,
            },
          },
        },
      });

      if (input.nextStatus !== undefined) {
        await transaction.supportTicket.update({
          where: { id: input.ticketId },
          data: { status: input.nextStatus },
        });
      }

      return message;
    });
  }

  public updateTicketStatus(
    id: string,
    status: string,
  ): Promise<SupportTicketRecord> {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { status },
    });
  }

  public async listAdminTickets(
    filter: AdminSupportTicketFilter,
  ): Promise<AdminSupportTicketPage> {
    const where: Prisma.SupportTicketWhereInput = {
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.category === undefined ? {} : { category: filter.category }),
      ...(filter.priority === undefined ? {} : { priority: filter.priority }),
    };
    const skip = (filter.page - 1) * filter.limit;

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: filter.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              name: true,
              profilePicture: true,
            },
          },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { tickets, total };
  }

  public updateTicketPriority(
    id: string,
    priority: string,
  ): Promise<SupportTicketRecord> {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { priority },
    });
  }
}
