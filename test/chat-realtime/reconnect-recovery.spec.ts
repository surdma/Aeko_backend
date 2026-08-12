import { ChatRecoveryService } from '../../src/chat/chat-recovery.service';

describe('ChatRecoveryService', () => {
  it('authorizes and returns messages after the sequence cursor in order', async () => {
    const calls: string[] = [];
    const rows = [2n, 3n, 4n].map(sequence => ({ id: String(sequence), chatId: 'c', clientMessageId: null, sequence, createdAt: new Date() }));
    const recovery = new ChatRecoveryService({ after: async (_c, sequence, limit) => { calls.push(`${sequence}:${limit}`); return rows; } }, { assertMember: async () => { calls.push('authorize'); } } as never);
    await expect(recovery.after('u', 'c', 1n)).resolves.toEqual(rows);
    expect(calls).toEqual(['authorize', '1:100']);
  });
});
