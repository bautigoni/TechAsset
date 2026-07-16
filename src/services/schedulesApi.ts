import type { RecessGroup, TeacherScheduleEntry } from '../types';
import { apiGet, apiSend } from './apiClient';

export const getTeacherSchedules = () => apiGet<{ ok: true; items: TeacherScheduleEntry[]; current: TeacherScheduleEntry[]; clock: { day: number; time: string } }>('/api/teacher-schedules');
export const createTeacherSchedule = (payload: Partial<TeacherScheduleEntry>) => apiSend<{ ok: true; item: TeacherScheduleEntry }>('/api/teacher-schedules', 'POST', payload);
export const updateTeacherSchedule = (id: number, payload: Partial<TeacherScheduleEntry>) => apiSend<{ ok: true; item: TeacherScheduleEntry }>(`/api/teacher-schedules/${id}`, 'PATCH', payload);
export const deleteTeacherSchedule = (id: number) => apiSend<{ ok: true; deleted: boolean }>(`/api/teacher-schedules/${id}`, 'DELETE');
export const getRecessSchedules = () => apiGet<{ ok: true; groups: RecessGroup[]; active: Array<{ groupName: string; label: string; startTime: string; endTime: string }>; canConfigure: boolean }>('/api/recess-schedules');
export const saveRecessSchedules = (groups: RecessGroup[]) => apiSend<{ ok: true; groups: RecessGroup[] }>('/api/recess-schedules', 'PUT', { groups });
