// Admin roles — the same table as backend/app/admin/roles.py. The screens only hide sections; the server checks.
export const ROLES = {
  owner: { label: 'Owner', can: ['dashboard', 'orders', 'experts', 'refunds', 'payments', 'customers', 'quality', 'reports', 'settings', 'automation', 'team', 'organizations'] },
  ops: { label: 'Operations', can: ['dashboard', 'orders', 'experts', 'quality', 'automation'] },
  finance: { label: 'Finance', can: ['dashboard', 'payments', 'refunds', 'reports'] },
  support: { label: 'Support', can: ['orders', 'customers', 'refunds'] },
  quality: { label: 'Quality reviewer', can: ['orders', 'quality'] },
};
