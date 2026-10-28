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
  meetingLobby: 'meeting:lobby',
  meetingAdmitted: 'meeting:admitted',
  notificationNew: 'notification:new',
  channelUpdated: 'channel:updated',
  teamUpdated: 'team:updated',
  conversationUpdated: 'conversation:updated',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
