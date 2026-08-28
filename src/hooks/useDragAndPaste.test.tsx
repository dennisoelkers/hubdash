import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDragAndPaste } from './useDragAndPaste';

function Probe({ onText }: { onText: (text: string) => void }) {
  const { isDragging } = useDragAndPaste(onText);
  return <div data-testid="probe" data-dragging={isDragging ? 'true' : 'false'} />;
}

function dataTransfer(types: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(types),
    getData: (type: string) => types[type] ?? '',
  } as unknown as DataTransfer;
}

function fire(type: string, init: Partial<DragEvent> & { dataTransfer?: DataTransfer } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('useDragAndPaste — dragging', () => {
  it('reports dragging between dragenter and dragleave', () => {
    render(<Probe onText={() => {}} />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-dragging', 'false');

    fire('dragenter', { dataTransfer: dataTransfer({ 'text/uri-list': '' }) });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-dragging', 'true');

    fire('dragleave');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-dragging', 'false');
  });

  it('stops reporting dragging after a drop', () => {
    render(<Probe onText={() => {}} />);
    fire('dragenter', { dataTransfer: dataTransfer({ 'text/uri-list': 'x' }) });
    fire('drop', { dataTransfer: dataTransfer({ 'text/uri-list': 'x' }) });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-dragging', 'false');
  });

  it('prevents the default on dragover so the browser allows a drop', () => {
    render(<Probe onText={() => {}} />);
    const event = fire('dragover', { dataTransfer: dataTransfer({ 'text/uri-list': '' }) });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('useDragAndPaste — extracting the text', () => {
  it('prefers text/uri-list on drop', () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    fire('drop', {
      dataTransfer: dataTransfer({
        'text/uri-list': 'https://github.com/a/b/pull/1',
        'text/plain': 'something else',
      }),
    });
    expect(onText).toHaveBeenCalledWith('https://github.com/a/b/pull/1');
  });

  it('falls back to text/plain on drop', () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    fire('drop', { dataTransfer: dataTransfer({ 'text/plain': 'https://github.com/a/b/pull/2' }) });
    expect(onText).toHaveBeenCalledWith('https://github.com/a/b/pull/2');
  });

  it('ignores the comment lines browsers put in a uri-list', () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    fire('drop', {
      dataTransfer: dataTransfer({
        'text/uri-list': '# comment\nhttps://github.com/a/b/pull/3\n',
      }),
    });
    expect(onText).toHaveBeenCalledWith('https://github.com/a/b/pull/3');
  });

  it('does not call back for an empty drop', () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    fire('drop', { dataTransfer: dataTransfer({ 'text/plain': '   ' }) });
    expect(onText).not.toHaveBeenCalled();
  });

  it('handles a paste', () => {
    const onText = vi.fn();
    render(<Probe onText={onText} />);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: dataTransfer({ 'text/plain': 'https://github.com/a/b/pull/4' }),
    });
    act(() => void document.dispatchEvent(event));
    expect(onText).toHaveBeenCalledWith('https://github.com/a/b/pull/4');
  });

  it('ignores a paste while a text field has focus', () => {
    const onText = vi.fn();
    render(
      <>
        <Probe onText={onText} />
        <input data-testid="field" />
      </>,
    );
    const field = screen.getByTestId('field');
    field.focus();

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: dataTransfer({ 'text/plain': 'https://github.com/a/b/pull/5' }),
    });
    // Dispatch on the field, not the document: a real browser targets the
    // focused element, and the event bubbles to our document-level listener.
    act(() => void field.dispatchEvent(event));

    // Otherwise pasting into the Add dialog would also add via this path.
    expect(onText).not.toHaveBeenCalled();
  });
});
