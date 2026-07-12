/**
 * Moves focus to the next ion-input/ion-textarea/ion-select in the same form
 * (or ion-content, if there's no wrapping <form>). If the next field is a
 * select, opens its picker immediately. If there's no next field, submits
 * the enclosing form instead.
 */
export async function focusNextField(current: HTMLElement): Promise<void> {
  const scope: ParentNode = current.closest('form') ?? current.closest('ion-content') ?? document.body;
  const focusables = Array.from(scope.querySelectorAll('ion-input, ion-textarea, ion-select')) as HTMLElement[];
  const index = focusables.indexOf(current);
  if (index === -1) return;

  const next = focusables[index + 1] as (HTMLElement & { setFocus?: () => Promise<void>; open?: (event?: Event) => Promise<unknown> }) | undefined;

  if (!next) {
    const form = current.closest('form') as HTMLFormElement | null;
    const input = current as HTMLElement & { getInputElement?: () => Promise<HTMLElement> };
    const inner = await input.getInputElement?.().catch(() => undefined);
    inner?.blur();
    form?.requestSubmit();
    return;
  }

  next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (next.tagName === 'ION-SELECT') {
    await next.open?.();
  } else {
    await next.setFocus?.();
  }
}
