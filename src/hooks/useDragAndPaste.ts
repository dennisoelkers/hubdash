import { useEffect, useRef, useState } from 'react';
import { textFrom } from '../domain/dropText';
import { isEditable } from './isEditable';

/**
 * The window-wide entry points for adding a PR: dropping a link from another
 * tab, and pasting with nothing focused. Both hand their text to the same
 * callback the Add dialog uses.
 */
export function useDragAndPaste(onText: (text: string) => void): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  // A depth counter, not a boolean. Dragging across the page fires a
  // `dragleave` for the element being left paired with a `dragenter` for the
  // one being entered, so a boolean set false on every leave would drop the
  // overlay and put it straight back — a flicker on every child the pointer
  // crosses. Counting enters against leaves means the overlay disappears only
  // when the drag has actually left the window.
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
