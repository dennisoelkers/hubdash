/** A text/uri-list may carry comment lines beginning with '#'. */
export function firstUri(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed;
  }
  return '';
}

/**
 * Extracts a pastable/droppable string from a drag or clipboard payload.
 * `text/uri-list` is preferred over `text/plain`, because a dragged link
 * supplies both and the plain-text version is sometimes the link's visible
 * label rather than its href.
 */
export function textFrom(transfer: DataTransfer | null | undefined): string {
  if (!transfer) return '';
  const uriList = transfer.getData('text/uri-list');
  if (uriList.trim() !== '') return firstUri(uriList);
  return transfer.getData('text/plain').trim();
}
