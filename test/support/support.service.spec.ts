import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type {
  SupportMessageWithSenderRecord,
  SupportRepository,
  SupportTicketDetailsRecord,
  SupportTicketRecord,
} from '../../src/modules/support/support.repository.js';
import { SupportService } from '../../src/modules/support/support.service.js';

const ticket: SupportTicketRecord = {
  id: 'ticket-1',
  userId: 'user-1',
  subject: 'Account help',
  description: 'I need help',
  category: 'account',
  priority: 'medium',
  status: 'open',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
};

const ticketDetails: SupportTicketDetailsRecord = {
  ...ticket,
  messages: [],
  user: {
    id: ticket.userId,
    username: 'user',
    name: 'User',
    profilePicture: null,
  },
};

const message: SupportMessageWithSenderRecord = {
  id: 'message-1',
  ticketId: ticket.id,
  senderId: ticket.userId,
  message: 'Additional details',
  attachments: [],
  createdAt: new Date('2026-08-06T18:01:00.000Z'),
  sender: {
    id: ticket.userId,
    username: 'user',
    name: 'User',
    profilePicture: null,
    isAdmin: false,
  },
};

const repository: SupportRepository = {
  createTicket: vi.fn(),
  listUserTickets: vi.fn(),
  findTicketDetails: vi.fn(),
  findTicketById: vi.fn(),
  createMessageWithStatus: vi.fn(),
  updateTicketStatus: vi.fn(),
  listAdminTickets: vi.fn(),
  updateTicketPriority: vi.fn(),
};

describe('SupportService', () => {
  let service: SupportService;
  let logger: SanitizedLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new SupportService(repository, logger);
  });

  it('preserves ticket ownership access rules', async () => {
    vi.mocked(repository.findTicketDetails).mockResolvedValue(ticketDetails);

    await expect(
      service.getTicket({ id: ticket.userId, isAdmin: false }, ticket.id),
    ).resolves.toEqual({ kind: 'success', ticket: ticketDetails });
    await expect(
      service.getTicket({ id: 'other-user', isAdmin: false }, ticket.id),
    ).resolves.toEqual({ kind: 'forbidden' });
    await expect(
      service.getTicket({ id: 'admin', isAdmin: true }, ticket.id),
    ).resolves.toEqual({ kind: 'success', ticket: ticketDetails });
  });

  it('reopens a closed ticket when its owner replies', async () => {
    vi.mocked(repository.findTicketById).mockResolvedValue({
      ...ticket,
      status: 'closed',
    });
    vi.mocked(repository.createMessageWithStatus).mockResolvedValue(message);

    const result = await service.addMessage(
      { id: ticket.userId, isAdmin: false },
      ticket.id,
      { message: message.message, attachments: [] },
    );

    expect(result).toEqual({ kind: 'success', message });
    expect(repository.createMessageWithStatus).toHaveBeenCalledWith({
      ticketId: ticket.id,
      senderId: ticket.userId,
      message: message.message,
      attachments: [],
      nextStatus: 'open',
    });
  });

  it('moves a ticket to in_progress when an administrator replies', async () => {
    vi.mocked(repository.findTicketById).mockResolvedValue(ticket);
    vi.mocked(repository.createMessageWithStatus).mockResolvedValue(message);

    await service.addMessage(
      { id: 'admin', isAdmin: true },
      ticket.id,
      { message: message.message, attachments: [] },
    );

    expect(repository.createMessageWithStatus).toHaveBeenCalledWith({
      ticketId: ticket.id,
      senderId: 'admin',
      message: message.message,
      attachments: [],
      nextStatus: 'in_progress',
    });
  });

  it('allows ordinary users to set only closed or resolved status', async () => {
    vi.mocked(repository.findTicketById).mockResolvedValue(ticket);

    await expect(
      service.updateStatus(
        { id: ticket.userId, isAdmin: false },
        ticket.id,
        { status: 'in_progress' },
      ),
    ).resolves.toEqual({ kind: 'user-status-forbidden' });
    expect(repository.updateTicketStatus).not.toHaveBeenCalled();
  });

  it('turns unexpected persistence failures into a typed safe result', async () => {
    vi.mocked(repository.listUserTickets).mockRejectedValue(
      new Error('postgresql://admin:secret@database.internal/aeko'),
    );

    await expect(service.listUserTickets(ticket.userId)).resolves.toEqual({
      kind: 'unexpected',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
