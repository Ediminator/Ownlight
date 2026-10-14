'use client';

import * as React from 'react';
import { NavLinks } from './layout/nav-links';

export interface AppNavProps {
  onNavigate?: () => void;
  className?: string;
  newLeadsCount?: number;
}

/**
 * Primary app navigation for authenticated owner sessions (TASK-0031).
 * Displays navigation links including Leads with unread badge count.
 */
export function AppNav(props: AppNavProps) {
  return <NavLinks {...props} />;
}

export { NavLinks };
export default AppNav;
