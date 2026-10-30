/** Socket.IO event names shared by the API gateway and the clients (see SOURCE_OF_TRUTH §6). */
export const WS_EVENTS = {
  presenceChanged: 'presence:changed',
  messageNew: 'message:new',
  messageUpdated: 'message:updated',
  messageDeleted: 'message:deleted',
  reactionChanged: 'reaction:changed',
  typing: 'typing',
  readUpdated: 'read:updated',
  /** Repeated every 2 minutes for 20 minutes to recipients who haven't read an urgent message. */
  messageUrgentReminder: 'message:urgent_reminder',
  scheduledUpdated: 'scheduled:updated',
  sectionsUpdated: 'sections:updated',
  savedUpdated: 'saved:updated',
  callIncoming: 'call:incoming',
  callAccepted: 'call:accepted',
  callDeclined: 'call:declined',
  callEnded: 'call:ended',
  callParticipantJoined: 'call:participant_joined',
  callParticipantLeft: 'call:participant_left',
  callUpdated: 'call:updated',
  callTransferred: 'call:transferred',
  voicemailNew: 'voicemail:new',
  meetingLobby: 'meeting:lobby',
  meetingAdmitted: 'meeting:admitted',
  /** Meeting created / edited / cancelled / RSVP changed: refresh calendars. */
  meetingChanged: 'meeting:changed',
  /** Live state of an in-progress meeting (lobby, hands, lock, roster). */
  meetingUpdated: 'meeting:updated',
  meetingReminder: 'meeting:reminder',
  /** Polls / Q&A / recordings of a meeting changed (refetch). */
  meetingActivity: 'meeting:activity',
  /** Organizer message to everyone in breakout rooms. */
  meetingBroadcast: 'meeting:broadcast',
  /** Whiteboard (Yjs over Socket.IO): join → full state; update ↔ incremental updates; leave. */
  whiteboardJoin: 'whiteboard:join',
  whiteboardUpdate: 'whiteboard:update',
  whiteboardAwareness: 'whiteboard:awareness',
  whiteboardLeave: 'whiteboard:leave',
  notificationNew: 'notification:new',
  channelUpdated: 'channel:updated',
  teamUpdated: 'team:updated',
  conversationUpdated: 'conversation:updated',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
