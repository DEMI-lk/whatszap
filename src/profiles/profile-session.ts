import { ProfileMeta, ProfileState } from '../shared/types';

/**
 * Per-profile lifecycle record. States:
 *   DESTROYED  no WebContents; persistent session safe on disk
 *   LOADING    view created, WhatsApp Web loading
 *   ACTIVE     attached to the window, focused
 *   SUSPENDED  warm but detached, muted, throttled
 */
export class ProfileSession {
  state: ProfileState = 'destroyed';
  unread = 0;
  lastActiveAt = 0;
  lastUnreadNotifiedAt = 0;

  constructor(public readonly meta: ProfileMeta) {}

  get id(): string {
    return this.meta.id;
  }
}

/** Pure state-machine bookkeeping shared by the profile manager. */
export function transition(
  session: ProfileSession,
  next: ProfileState,
): void {
  if (session.state === next) return;
  const allowed: Record<ProfileState, ProfileState[]> = {
    destroyed: ['loading'],
    loading: ['active', 'suspended', 'destroyed'],
    active: ['suspended', 'destroyed', 'loading'],
    suspended: ['loading', 'destroyed', 'active'],
  };
  if (!allowed[session.state].includes(next)) {
    throw new Error(`Invalid transition ${session.state} -> ${next} for ${session.id}`);
  }
  if (next === 'active') session.lastActiveAt = Date.now();
  session.state = next;
}
