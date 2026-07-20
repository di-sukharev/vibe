export const DASHBOARD_WIDE_BREAKPOINT = 960;
export const NAVIGATION_RAIL_WIDTH = 232;

export function dashboardNavigationMode(width: number): 'tabs' | 'rail' {
  return width >= DASHBOARD_WIDE_BREAKPOINT ? 'rail' : 'tabs';
}

export function accountInitials(displayName: string | null, email: string) {
  const source = displayName?.trim() || email.trim().split('@')[0] || '';
  const words = source.split(/\s+/).filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return `${words[0]![0]}${words.at(-1)![0]}`.toUpperCase();
}
