/**
 * The estimate grid shows its lines in cost-code order with uncoded lines last (client,
 * 2026-11-02), while the new-line row still copies the code of the line added most recently.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InteriorEstimatePanel } from './InteriorEstimatePanel';

const codes = [
  { id: 'c0125', code: '01.25', name: 'Equipment Rental', groupCode: '02', groupName: 'BUSINESS OPERATIONS', sortOrder: 10, active: true },
  { id: 'c0220', code: '02.20', name: 'Design/Value Engineering', groupCode: '02', groupName: 'BUSINESS OPERATIONS', sortOrder: 20, active: true },
  { id: 'c1330', code: '13.30', name: 'Interior Doors', groupCode: '13', groupName: 'WINDOWS & DOORS', sortOrder: 130, active: true },
];

vi.mock('../hooks/useApi', () => ({
  useInteriorCostCodes: () => ({ data: codes }),
  useInteriorCostingSettings: () => ({ data: { lockRoles: [], unlockRoles: [] } }),
  useSaveEstimateLine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveEstimateLine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEstimateAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}) as any);

// Created in this order: a, b, c, d, e — b and d have no code.
const line = (id: string, costCodeId: string | null) => ({
  id, costCodeId, costCode: null, description: `desc-${id}`, quantity: 1, unit: 'ls', unitPrice: 10, total: 10,
  costType: 'Other', supplier: null, paidBy: 'PRIME',
});
const costing = {
  id: 'ip1', area: 100, can: { editEstimate: true },
  estimate: { status: 'DRAFT', total: 50, lines: [line('a', 'c1330'), line('b', null), line('c', 'c0125'), line('d', null), line('e', 'c0220')] },
};

describe('InteriorEstimatePanel — line order', () => {
  it('shows coded lines in code order and uncoded lines at the bottom', () => {
    render(<InteriorEstimatePanel costing={costing} />);
    const shown = (screen.getAllByDisplayValue(/^desc-/) as HTMLInputElement[]).map((i) => i.value);
    expect(shown).toEqual(['desc-c', 'desc-e', 'desc-a', 'desc-b', 'desc-d']);
  });

  it('the new-line row copies the code of the most recently ADDED line, not the last one shown', () => {
    render(<InteriorEstimatePanel costing={costing} />);
    // Last created is e (02.20). Last SHOWN is d (no code) — which would have blanked it.
    const sel = screen.getByLabelText('New line cost code') as HTMLSelectElement;
    expect(sel.selectedOptions[0].textContent).toMatch(/02\.20/);
  });
});
