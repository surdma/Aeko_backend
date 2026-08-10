import {
  parseDebateCreate,
  parseDebateEnd,
  parseDebateListQuery,
  parseDebateScoreRequest,
  parseDebateVote,
} from '../../src/debates/debate.contract';
import {
  parseChallengeCreate,
  parseChallengeEnd,
  parseChallengeListQuery,
  parseChallengeVote,
  parseDuetEntry,
} from '../../src/challenges/challenge.contract';
import {
  parseHighlightEntry,
  parseSpaceCreate,
} from '../../src/spaces/space.contract';

describe('debate contracts', () => {
  it('accepts a topic and a bounded participant list', () => {
    expect(
      parseDebateCreate({
        topic: '  Is AI creative?  ',
        participants: ['a', 'b'],
      }),
    ).toEqual({ topic: 'Is AI creative?', participants: ['a', 'b'] });
    // Legacy allowed a debate with no participants; that is preserved.
    expect(parseDebateCreate({ topic: 'Solo' }).participants).toEqual([]);
  });

  it('rejects an empty topic, oversized rosters, and injected fields', () => {
    expect(() => parseDebateCreate({})).toThrow('topic');
    expect(() => parseDebateCreate({ topic: '   ' })).toThrow('topic');
    expect(() =>
      parseDebateCreate({
        topic: 'Big',
        participants: Array.from({ length: 201 }, (_, index) => `u${index}`),
      }),
    ).toThrow('participants');
    for (const field of ['creatorId', 'scores', 'votes', 'status', 'winner']) {
      expect(() =>
        parseDebateCreate({ topic: 'x', [field]: 'injected' }),
      ).toThrow(field);
    }
  });

  it('requires a participant and message to request a score', () => {
    expect(
      parseDebateScoreRequest({ participantId: ' p1 ', message: ' hello ' }),
    ).toEqual({ participantId: 'p1', message: 'hello' });
    expect(() => parseDebateScoreRequest({ participantId: 'p1' })).toThrow(
      'message',
    );
    expect(() => parseDebateScoreRequest({ message: 'hi' })).toThrow(
      'participantId',
    );
  });

  it('takes only the participant being voted for, never the voter', () => {
    expect(parseDebateVote({ participantId: 'p1' })).toEqual({
      participantId: 'p1',
    });
    // A caller-supplied voter is ignored, not honoured: the session decides.
    expect(parseDebateVote({ participantId: 'p1', userId: 'victim' })).toEqual({
      participantId: 'p1',
    });
    expect(() => parseDebateVote({})).toThrow('participantId');
  });

  it('defaults the end reason exactly as Express did', () => {
    expect(parseDebateEnd({ winner: 'p1' })).toEqual({
      winner: 'p1',
      reason: 'Ended by creator',
    });
    expect(parseDebateEnd({ winner: 'p1', reason: ' Forfeit ' })).toEqual({
      winner: 'p1',
      reason: 'Forfeit',
    });
    // Legacy accepted an end with no winner and stored null.
    expect(parseDebateEnd({}).winner).toBeNull();
  });

  it('bounds the public list query', () => {
    expect(parseDebateListQuery({})).toEqual({
      status: null,
      page: 1,
      limit: 10,
    });
    expect(parseDebateListQuery({ page: '0', limit: '900' })).toEqual({
      status: null,
      page: 1,
      limit: 50,
    });
    expect(parseDebateListQuery({ status: 'ended' }).status).toBe('ended');
  });
});

describe('challenge contracts', () => {
  it('requires an https video to create or duet', () => {
    expect(
      parseChallengeCreate({ videoUrl: 'https://cdn.example.com/a.mp4' }),
    ).toEqual({ videoUrl: 'https://cdn.example.com/a.mp4' });
    expect(() => parseChallengeCreate({})).toThrow('videoUrl');
    expect(() =>
      parseChallengeCreate({ videoUrl: 'http://cdn.example.com/a.mp4' }),
    ).toThrow('videoUrl');
    expect(() => parseDuetEntry({ videoUrl: 'javascript:alert(1)' })).toThrow(
      'videoUrl',
    );
    expect(
      parseDuetEntry({ videoUrl: 'https://cdn.example.com/b.mp4' }),
    ).toEqual({ videoUrl: 'https://cdn.example.com/b.mp4' });
  });

  it('never lets a caller name the voter', () => {
    // Legacy read the voter from req.body.userId, so any caller could vote as
    // anyone. The field is now accepted and ignored rather than rejected, so a
    // client that still sends it keeps working — voting as itself.
    expect(parseChallengeVote({ userId: 'victim' })).toEqual({});
    expect(parseChallengeVote({})).toEqual({});
  });

  it('rejects fields a caller must never set on create', () => {
    for (const field of ['creatorId', 'participants', 'votes', 'status']) {
      expect(() =>
        parseChallengeCreate({
          videoUrl: 'https://cdn.example.com/a.mp4',
          [field]: 'injected',
        }),
      ).toThrow(field);
    }
  });

  it('defaults the end reason and bounds the list query', () => {
    expect(parseChallengeEnd({})).toEqual({
      winner: null,
      reason: 'Ended by creator',
    });
    expect(parseChallengeListQuery({ limit: '900' })).toEqual({
      status: null,
      page: 1,
      limit: 50,
    });
  });
});

describe('space contracts', () => {
  it('requires a bounded title', () => {
    expect(parseSpaceCreate({ title: '  Morning room  ' })).toEqual({
      title: 'Morning room',
    });
    expect(() => parseSpaceCreate({})).toThrow('title');
    expect(() => parseSpaceCreate({ title: 'x'.repeat(300) })).toThrow('title');
    for (const field of ['hostId', 'isLive', 'highlights']) {
      expect(() =>
        parseSpaceCreate({ title: 'x', [field]: 'injected' }),
      ).toThrow(field);
    }
  });

  it('requires an https highlight video', () => {
    expect(
      parseHighlightEntry({ videoUrl: 'https://cdn.example.com/h.mp4' }),
    ).toEqual({ videoUrl: 'https://cdn.example.com/h.mp4' });
    expect(() => parseHighlightEntry({})).toThrow('videoUrl');
    expect(() =>
      parseHighlightEntry({ videoUrl: 'http://cdn.example.com/h.mp4' }),
    ).toThrow('videoUrl');
  });
});
