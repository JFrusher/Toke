'use client';

import { create } from 'zustand';

/**
 * Panel sizes and which bottom tab is showing.
 *
 * Persisted to localStorage rather than to the `.toke` file: a panel width is
 * a property of this person at this screen, not of the design, and carrying it
 * in the document would mean opening a colleague's file rearranges your studio.
 */

const KEY = 'toke.shell.v1';

export type BottomTab = 'data' | 'sql' | 'diagnostics';

type Persisted = {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly bottomHeight: number;
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
  readonly bottomOpen: boolean;
  readonly bottomTab: BottomTab;
};

const DEFAULTS: Persisted = {
  leftWidth: 224,
  rightWidth: 240,
  bottomHeight: 256,
  leftOpen: true,
  rightOpen: true,
  bottomOpen: false,
  bottomTab: 'data',
};

export const LIMITS = {
  left: { min: 160, max: 420 },
  right: { min: 200, max: 480 },
  bottom: { min: 120, max: 640 },
} as const;

/**
 * Reads the saved layout.
 *
 * Every access is guarded: localStorage throws outright in a private window
 * with site data blocked, and a studio that fails to boot because it could not
 * remember a panel width would be an absurd way to lose someone's work.
 */
function load(): Persisted {
  if (typeof window === 'undefined') return DEFAULTS;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function save(state: Persisted): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A layout that cannot be remembered is a nuisance, not a failure. It is
    // deliberately NOT reported to diagnostics, which is for the user's data.
  }
}

type ShellState = Persisted & {
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setBottomTab: (tab: BottomTab) => void;
  toggleBottom: () => void;
  /** Re-reads localStorage. Called once after mount — see `AppShell`. */
  hydrate: () => void;
};

/**
 * Starts from DEFAULTS, not from localStorage.
 *
 * Reading storage during module evaluation gives the server one layout and the
 * client another, and React 19 treats that as a hydration error. `hydrate()`
 * applies the saved sizes in an effect instead.
 */
export const useShellStore = create<ShellState>((set, get) => {
  function persist(patch: Partial<Persisted>) {
    set(patch);
    const { leftWidth, rightWidth, bottomHeight, leftOpen, rightOpen, bottomOpen, bottomTab } =
      get();
    save({ leftWidth, rightWidth, bottomHeight, leftOpen, rightOpen, bottomOpen, bottomTab });
  }

  return {
    ...DEFAULTS,

    setLeftWidth: (leftWidth) => persist({ leftWidth }),
    setRightWidth: (rightWidth) => persist({ rightWidth }),
    setBottomHeight: (bottomHeight) => persist({ bottomHeight }),
    toggleLeft: () => persist({ leftOpen: !get().leftOpen }),
    toggleRight: () => persist({ rightOpen: !get().rightOpen }),
    setBottomTab: (bottomTab) => persist({ bottomTab, bottomOpen: true }),
    toggleBottom: () => persist({ bottomOpen: !get().bottomOpen }),
    hydrate: () => set(load()),
  };
});
