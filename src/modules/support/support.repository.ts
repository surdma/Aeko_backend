export interface SupportTicketRecord {
  readonly id: string;
  readonly userId: string;
  readonly subject: string;
  readonly description: string;
  readonly category: string;
  readonly priority: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SupportMessageSenderRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly profilePicture: string | null;
  readonly isAdmin: boolean;
}

export interface SupportMessageRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly senderId: string;
  readonly message: string;
  readonly attachments: readonly string[];
  readonly createdAt: Date;
}

export interface SupportMessageWithSenderRecord
  extends SupportMessageRecord {
  readonly sender: SupportMessageSenderRecord;
}

export interface SupportTicketMessageCount {
  readonly messages: number;
}

export interface SupportTicketListRecord extends SupportTicketRecord {
  readonly _count: SupportTicketMessageCount;
}

export interface SupportTicketUserRecord {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly profilePicture: string | null;
}

export interface AdminSupportTicketUserRecord
  extends SupportTicketUserRecord {
  readonly email: string;
}

export interface SupportTicketDetailsRecord extends SupportTicketRecord {
  readonly messages: readonly SupportMessageWithSenderRecord[];
  readonly user: SupportTicketUserRecord;
}

export interface AdminSupportTicketRecord extends SupportTicketRecord {
  readonly user: AdminSupportTicketUserRecord;
  readonly _count: SupportTicketMessageCount;
}

export interface CreateSupportTicketPersistenceInput {
  readonly userId: string;
  readonly subject: string;
  readonly description: string;
  readonly category: string;
  readonly priority: string;
}

export interface CreateSupportMessagePersistenceInput {
  readonly ticketId: string;
  readonly senderId: string;
  readonly message: string;
  readonly attachments: readonly string[];
  readonly nextStatus?: string;
}

export interface AdminSupportTicketFilter {
  readonly status?: string;
  readonly category?: string;
  readonly priority?: string;
  readonly page: number;
  readonly limit: number;
}

export interface AdminSupportTicketPage {
  readonly tickets: readonly AdminSupportTicketRecord[];
  readonly total: number;
}

export interface SupportRepository {
  createTicket(
    input: CreateSupportTicketPersistenceInput,
  ): Promise<SupportTicketRecord>;
  listUserTickets(userId: string): Promise<readonly SupportTicketListRecord[]>;
  findTicketDetails(id: string): Promise<SupportTicketDetailsRecord | null>;
  findTicketById(id: string): Promise<SupportTicketRecord | null>;
  createMessageWithStatus(
    input: CreateSupportMessagePersistenceInput,
  ): Promise<SupportMessageWithSenderRecord>;
  updateTicketStatus(id: string, status: string): Promise<SupportTicketRecord>;
  listAdminTickets(
    filter: AdminSupportTicketFilter,
  ): Promise<AdminSupportTicketPage>;
  updateTicketPriority(
    id: string,
    priority: string,
  ): Promise<SupportTicketRecord>;
}

export const SUPPORT_REPOSITORY = Symbol('SUPPORT_REPOSITORY');
