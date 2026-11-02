import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostCodeSelect, sortEstimateLines, type CostCode } from './InteriorCostingParts';

const code = (id: string, name: string, sortOrder: number, extra: Partial<CostCode> = {}): CostCode => ({
  id, code: null, name, groupCode: null, groupName: 'Trades', sortOrder, active: true, ...extra,
});
const codes = [code('a', 'Framing', 1), code('b', 'Paint', 2)];
const optionTexts = (el: HTMLElement) => Array.from(el.querySelectorAll('option')).map((o) => o.textContent);

describe('CostCodeSelect', () => {
  it('lists "No cost code" LAST, after every real code', () => {
    render(<CostCodeSelect label="Cost code" value={null} codes={codes} onChange={() => {}} />);
    expect(optionTexts(screen.getByLabelText('Cost code'))).toEqual(['Framing', 'Paint', 'No cost code']);
  });

  it('still shows "No cost code" as the selected value while no code is picked', () => {
    render(<CostCodeSelect label="Cost code" value={null} codes={codes} onChange={() => {}} />);
    expect((screen.getByLabelText('Cost code') as HTMLSelectElement).selectedOptions[0].textContent).toBe('No cost code');
  });

  it('shows the picked code when there is one', () => {
    render(<CostCodeSelect label="Cost code" value="b" codes={codes} onChange={() => {}} />);
    expect((screen.getByLabelText('Cost code') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Paint');
  });

  it('omits the option entirely when allowNone is false', () => {
    render(<CostCodeSelect label="Cost code" value="a" codes={codes} onChange={() => {}} allowNone={false} />);
    expect(optionTexts(screen.getByLabelText('Cost code'))).toEqual(['Framing', 'Paint']);
  });
});

describe('sortEstimateLines', () => {
  const order = [{ id: 'c0125', sortOrder: 10 }, { id: 'c0220', sortOrder: 20 }, { id: 'c1330', sortOrder: 130 }];
  const ln = (id: string, costCodeId: string | null) => ({ id, costCodeId });
  const ids = (l: { id: string }[]) => l.map((x) => x.id);

  it('puts coded lines in cost-code order and every uncoded line last', () => {
    const lines = [ln('a', null), ln('b', null), ln('c', 'c0220'), ln('d', 'c0125'), ln('e', 'c0125'), ln('f', 'c1330')];
    expect(ids(sortEstimateLines(lines, order))).toEqual(['d', 'e', 'c', 'f', 'a', 'b']);
  });

  it('keeps lines on the same code in their original order', () => {
    const lines = [ln('x', 'c0220'), ln('y', 'c0220'), ln('z', 'c0220')];
    expect(ids(sortEstimateLines(lines, order))).toEqual(['x', 'y', 'z']);
  });

  it('puts a code it does not know after the known ones but before the uncoded', () => {
    const lines = [ln('a', null), ln('b', 'gone'), ln('c', 'c1330')];
    expect(ids(sortEstimateLines(lines, order))).toEqual(['c', 'b', 'a']);
  });

  it('only pulls the uncoded lines down while the codes are still loading', () => {
    const lines = [ln('a', null), ln('b', 'c0220'), ln('c', 'c0125')];
    expect(ids(sortEstimateLines(lines, []))).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate its input', () => {
    const lines = [ln('a', null), ln('b', 'c0125')];
    sortEstimateLines(lines, order);
    expect(ids(lines)).toEqual(['a', 'b']);
  });
});
