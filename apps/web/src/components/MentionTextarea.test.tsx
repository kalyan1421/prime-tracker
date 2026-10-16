/**
 * The @mention search box shared by unit/project comments and the lead discussion.
 *
 * It had no tests before the lead thread started using it. The cases are the ones that
 * make a comment box feel broken when they fail: the list not narrowing as you type, a
 * pick that mangles surrounding text, Enter posting a half-written multi-line note, and
 * the Mention button not actually opening the search.
 */
import { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionTextarea, type MentionTextareaHandle } from './MentionTextarea';

const USERS = [
  { id: '1', name: 'Demo Founder', email: 'founder@prime.dev' },
  { id: '2', name: 'Demo Finance', email: 'finance@prime.dev' },
  { id: '3', name: 'Emily Park', email: 'emily@prime.dev' },
  { id: '4', name: 'James Rivera', email: 'james@prime.dev' },
  { id: '5', name: 'Mallik', email: 'mgilaka@prime.dev' },
];

function Harness(props: Partial<React.ComponentProps<typeof MentionTextarea>> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  const handle = useRef<MentionTextareaHandle>(null);
  return (
    <div>
      <MentionTextarea
        ref={handle}
        users={USERS}
        ariaLabel="Comment"
        value={value}
        onChange={setValue}
        {...props}
      />
      <button type="button" onClick={() => handle.current?.startMention()}>mention</button>
      <output data-testid="value">{value}</output>
    </div>
  );
}

const box = () => screen.getByLabelText('Comment') as HTMLTextAreaElement;
const options = () => screen.queryAllByRole('button').filter((b) => /@prime\.dev/.test(b.textContent ?? ''));
const value = () => screen.getByTestId('value').textContent;

describe('MentionTextarea', () => {
  it('opens a list on "@" and narrows it as you keep typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '@');
    expect(options()).toHaveLength(5);

    await user.type(box(), 'dem');
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('Demo Founder'), expect.stringContaining('Demo Finance'),
    ]);

    await user.type(box(), 'o fou');
    expect(options()).toHaveLength(1);
  });

  it('searches by email as well as name', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // "gilaka" is in Mallik's email, not his name.
    await user.type(box(), '@gilaka');
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Mallik');
  });

  it('closes when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '@zzz');
    expect(options()).toHaveLength(0);
  });

  it('does not open on an email address', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), 'write to bob@exa');
    expect(options()).toHaveLength(0);
  });

  it('inserts the full name at the @ without touching the rest of the text', async () => {
    const user = userEvent.setup();
    render(<Harness initial="hello  there" />);
    box().focus();
    box().setSelectionRange(6, 6);
    await user.keyboard('@emi');
    fireEvent.mouseDown(options()[0]);
    await waitFor(() => expect(value()).toBe('hello @Emily Park  there'));
  });

  it('picks with the keyboard: arrows move, Enter chooses', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '@dem');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(value()).toBe('@Demo Finance '));
  });

  it('Escape closes the list and leaves the text alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '@dem');
    expect(options().length).toBeGreaterThan(0);
    await user.keyboard('{Escape}');
    expect(options()).toHaveLength(0);
    expect(value()).toBe('@dem');
  });

  describe('submitOn', () => {
    it('"enter" (default): Enter submits, Shift+Enter is a newline', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<Harness onSubmit={onSubmit} />);
      await user.type(box(), 'hi{Shift>}{Enter}{/Shift}there');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(value()).toBe('hi\nthere');
      await user.keyboard('{Enter}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('"mod-enter": plain Enter stays a newline, Cmd/Ctrl+Enter submits', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<Harness onSubmit={onSubmit} submitOn="mod-enter" />);
      await user.type(box(), 'line one{Enter}line two');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(value()).toBe('line one\nline two');
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('Enter picks from an open list instead of submitting', async () => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<Harness onSubmit={onSubmit} submitOn="mod-enter" />);
      await user.type(box(), '@emi{Enter}');
      await waitFor(() => expect(value()).toBe('@Emily Park '));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('startMention puts an @ at the caret and opens the list', async () => {
    const user = userEvent.setup();
    render(<Harness initial="ping" />);
    await user.click(screen.getByText('mention'));
    await waitFor(() => expect(value()).toBe('ping @'));
    await waitFor(() => expect(options()).toHaveLength(5));
    await user.keyboard('jam');
    expect(options()).toHaveLength(1);
  });

  it('gives the box an accessible name', () => {
    render(<Harness />);
    expect(box()).toBeInTheDocument();
  });
});
