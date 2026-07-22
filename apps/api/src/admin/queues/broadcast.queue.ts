export const BROADCAST_QUEUE_NAME = 'broadcast';
export const BROADCAST_JOB_NAME = 'broadcast';

// Just the id - the processor looks up the current message/target/targetValue
// from the Broadcast row at send time, rather than freezing them into the
// job payload. This matters for scheduled broadcasts: a user's tier/subjects
// can change between scheduling and send time, and re-reading the row means
// the send always reflects who currently matches, not who matched when it
// was scheduled.
export interface BroadcastJobPayload {
  broadcastId: string;
}
