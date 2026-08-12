import { apiGet, apiSend } from './apiClient';

export interface TenantUser {
  id: number;
  email: string;
  nombre: string;
  siteRole: string;
  turno: string;
  status: 'Pendiente' | 'Activo' | 'Rechazado' | 'Inactivo' | string;
  activo: boolean;
  lastLoginAt: string;
  esSuperadmin: boolean;
}

export interface TenantInvite {
  id: number;
  code: string;
  email: string;
  role: string;
  turno: string;
  kind: string;
  status: 'Activa' | 'Usada' | 'Vencida' | 'Revocada' | string;
  expiresAt: string;
  createdAt: string;
  emailSentAt: string;
  emailError: string;
}

export interface TenantUsers {
  siteCode: string;
  nombre: string;
  subtitulo: string;
  activo: boolean;
  users: TenantUser[];
  invites: TenantInvite[];
  total: number;
  activos: number;
  pendientes: number;
  admins: number;
  invitacionesActivas: number;
}

export interface UsersByTenantResponse {
  ok: true;
  tenants: TenantUsers[];
  sinSede: TenantUser[];
  totales: { usuarios: number; pendientes: number; tenants: number };
}

export const getUsersByTenant = () => apiGet<UsersByTenantResponse>('/api/admin/users-by-tenant');

export type AllowedUserAction = 'approve' | 'reject' | 'deactivate' | 'delete';
export const runUserAction = (id: number, action: AllowedUserAction) =>
  apiSend<{ ok: true }>(`/api/allowed-users/${id}/${action}`, 'POST');
