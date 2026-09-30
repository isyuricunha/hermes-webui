import { createContext, useContext } from 'react';

/**
 * The phone app bar hosts page-specific content (the open conversation's
 * title and actions). AppShell provides the element; pages portal into it.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext);
}
