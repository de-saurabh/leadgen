import type { BookingStatus } from './api';

export interface BookingAction {
  status: BookingStatus;
  label: string;
  primary?: boolean;
}

/** What a person can do to a booking in each status (mirrors the API's allowed changes). */
export function actionsFor(status: BookingStatus): BookingAction[] {
  switch (status) {
    case 'pending':
      return [
        { status: 'confirmed', label: 'Approve', primary: true },
        { status: 'rejected', label: 'Decline' },
      ];
    case 'confirmed':
      return [
        { status: 'completed', label: 'Done' },
        { status: 'no_show', label: 'No-show' },
        { status: 'cancelled', label: 'Cancel' },
      ];
    default:
      return [];
  }
}
