export interface NavigationGuardState {
  active: boolean;
}

export function createNavigationGuardState(): NavigationGuardState {
  return { active: false };
}
