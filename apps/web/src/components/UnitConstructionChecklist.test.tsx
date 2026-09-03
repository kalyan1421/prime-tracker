/**
 * Stage names come from the construction_stage catalogue, not from whatever has already
 * been typed nearby.
 *
 * The old picker derived its options from labels already recorded in the same project, so
 * on a project that had not used the feature it offered nothing and collapsed to a bare
 * text box — and where it HAD been used, every typo became a permanent, selectable option.
 * Four rival numbering schemes and two junk rows later, that is the behaviour under test
 * here: the list is the catalogue, and the free-text path is an escape hatch rather than
 * the default door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnitConstructionChecklist } from './UnitConstructionChecklist';

const added: any[] = [];
const addedBatches: any[] = [];
let catalogue: any[] = [];
/** Mirrors the real hook's first render, where the fetch has not resolved yet. */
let catalogueLoading = false;

vi.mock('../hooks/useApi', () => ({
  useUnitConstructionStages: () => ({
    data: [{ id: 'st1', label: 'Slab Pour', stageValue: 'SLAB_POUR', status: 'NOT_STARTED', sortOrder: 0, photos: [] }],
    isLoading: false,
  }),
  useStageCatalogue: () => ({ data: catalogueLoading ? undefined : catalogue, isLoading: catalogueLoading }),
  useConstructionTemplate: () => ({ data: [] }),
  useApplyConstructionTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddUnitConstructionStage: () => ({
    mutateAsync: (p: any) => { added.push(p); return Promise.resolve({}); }, isPending: false,
  }),
  useAddUnitConstructionStages: () => ({
    mutateAsync: (p: any) => { addedBatches.push(p); return Promise.resolve({ added: p.labels.length }); },
    isPending: false,
  }),
  useUpdateConstructionStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderUnitConstructionStages: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConstructionStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCustomOptions: () => ({ data: [{ value: 'NOT_STARTED', label: 'Not Started' }] }),
  useUsers: () => ({ data: [] }),
  useAddStagePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveStagePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePresignedUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateDailyLog: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDailyLogs: () => ({ data: { logs: [] } }),
}) as any);

const CATALOGUE = [
  { value: 'SOIL_COMPACTION', label: 'Soil Compaction' },
  { value: 'SLAB_POUR', label: 'Slab Pour' },
  { value: 'STORE_FRONT_GLASS', label: 'Store Front Glass' },
];

beforeEach(() => {
  added.length = 0;
  addedBatches.length = 0;
  catalogue = CATALOGUE;
  catalogueLoading = false;
});

async function openAddStage() {
  render(<UnitConstructionChecklist unitId="u1" canEdit />);
  fireEvent.click(await screen.findByRole('button', { name: /add stage/i }));
  return screen.findByText('Add a stage');
}

describe('Add a stage — the picker', () => {
  it('offers the catalogue minus what this unit already has', async () => {
    await openAddStage();

    expect(await screen.findByText('Soil Compaction')).toBeTruthy();
    expect(screen.getByText('Store Front Glass')).toBeTruthy();
    // Slab Pour is already on the unit, so offering it again is offering a no-op.
    expect(screen.getByText(/0 of 2 selected/)).toBeTruthy();
  });

  it('opens on the picker even though the catalogue is empty on the first render', async () => {
    // Regression: seeding the mode from available.length at mount read a still-loading
    // catalogue as "nothing to pick", so the modal opened on the one-off tab every time
    // and the escape hatch became the default way to name a stage.
    catalogueLoading = true;
    const view = render(<UnitConstructionChecklist unitId="u1" canEdit />);
    fireEvent.click(await screen.findByRole('button', { name: /add stage/i }));

    catalogueLoading = false;
    catalogue = CATALOGUE;
    view.rerender(<UnitConstructionChecklist unitId="u1" canEdit />);

    await waitFor(() => expect(screen.getByText(/0 of 2 selected/)).toBeTruthy());
  });

  it('sends the picked labels in catalogue order, not click order', async () => {
    await openAddStage();
    fireEvent.click(await screen.findByText('Store Front Glass'));
    fireEvent.click(screen.getByText('Soil Compaction'));
    fireEvent.click(screen.getByRole('button', { name: /add 2 stages/i }));

    await waitFor(() => expect(addedBatches).toHaveLength(1));
    expect(addedBatches[0].labels).toEqual(['Soil Compaction', 'Store Front Glass']);
  });
});

describe('Add a stage — the one-off escape hatch', () => {
  it('warns when a typed name is a near miss for a catalogue stage', async () => {
    await openAddStage();
    fireEvent.click(screen.getByRole('button', { name: /one-off stage/i }));
    fireEvent.change(screen.getByLabelText(/one-off name/i), { target: { value: 'Storefront glass' } });

    // The exact failure this feature exists to stop: one stage, three spellings, and a
    // rollup that can never group them.
    expect(await screen.findByText(/already has/i)).toBeTruthy();
    expect(screen.getByText('“Store Front Glass”')).toBeTruthy();
  });

  it('stays quiet for work that genuinely is not on the list', async () => {
    await openAddStage();
    fireEvent.click(screen.getByRole('button', { name: /one-off stage/i }));
    fireEvent.change(screen.getByLabelText(/one-off name/i), { target: { value: 'Temporary hoarding' } });

    expect(screen.queryByText(/already has/i)).toBeNull();
  });

  it('offers the catalogue as a dropdown, so a single stage need not be retyped', async () => {
    // The one-off tab used to be a bare text box, so adding ONE catalogue stage with its
    // owner/status/dates was impossible: the multi-select tab cannot set per-stage fields,
    // and this tab could not reach the catalogue.
    await openAddStage();
    fireEvent.click(screen.getByRole('button', { name: /one-off stage/i }));

    // Queried through the trigger's placeholder rather than getByLabelText: HeroUI's
    // Select renders its label against a hidden input, so the label query misses the
    // button a user actually clicks.
    fireEvent.click(await screen.findByText('Choose a stage'));

    // Slab Pour is already on the unit and stays out of the dropdown too.
    expect(await screen.findByRole('option', { name: 'Soil Compaction' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Slab Pour' })).toBeNull();
  });

  it('does not cry wolf about a name chosen FROM the list', async () => {
    // "The stage list already has Store Front Glass" about the Store Front Glass just
    // selected from that list is the near-miss warning firing on its own suggestion.
    await openAddStage();
    fireEvent.click(screen.getByRole('button', { name: /one-off stage/i }));

    fireEvent.click(await screen.findByText('Choose a stage'));
    fireEvent.click(await screen.findByRole('option', { name: 'Store Front Glass' }));

    await waitFor(() => expect(screen.queryByText(/already has/i)).toBeNull());
  });

  it('refuses a name already on this unit', async () => {
    await openAddStage();
    fireEvent.click(screen.getByRole('button', { name: /one-off stage/i }));
    fireEvent.change(screen.getByLabelText(/one-off name/i), { target: { value: 'slab pour' } });
    fireEvent.click(screen.getByRole('button', { name: /^add stage$/i }));

    expect(await screen.findByText(/already on this unit/i)).toBeTruthy();
    expect(added).toHaveLength(0);
  });
});
