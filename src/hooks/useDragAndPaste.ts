import { useEffect, useRef, useState } from 'react';

function firstUri(raw: string): string {
  // A text/uri-list may carry comment lines beginning with '#'.
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed;
  }
  return '';
}

function textFrom(transfer: DataTransfer | null | undefined): string {
  if (!transfer) return '';
  const uriList = transfer.getData('text/uri-list');
  if (uriList.trim() !== '') return firstUri(uriList);
  return transfer.getData('text/plain').trim();
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/**
 * The window-wide entry points for adding a PR: dropping a link from another
 * tab, and pasting with nothing focused. Both hand their text to the same
 * callback the Add dialog uses.
 */
export function useDragAndPaste(onText: (text: string) => void): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      // Without this the browser refuses the drop entirely.
      event.preventDefault();
    };

    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const text = textFrom(event.dataTransfer);
      if (text !== '') onTextRef.current(text);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isEditable(event.target)) return;
      const text = textFrom(event.clipboardData);
      if (text !== '') onTextRef.current(text);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return { isDragging };
}
