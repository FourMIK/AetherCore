/**
 * Workspaces
 * Workspace mode definitions and exports
 */

export type WorkspaceMode = 'commander' | 'operator' | 'admin' | 'fleet';

export const workspaceConfig = {
  commander: {
    title: 'Commander',
    description: 'Strategic command and control',
    permissions: ['view', 'command', 'approve'],
  },
  operator: {
    title: 'Operator',
    description: 'Tactical operations',
    permissions: ['view', 'command'],
  },
  admin: {
    title: 'Admin',
    description: 'System administration',
    permissions: ['view', 'configure', 'manage'],
  },
  fleet: {
    title: 'Fleet',
    description: 'Fleet-wide overview',
    permissions: ['view'],
  },
};
