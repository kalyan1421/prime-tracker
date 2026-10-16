/**
 * The Site Tracker's typed "Next action" (client, 2026-10-16 — the monday column was
 * AI-written; the AI layer was cut in August, so the team types it here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextActionCell } from './NextActionCell';

const saved: any[] = [];
vi.mock('../hooks/useApi', () => ({
  useUpdateSiteTracker: () => ({ mutate: (p: any) => saved.push(p), isPending: false }),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const row = (nextAction: any = null) => ({ id: 'u103', label: 'Unit 103', nextAction });

beforeEach(() => { saved.length = 0; });

describe('NextActionCell', () => {
  it('shows the text with who wrote it', () => {
    render(<NextActionCell row={row({ text: 'Book the framing inspection', at: daysAgo(1), by: { id: 'v', name: 'Victor R' } })} canEdit />);
    expect(screen.getByText('Book the framing inspection')).toBeInTheDocument();
    expect(screen.getByText('Victor R')).toBeInTheDocument();
  });

  it('flags a plan nobody has touched for a week', () => {
    render(<NextActionCell row={row({ text: 'Order trim', at: daysAgo(12), by: null })} canEdit />);
    const age = screen.getByText('12d old');
    expect(age.className).toContain('text-amber-700');
  });

  it('edits in place: Enter saves the trimmed text', () => {
    render(<NextActionCell row={row()} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a next action for Unit 103' }));
    const box = screen.getByLabelText('Next action for Unit 103');
    fireEvent.change(box, { target: { value: '  Install rooftop unit Monday  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(saved).toEqual([{ unitId: 'u103', data: { siteNextAction: 'Install rooftop unit Monday' } }]);
  });

  it('clearing the box clears the next action', () => {
    render(<NextActionCell row={row({ text: 'Order trim', at: daysAgo(1), by: null })} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Next action for Unit 103: Order trim/ }));
    const box = screen.getByLabelText('Next action for Unit 103');
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.blur(box);
    expect(saved).toEqual([{ unitId: 'u103', data: { siteNextAction: null } }]);
  });

  it('Escape cancels, and an unchanged save sends nothing', () => {
    render(<NextActionCell row={row({ text: 'Order trim', at: daysAgo(1), by: null })} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Order trim/ }));
    fireEvent.keyDown(screen.getByLabelText('Next action for Unit 103'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Order trim/ }));
    fireEvent.keyDown(screen.getByLabelText('Next action for Unit 103'), { key: 'Enter' });
    expect(saved).toEqual([]);
  });

  it('is read-only without siteTracker:edit', () => {
    render(<NextActionCell row={row({ text: 'Order trim', at: daysAgo(1), by: null })} canEdit={false} />);
    expect(screen.getByText('Order trim')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
