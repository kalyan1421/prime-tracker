import { resolveMentions, MentionCandidate } from './mentions';

const USERS: MentionCandidate[] = [
  { id: 'u-sarah', name: 'Sarah Chen', email: 'sarah.chen@primedevelopers.com' },
  { id: 'u-sara', name: 'Sara', email: 'sara@primedevelopers.com' },
  { id: 'u-james', name: 'James Rivera', email: 'pm@primedevelopers.com' },
  { id: 'u-emily', name: 'Emily Park', email: 'sales@primedevelopers.com' },
];

describe('resolveMentions', () => {
  it('resolves a full name', () => {
    expect(resolveMentions('can you check this @Sarah Chen', USERS)).toEqual(['u-sarah']);
  });

  it('prefers the LONGEST matching name', () => {
    // "Sara" is also a user. Matching shortest-first would mail the wrong person, and
    // the wrong person is worse than nobody.
    expect(resolveMentions('@Sarah Chen please review', USERS)).toEqual(['u-sarah']);
    expect(resolveMentions('@Sara please review', USERS)).toEqual(['u-sara']);
  });

  it('is case-insensitive', () => {
    expect(resolveMentions('@sarah chen', USERS)).toEqual(['u-sarah']);
    expect(resolveMentions('@SARAH CHEN', USERS)).toEqual(['u-sarah']);
  });

  it('tolerates trailing punctuation', () => {
    expect(resolveMentions('@Sarah Chen, can you look?', USERS)).toEqual(['u-sarah']);
    expect(resolveMentions('ping @Emily Park.', USERS)).toEqual(['u-emily']);
  });

  it('resolves an email local-part', () => {
    expect(resolveMentions('@sarah.chen take a look', USERS)).toEqual(['u-sarah']);
  });

  it('resolves several mentions, in first-appearance order', () => {
    expect(resolveMentions('@James Rivera and @Emily Park — see this', USERS))
      .toEqual(['u-james', 'u-emily']);
  });

  it('deduplicates a user named twice', () => {
    expect(resolveMentions('@Sara ... and again @Sara', USERS)).toEqual(['u-sara']);
  });

  it('ignores @ that matches nobody', () => {
    expect(resolveMentions('meet @2pm @here @everyone', USERS)).toEqual([]);
    expect(resolveMentions('email me at bob@example.com', USERS)).toEqual([]);
  });

  it('returns nothing for text with no @ at all', () => {
    expect(resolveMentions('Sarah Chen should review this', USERS)).toEqual([]);
  });

  it('handles an empty roster and empty content', () => {
    expect(resolveMentions('@Sarah Chen', [])).toEqual([]);
    expect(resolveMentions('', USERS)).toEqual([]);
  });

  it('does not run past a line break into the next name', () => {
    // "@Sarah\nChen" is a mention of Sarah (no such user) — not of Sarah Chen.
    expect(resolveMentions('@James Rivera\nEmily Park', USERS)).toEqual(['u-james']);
  });

  it('matches a name that appears mid-sentence', () => {
    expect(resolveMentions('I think @James Rivera owns the permit', USERS)).toEqual(['u-james']);
  });

  it('tolerates a user row with no name', () => {
    const users = [...USERS, { id: 'u-null', name: null, email: 'ghost@primedevelopers.com' }];
    expect(resolveMentions('@ghost hello', users)).toEqual(['u-null']);
    expect(resolveMentions('@Sarah Chen hi', users)).toEqual(['u-sarah']);
  });
});
