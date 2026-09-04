/**
 * Whether a key event's target is somewhere the user is typing text.
 *
 * `=== true` rather than a bare truthy check: jsdom's `isContentEditable`
 * getter can return `undefined` for an ordinary element rather than `false`
 * (verified empirically — real browsers always return a boolean), and this
 * function's whole contract is to never mistake "not editable" for "unknown".
 */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable === true
  );
}
