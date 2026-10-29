import { Notification } from 'electron';
import type { DesktopNotification, IncomingCallToast } from '@teamsphere/shared';
import { PROTOCOL } from './links';

const xml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

const callToasts = new Map<string, Notification>();

export function showNotification(n: DesktopNotification, onClick: (path?: string) => void) {
  if (!Notification.isSupported()) return;
  const toast = new Notification({ title: n.title, body: n.body, silent: n.silent });
  toast.on('click', () => onClick(n.path));
  toast.show();
}

/**
 * Incoming-call toast with Accept / Accept audio / Decline buttons. Silent: the web app already plays its ringtone
 * (on the user's chosen speaker) for as long as the call rings, and two looping sounds would clash.
 * Buttons use protocol activation (teamsphere://call/...), which reaches the running app through
 * the single-instance "second-instance" event — see deep-links.ts.
 */
export function showIncomingCall(call: IncomingCallToast, onClick: () => void) {
  if (!Notification.isSupported()) return;
  dismissIncomingCall(call.callId);
  const id = encodeURIComponent(call.callId);
  const link = (action: string) => `${PROTOCOL}://call/${action}?id=${id}`;

  const toastXml = `
<toast launch="${xml(link('open'))}" activationType="protocol" scenario="incomingCall" duration="long">
  <visual>
    <binding template="ToastGeneric">
      <text>${xml(call.callerName)}</text>
      <text>Incoming ${call.video ? 'video' : 'audio'} call</text>
    </binding>
  </visual>
  <actions>
    ${call.video ? `<action content="Video" arguments="${xml(link('accept'))}" activationType="protocol"/>` : ''}
    <action content="${call.video ? 'Audio' : 'Accept'}" arguments="${xml(link(call.video ? 'accept-audio' : 'accept'))}" activationType="protocol"/>
    <action content="Decline" arguments="${xml(link('decline'))}" activationType="protocol"/>
  </actions>
  <audio silent="true"/>
</toast>`;

  const toast = new Notification({ toastXml });
  toast.on('click', onClick);
  toast.on('close', () => callToasts.delete(call.callId));
  callToasts.set(call.callId, toast);
  toast.show();
}

export function dismissIncomingCall(callId: string) {
  callToasts.get(callId)?.close();
  callToasts.delete(callId);
}
