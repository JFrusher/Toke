/**
 * True when an event came from somewhere the user is typing.
 *
 * Global shortcuts must not steal keys from a text field: typing "r" in a
 * guest's name should not switch to the rectangle tool, and space belongs to
 * the sentence rather than to the pan gesture. Fabric's own canvas text editor
 * is a real `<textarea>`, so it is covered by the same check.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
