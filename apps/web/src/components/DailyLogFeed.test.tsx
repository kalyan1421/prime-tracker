/**
 * What the update feed offers at each scope.
 *
 * This is conditional rendering driven by one optional prop, which is the kind of logic
 * that breaks silently: nothing throws when a unit-level post is offered a building
 * selector it must not have, and nothing throws when the weather field quietly disappears
 * from the project feed. The server would accept both.
 *
 * The rule under test: at UNIT scope the building selector must not exist, because the API
 * derives the building from the unit — offering the choice lets someone file a unit's
 * update under a building that unit is not in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyLogFeed } from './DailyLogFeed';

const created: any[] = [];
const state = {
  logs: [] as any[],
  permissions: ['dailylog:view', 'dailylog:edit'],
  lastQuery: {} as { projectId?: string; buildingId?: string; unitId?: string },
  stages: [] as any[],
};

vi.mock('../hooks/useApi', () => ({
  useDailyLogs: (projectId?: string, buildingId?: string, unitId?: string) => {
    state.lastQuery = { projectId, buildingId, unitId };
    return { data: state.logs, isLoading: false };
  },
  useCreateDailyLog: () => ({
    mutateAsync: (payload: any) => { created.push(payload); return Promise.resolve({ id: 'log1' }); },
    isPending: false,
  }),
  useDeleteDailyLog: () => ({ mutate: vi.fn(), isPending: false }),
  useAddDailyLogPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveDailyLogPhoto: () => ({ mutate: vi.fn(), isPending: false }),
  usePresignedUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBuildings: () => ({ data: [{ id: 'b1', name: 'Building One' }] }),
  useUnitConstructionStages: () => ({ data: state.stages }),
}) as any);

vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ hasPermission: (p: string) => state.permissions.includes(p) }),
}));

beforeEach(() => {
  created.length = 0;
  state.logs = [];
  state.permissions = ['dailylog:view', 'dailylog:edit'];
  state.stages = [];
});

const LOG = {
  id: 'l1', logDate: '2026-08-27T00:00:00.000Z', notes: 'Cabinets delivered.',
  author: { name: 'Demo PM' }, photos: [],
  building: { name: 'Building One' }, unit: { unitNumber: 'A-104' },
  weather: 'Sunny', crewCount: 4,
};

describe('DailyLogFeed — unit scope', () => {
  it('does not offer a building selector', () => {
    // The server derives the building from the unit; a selector here would let someone
    // file the update against a building the unit does not belong to.
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText(/Building \(optional\)/)).not.toBeInTheDocument();
  });

  it('drops weather and crew — they describe a site day, not one unit', () => {
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText('Weather')).not.toBeInTheDocument();
    expect(screen.queryByText('Crew')).not.toBeInTheDocument();
  });

  it('asks a unit-specific question', () => {
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText('What happened on this unit?')).toBeInTheDocument();
  });

  it('queries scoped to the unit', () => {
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(state.lastQuery).toMatchObject({ projectId: 'p1', unitId: 'u1' });
  });

  it('hides the unit chip on every row — they are all this unit', () => {
    state.logs = [LOG];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText('Unit A-104')).not.toBeInTheDocument();
  });

  it('tells an empty unit what to do', () => {
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText(/No updates on this unit yet/)).toBeInTheDocument();
  });
});

describe('DailyLogFeed — project scope', () => {
  it('still offers the building selector', () => {
    // getAllByText: HeroUI's Select renders its label twice (visible + a11y).
    render(<DailyLogFeed projectId="p1" />);
    expect(screen.getAllByText(/Building \(optional\)/).length).toBeGreaterThan(0);
  });

  it('still offers weather and crew', () => {
    render(<DailyLogFeed projectId="p1" />);
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('Crew')).toBeInTheDocument();
  });

  it('shows which unit a row belongs to', () => {
    state.logs = [LOG];
    render(<DailyLogFeed projectId="p1" />);
    expect(screen.getByText('Unit A-104')).toBeInTheDocument();
  });
});

describe('DailyLogFeed — read-only viewer', () => {
  it('offers no composer without dailylog:edit', () => {
    state.permissions = ['dailylog:view'];
    state.logs = [LOG];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText('What happened on this unit?')).not.toBeInTheDocument();
    expect(screen.getByText('Cabinets delivered.')).toBeInTheDocument();
  });
});

describe('DailyLogFeed — where an update came from', () => {
  const withSource = (source: string) => ({ ...LOG, id: 's-' + source, source });

  it('says nothing for a web post — the unremarkable default', () => {
    // A chip on every row buries the two that actually matter.
    state.logs = [withSource('WEB')];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText('From site')).not.toBeInTheDocument();
  });

  it('marks a post made from a phone', () => {
    state.logs = [withSource('MOBILE')];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText('From site')).toBeInTheDocument();
  });

  it('renders no marker for a channel that is not wired', () => {
    // EMAIL went with inbound ingestion. An unknown value must render nothing rather than
    // break the row, so restoring the channel is just an entry in SOURCE_MARKS.
    state.logs = [withSource('EMAIL')];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.getByText('Cabinets delivered.')).toBeInTheDocument();
  });

  it('renders an unknown source as no marker rather than breaking the row', () => {
    state.logs = [withSource('CARRIER_PIGEON')];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText('Cabinets delivered.')).toBeInTheDocument();
  });
});

describe('DailyLogFeed — threading and stage pinning', () => {
  const parent = (over: any = {}) => ({ ...LOG, id: 'p1', replies: [], ...over });

  it('offers a stage pin only once the unit has a checklist', () => {
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText(/Pin to stage/)).not.toBeInTheDocument();

    state.stages = [{ id: 's1', label: '08 - Rough Electrical' }];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getAllByText(/Pin to stage/).length).toBeGreaterThan(0);
  });

  it('never offers a stage pin at project scope', () => {
    // A site-wide log has no unit, so it has no stage to hang off.
    state.stages = [{ id: 's1', label: '08 - Rough Electrical' }];
    render(<DailyLogFeed projectId="p1" />);
    expect(screen.queryByText(/Pin to stage/)).not.toBeInTheDocument();
  });

  it('shows which stage an update was pinned to', () => {
    state.logs = [parent({ stage: { id: 's1', label: '08 - Rough Electrical' } })];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText('08 - Rough Electrical')).toBeInTheDocument();
  });

  it('renders replies under their parent', () => {
    state.logs = [parent({
      replies: [{ id: 'r1', logDate: LOG.logDate, notes: 'Confirmed with the foreman.', author: { name: 'Demo PM' }, photos: [] }],
    })];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getByText('Confirmed with the foreman.')).toBeInTheDocument();
  });

  it('offers Reply on a top-level update but NOT on a reply', () => {
    // One level only, matching the server rule — otherwise the UI invites a request the
    // API will reject.
    state.logs = [parent({
      replies: [{ id: 'r1', logDate: LOG.logDate, notes: 'Confirmed.', author: { name: 'Demo PM' }, photos: [] }],
    })];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getAllByText(/^Reply/)).toHaveLength(1);
  });

  it('offers no Reply at all to a read-only viewer', () => {
    state.permissions = ['dailylog:view'];
    state.logs = [parent()];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByText(/^Reply/)).not.toBeInTheDocument();
  });
});

describe('DailyLogFeed — the photo affordance', () => {
  const withPhotos = (n: number) => ({
    ...LOG, id: 'p-' + n,
    // A caption, so alt is non-empty — an <img alt=""> is presentational and does not carry
    // role="img", which is what makes getAllByRole('img') miss it.
    photos: Array.from({ length: n }, (_, i) => ({ id: 'ph' + i, url: 'blob:x', caption: `Site photo ${i}` })),
  });

  it('shows nothing photo-related on an update with no photos', () => {
    // An empty 80x80 upload box on every card is a lot of furniture for something most
    // updates never use. The first photo is attached in the composer.
    state.logs = [withPhotos(0)];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.queryByLabelText(/Add stage photo|^Photo$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Photo')).not.toBeInTheDocument();
  });

  it('shows the photos and an add button once there is at least one', () => {
    state.logs = [withPhotos(2)];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Photo')).toBeInTheDocument();
  });

  it('shows the photos but no add button to a read-only viewer', () => {
    state.permissions = ['dailylog:view'];
    state.logs = [withPhotos(1)];
    render(<DailyLogFeed projectId="p1" unitId="u1" />);
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Photo')).not.toBeInTheDocument();
  });
});
