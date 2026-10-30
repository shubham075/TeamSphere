# Source of Truth — TeamSphere

> Status: **v0.4 — APPROVED FOR BUILD.** Phase 0 is in progress.
> Last updated: 2026-10-27
>
> This document is the single source of truth for scope, architecture, data model and delivery plan.
> Any change in scope or design is recorded here first (see §14 Change Log).

---

## 1. Product Summary

**TeamSphere** is a self-hosted collaboration platform for internal company use. Its goal is **feature parity with Microsoft Teams across all tiers**: Free, Essentials, Business, Enterprise, Premium, and the Microsoft 365 apps embedded in Teams (Planner, Approvals, Shifts, Bookings, Lists, Loop, OneNote, Whiteboard, Stream, Forms, Viva Engage/Praise/Updates, Power Automate-style workflows).

- **No subscription tiers.** Every feature is available to every user (decision Q-Plans). Admins can still switch features on or off per policy (§3.17).
- Ships as a **web app** and a **Windows desktop app** (Electron).
- Uses its own name, logo and visual identity. No Microsoft names, logos, icons or copied assets.
- Runs on the company's own server.

---

## 2. Goals & Non-Goals

### Goals
- Build every Teams capability listed in §3 that does not depend on telecom carriers or deferred AI.
- Reliable 1:1 and group audio/video via a self-hosted LiveKit SFU (target: 49-tile gallery, 300 interactive meeting participants, town halls up to 10k view-only viewers via HLS).
- Real-time everything: messages, presence, typing, reactions, read receipts, co-editing.
- Login with username/password, **Microsoft Entra ID (OIDC)**, and **on-prem Active Directory (LDAP)**.

### Non-Goals / Deferred
| Item | Status | Reason |
|---|---|---|
| PSTN calling: phone numbers, dial pad to landlines, call queues, auto attendants, Direct Routing | ❌ Excluded | Internal calls only (decision) |
| Live captions, live transcription, live translation | ⏸ Future enhancement | Paused by product owner |
| AI features: Copilot, intelligent recap, meeting summaries, smart compose, message translation | ⏸ Future enhancement | Depends on transcription; deferred |
| Native mobile apps (iOS/Android) | ❌ Excluded | Windows desktop only; mobile users get the responsive web/PWA |
| macOS / Linux desktop builds | ❌ Excluded | Windows only (decision) |
| Federation with external Teams/Skype tenants | ❌ Excluded | Not possible without Microsoft's own services |
| Paid plans / billing | ❌ Excluded | Everything for everyone |

Data models stay open for the deferred items (e.g. `Call.transcriptId`), so adding them later needs no rework.

---

## 3. Feature Inventory (full parity)

Priority: **P0** = core (needed for daily use), **P1** = standard Teams features, **P2** = advanced / Premium / M365-app modules. Everything listed is in scope; the priority only sets build order.

### 3.1 Identity, Accounts & Profile
| Feature | Pri |
|---|---|
| Username + password login (argon2 hashing), JWT access token + rotating refresh token (httpOnly cookie) | P0 |
| **SSO: Microsoft Entra ID via OpenID Connect** (auth code + PKCE); account auto-provisioned on first login | P0 |
| **SSO: on-prem Active Directory via LDAP/LDAPS bind**; optional group → role mapping | P0 |
| Profile: display name, avatar, job title, department, office location, phone, manager | P0 |
| Org chart (from manager field / AD sync) | P1 |
| Scheduled AD/LDAP directory sync (users, disabled accounts, groups) | P1 |
| Session management (list and revoke devices) | P1 |
| MFA (TOTP) for local accounts | P1 |
| Guest accounts (external users invited by email, restricted access) | P1 |
| Account deactivation that keeps the user's history | P0 |

### 3.2 Presence & Status
| Feature | Pri |
|---|---|
| Available, Busy, Do Not Disturb, Be Right Back, Appear Away, Appear Offline, Offline | P0 |
| Automatic statuses: Away (idle / desktop lock), In a call, In a meeting, Presenting, Out of office | P0 |
| Status message with expiry; show in chat compose box | P1 |
| Status duration ("Busy for 1 hour") | P1 |
| Out-of-office scheduling with auto-reply in chat | P1 |
| Priority access contacts that can break through DND | P1 |
| "Notify me when available" | P1 |

### 3.3 Chat (1:1, group, meeting chats)
| Feature | Pri |
|---|---|
| 1:1 and group chats (up to 250 members), named group chats, add/remove people, share history on add | P0 |
| Rich text editor: formatting, lists, code blocks, quotes, tables, links, @mentions, emoji | P0 |
| Edit, delete, reply/quote, forward message | P0 |
| Reactions (default set + full emoji picker + custom org emoji) | P0 |
| Typing indicators, read receipts (Seen by) | P0 |
| Attachments: files, images, video, paste screenshots, drag-and-drop | P0 |
| Link previews (unfurl) | P1 |
| Delivery options: Standard / **Important** / **Urgent** (re-notify every 2 min for 20 min) | P1 |
| **Scheduled send** | P1 |
| Save message (bookmarks), pin messages in a chat, pin chats | P1 |
| Mute, hide, mark unread, chat folders / custom sections in the chat list | P1 |
| Chat with yourself | P1 |
| Polls in chat (quick poll) | P1 |
| Stickers, GIFs (self-hosted sticker packs; GIF provider optional) | P2 |
| Voice clips (recorded audio messages) | P1 |
| Video clips (record a short video message) | P2 |
| Loop-style live components in chat: a co-edited table, task list or checklist inside a message (Yjs) | P2 |
| Pop-out chat into its own window (desktop) | P1 |
| Message search in a conversation | P1 |
| Chat bubbles (message preview popups during meetings) | P1 |

### 3.4 Teams & Channels
| Feature | Pri |
|---|---|
| Create team (public / private / org-wide), from scratch, from a template or from an existing team | P0 |
| Roles: owner, member, guest; team settings and permissions | P0 |
| Standard channels with **threaded posts** (post + replies), new-post vs reply composer | P0 |
| @team, @channel, @tag mentions | P0 |
| **Private channels** (subset of members, own files) | P1 |
| **Shared channels** (members from other teams without joining the team) | P1 |
| Channel **announcements** (header image + headline) | P1 |
| Post in multiple channels at once (cross-post) | P1 |
| Channel moderation: who can post, reply, @mention | P1 |
| Tags (named groups of people for @mentions) | P1 |
| Channel tabs: Posts, Files, Notes/Wiki, plus any app tab (Planner, Lists, Website, Whiteboard…) | P1 |
| Channel calendar & channel meetings (Meet now in a channel) | P1 |
| Channel email address (email into a channel via SMTP inbound) | P2 |
| Team templates (default channels + tabs + apps) | P2 |
| Team insights / analytics (activity per channel and member) | P2 |
| Archive, restore and delete teams and channels; deleted channels kept for 30 days | P1 |
| Team discovery (browse and join public teams), join codes | P1 |
| Pin channels, reorder teams, hide/show teams | P1 |
| Channel view: threaded "Posts" layout and modern chat-like layout toggle | P2 |

### 3.5 Calls (internal, app-to-app)
| Feature | Pri |
|---|---|
| 1:1 audio and video call with ringing (accept / accept audio-only / decline / missed) | P0 |
| Group audio/video call started from a group chat (rings everyone) | P0 |
| Add people to a call, upgrade audio → video, switch to screen share | P0 |
| Mute, camera, device settings (mic / camera / speaker), test call | P0 |
| Network quality indicator, auto-reconnect, audio-only fallback on weak networks | P0 |
| Call history (incoming / outgoing / missed, duration), call back | P1 |
| **Hold / resume**, **transfer** (blind and consult) to another user | P1 |
| **Call forwarding** & simultaneous ring (to another user or to voicemail) | P1 |
| **Voicemail** (internal): record a message when a call is missed, with playback in Calls | P1 |
| Call groups (ring a group of colleagues) & **delegation** (delegate answers calls for a manager) | P2 |
| Speed dial / favorite contacts in the Calls app | P1 |
| Do-not-disturb call rejection and busy-on-busy | P1 |
| **Walkie Talkie** (push-to-talk channels for frontline teams) | P2 |
| Noise suppression, echo cancellation | P0 |
| End-to-end encryption for 1:1 calls (LiveKit E2EE) | P2 |

### 3.6 Meetings
| Feature | Pri |
|---|---|
| Meet now (instant) and scheduled meetings with join link and join code | P0 |
| Pre-join screen: camera preview, device selection, background, audio-off join | P0 |
| Gallery view (up to 49 tiles), speaker view, **large gallery**, **together mode**, **focus mode** | P0/P2 |
| Pin, **spotlight** (organizer), hide own video, show/hide names | P1 |
| Screen share: screen, window, tab, with computer sound; **give/take control** (desktop) | P0/P2 |
| Present PDF / slides with per-slide navigation for attendees (PowerPoint Live equivalent) | P2 |
| Meeting chat that lasts beyond the meeting | P0 |
| Raise hand (ordered queue), live reactions | P1 |
| **Roles**: organizer, co-organizer, presenter, attendee; meeting options page | P1 |
| **Lobby**: who can bypass, admit/deny, notify on lobby join | P1 |
| Host controls: mute all, disable attendee mic/camera, lock meeting, remove participant, end for all | P1 |
| Background blur, preset and custom background images | P1 |
| **Recording** (LiveKit Egress → S3 storage), recording expiration, auto-record option | P1 |
| **Breakout rooms**: auto/manual assign, timers, broadcast messages, move between rooms, recreate | P1 |
| **Whiteboard** (tldraw + Yjs live co-drawing), saved to the meeting | P1 |
| Meeting notes & agenda (co-edited page) | P1 |
| Polls in meetings (pre-created and launched during the meeting) | P1 |
| **Q&A** (moderated question queue with upvotes) | P2 |
| **Attendance report** (join/leave times, duration, role) | P1 |
| Engagement report (reactions, raised hands, chat activity) | P2 |
| Guest / anonymous join via link (name only, lands in lobby) | P1 |
| Dial-in by phone | ❌ (PSTN excluded) |
| **Premium:** meeting watermark (viewer's email on shared content and video) | P2 |
| **Premium:** branded meetings (company logo, lobby background, meeting themes) | P2 |
| **Premium:** advanced meeting protection: block copying of chat, block recording, sensitivity templates | P2 |
| **Premium:** meeting templates (preset options by meeting type) | P2 |
| **Premium:** end-to-end encrypted meetings | P2 |
| **Premium:** personalized timeline markers in the recording (when you joined, left, were mentioned, screen-shared) | P2 |
| View-only overflow (beyond the interactive limit, attendees watch an HLS stream) | P2 |
| Live captions / transcript / live translation / intelligent recap | ⏸ Deferred |

### 3.7 Webinars & Town Halls (large events)
| Feature | Pri |
|---|---|
| **Webinars**: registration page (custom fields), approval, waitlist, capacity limit | P2 |
| Email confirmation, reminders and follow-ups for webinars | P2 |
| Presenter bios, event branding, green room (presenters join before attendees) | P2 |
| Attendee experience controls (no mic/camera for attendees, moderated Q&A) | P2 |
| **Town halls**: broadcast to up to 10k viewers via HLS (LiveKit Egress), producer/presenter/attendee roles | P2 |
| Town hall Q&A, RSVP, recording on demand, post-event analytics | P2 |
| Production tools: manage what attendees see, queue presenters, bring on stage | P2 |

### 3.8 Calendar & Scheduling
| Feature | Pri |
|---|---|
| Views: day, work week, week, month; agenda list | P1 |
| New meeting form: attendees (required / optional), channel, location, recurrence, time zone, description | P1 |
| **Scheduling assistant** (attendees' free/busy grid, suggested times) | P1 |
| RSVP: accept / tentative / decline / propose new time | P1 |
| Recurring series with exceptions | P1 |
| Reminders (in-app, desktop notification, email) | P1 |
| .ics invitations by email; subscribe to TeamSphere calendar via iCal URL | P2 |
| Working hours, out-of-office events | P1 |
| Join button and countdown on upcoming meetings | P1 |

### 3.9 Files (OneDrive / SharePoint equivalent)
| Feature | Pri |
|---|---|
| Upload/download in chats and channels, inline preview of images, video, audio, PDF | P0 |
| **Personal file space** ("My files") with folders | P1 |
| **Team / channel document libraries** with folders, move, copy, rename | P1 |
| File versioning (history, restore) | P1 |
| Sharing links (people in org / specific people / view or edit), access requests | P1 |
| Recycle bin (restore deleted files for 93 days) | P1 |
| **Office document viewing and co-editing** (DOCX/XLSX/PPTX) via a self-hosted **ONLYOFFICE Document Server** | P2 |
| Shared-with-me, recent files, file search | P1 |
| Storage quotas per user and per team (admin) | P2 |
| Antivirus scan (ClamAV) on upload | P2 |

### 3.10 Activity, Notifications & Search
| Feature | Pri |
|---|---|
| Activity feed: mentions, replies, reactions, missed calls, voicemails, team adds, app notifications, filters | P0 |
| Unread badges on chats, channels and the app rail | P0 |
| Desktop notifications (Windows native in the desktop app; Web Push in the browser) | P0 |
| Notification settings per category, per chat and per channel; quiet hours | P1 |
| Email digest of missed activity | P2 |
| Global search: people, messages, files, teams, channels; filters (from, date, has attachment, in) | P1 |
| Command box: slash commands (/available, /busy, /call, /chat, /files, /goto…) and Ctrl+K | P1 |

### 3.11 Tasks — Planner & To Do
| Feature | Pri |
|---|---|
| Plans attached to teams/channels: buckets, Board / Grid / Schedule / Charts views | P2 |
| Tasks: assignees, due/start dates, priority, progress, labels, checklist, attachments, comments | P2 |
| Personal tasks (To Do style: My Day, Important, Planned, Assigned to me) | P2 |
| Tasks from messages ("Create task" on a message) | P2 |
| Task notifications in Activity | P2 |

### 3.12 Approvals
| Feature | Pri |
|---|---|
| Create approval requests (basic, sequential, multiple approvers, require all/any), attach files | P2 |
| Templates (expense, leave, purchase) built by admins | P2 |
| Approve / reject with comment, in the Approvals app and from chat cards | P2 |
| History & export | P2 |

### 3.13 Frontline: Shifts & Updates
| Feature | Pri |
|---|---|
| **Shifts**: schedules per team, shifts & open shifts, groups, time off, swap/offer requests, manager approval | P2 |
| Time clock (clock in / out, breaks), timesheet export | P2 |
| **Updates**: recurring status reports (daily checklist, incident report) with templates and review flow | P2 |

### 3.14 Bookings & Virtual Appointments
| Feature | Pri |
|---|---|
| Booking pages (services, staff, availability), public booking link for external customers | P2 |
| Virtual appointment = meeting with a waiting room, customer joins by link with no account | P2 |
| Queue view for staff, email confirmations/reminders, appointment analytics | P2 |

### 3.15 Collaboration apps (Lists, Loop/Notes, Forms, Whiteboard, Stream)
| Feature | Pri |
|---|---|
| **Lists**: custom-column lists (text, choice, date, person, number), views, filters, forms, templates | P2 |
| **Pages / Loop workspaces / Notes**: co-edited rich pages (Tiptap + Yjs) with live components, shared as tabs | P2 |
| **Wiki** per channel (built on Pages) | P1 |
| **Forms & surveys**: question types, response summaries, export | P2 |
| **Whiteboard app**: standalone boards, shareable, also usable in meetings | P1 |
| **Stream / video library**: recordings & uploaded videos, playback speed, chapters, comments, sharing | P2 |

### 3.16 Community & Engagement (Viva Engage / Praise)
| Feature | Pri |
|---|---|
| **Community**: org-wide social feed, communities, posts, announcements, questions with best answer | P2 |
| **Praise**: send badges with a note to colleagues, praise history | P2 |
| Storyline (personal feed of posts) | P2 |

### 3.17 Apps Platform, Integrations & Workflows
| Feature | Pri |
|---|---|
| App catalog: built-in apps + company custom apps; install into personal/team/chat/meeting scope | P2 |
| **Incoming webhooks** (post cards into a channel) | P1 |
| **Outgoing webhooks** & **bot API** (bots can chat, receive @mentions, send cards) | P2 |
| **Adaptive-card-style message cards** (JSON cards with actions) | P2 |
| Website tabs and custom app tabs (iframe + JS SDK) | P2 |
| Message extensions / message actions | P2 |
| **Workflows** (Power Automate equivalent): trigger (new message, keyword, schedule, form response…) → actions (post message, create task, start approval, call webhook) | P2 |
| Public REST API + API tokens for integrations | P2 |

### 3.18 Administration, Security & Compliance
| Feature | Pri |
|---|---|
| Admin center: users, guests, teams, channels, apps | P1 |
| Policies (per user or group): messaging, meeting, calling, live events, app setup/permissions, feature toggles | P1 |
| Org settings: branding, guest access, external access, file size limits, retention | P1 |
| **Audit log** (sign-ins, admin actions, file access, team changes) | P1 |
| Usage reports & analytics (active users, messages, meetings, devices) | P2 |
| **Call quality dashboard** (per-call network stats from LiveKit webhooks) | P2 |
| **Retention policies** (auto-delete chat/channel messages after N days) | P2 |
| **eDiscovery & legal hold** (search and export content for a case; held items cannot be deleted) | P2 |
| **Information barriers** (block chat/calls between groups) | P2 |
| **Sensitivity labels** on teams/meetings (restrict guests, block copy, watermark) | P2 |
| **DLP** (block messages containing patterns such as card numbers; regex policies) | P2 |
| Communication compliance (flag messages by keyword for reviewers) | P2 |

### 3.19 Personalization & Accessibility
| Feature | Pri |
|---|---|
| Light / dark / high-contrast themes, density options, zoom | P1 |
| Keyboard shortcuts (full set) & shortcut cheat sheet | P1 |
| Language & time-zone settings (i18n framework ready; English first) | P1 |
| Immersive reader-like reading view (font size / spacing / focus line) | P2 |
| Screen-reader support (ARIA), WCAG 2.1 AA | P0 |

### 3.20 Windows Desktop Application
Electron app wrapping the same Next.js UI (one codebase). Chosen over Tauri for its consistent Chromium WebRTC stack and native `desktopCapturer` for screen sharing.

| Feature | Pri |
|---|---|
| Windows installer (NSIS .exe) + **MSI** for IT mass deployment; Authenticode signing when a cert is available | P0 |
| Native Windows toast notifications (messages, mentions, incoming calls with Accept/Decline) | P0 |
| Screen/window picker for sharing (`desktopCapturer`), share system audio | P0 |
| System tray icon with unread badge and presence menu; taskbar overlay badge & flash on call | P0 |
| Deep links `teamsphere://` (meetings, chats, files) | P1 |
| Auto-start with Windows, minimize to tray | P1 |
| Auto-update from the company server (electron-updater, generic provider) | P1 |
| Pop-out windows for chats and meetings; always-on-top mini call window when minimized | P1 |
| Global shortcut: Ctrl+Shift+M toggle mute, Ctrl+Shift+O toggle camera | P1 |
| OS idle / lock detection (`powerMonitor`) → automatic Away | P1 |
| Give/take remote control during screen share (robotjs/nut.js input injection, with consent prompt) | P2 |
| Server URL configuration on first launch (points to the company's server) | P0 |

Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, typed preload bridge, strict CSP, navigation locked to the configured server origin.

---

## 4. UI Layout

```
┌──────────────────────────── Title bar: ◀ ▶  [ Search / command box ]   profile+presence ┐
├───┬──────────────────┬──────────────────────────────────────────────────────────────────┤
│ A │  List pane       │  Main content                                                    │
│ p │  (chats / teams  │  header: title · tabs (Posts | Files | Notes | +) · call buttons  │
│ p │   / activity /   │                                                                  │
│   │   calendar nav)  │  conversation / channel / call / calendar / app                  │
│ R │                  │                                                                  │
│ a │                  │  compose box                                                     │
│ i │                  │                                                                  │
│ l │                  │                                                                  │
└───┴──────────────────┴──────────────────────────────────────────────────────────────────┘
```
App rail: **Activity, Chat, Teams, Calendar, Calls, Files, Apps (…)**, with pinned apps (Planner, Approvals, Shifts…) configurable by admin policy.

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Monorepo | **pnpm workspaces** |
| Frontend | **Next.js 15 (App Router, React 19) + TypeScript** |
| UI | Tailwind CSS + Radix primitives (shadcn/ui pattern), lucide icons |
| Client state | Zustand + TanStack Query |
| Rich text / co-editing | Tiptap + Yjs (Hocuspocus server) |
| Whiteboard | tldraw + Yjs |
| Backend | **NestJS 11 (TypeScript)**: REST + Socket.IO gateway |
| Validation | zod (shared schemas in `packages/shared`) |
| Database | **PostgreSQL 16** + **Prisma** |
| Cache / pub-sub / queues | **Redis 7** + BullMQ (scheduled send, reminders, retention jobs, emails) |
| Media | **LiveKit server (self-hosted SFU)** + Egress (recording, HLS) |
| TURN | LiveKit embedded TURN (TLS 443) |
| Files | **SeaweedFS** (S3 API, self-hosted; MinIO no longer ships public images) |
| Office docs | ONLYOFFICE Document Server (Phase 9) |
| Search | PostgreSQL full-text search (tsvector + GIN), Meilisearch later if needed |
| Auth | Passport strategies: local, `openid-client` (Entra ID), `ldapts` (AD/LDAP) |
| Email | Nodemailer → company SMTP (Mailpit in dev) |
| Desktop | Electron + electron-builder (NSIS + MSI), electron-updater |
| Testing | Vitest (unit), Supertest (API), Playwright (E2E with fake media devices) |
| Reverse proxy | Caddy or Nginx with TLS (company certificate) |
| Deployment | Docker Compose on the company server |

---

## 6. Architecture

```
  Browser / Electron (Windows)
   │  HTTPS REST      │ WSS Socket.IO      │ WSS Yjs        │ WebRTC (UDP/TCP/TURN)
   ▼                  ▼                    ▼                ▼
 ┌────────────────────────────────────┐ ┌──────────┐  ┌───────────────┐
 │ NestJS API + Socket.IO gateway     │ │Hocuspocus│  │ LiveKit SFU   │
 │ auth · chat · teams · calls ·      │ │ (Yjs)    │  │ + Egress      │
 │ meetings · files · apps · admin    │ └────┬─────┘  └──────┬────────┘
 │ issues LiveKit tokens, receives    │      │               │ webhooks
 │ LiveKit webhooks                   │◀─────┴───────────────┘
 └───┬───────────┬───────────┬────────┘
     ▼           ▼           ▼
 PostgreSQL    Redis     SeaweedFS      (+ Entra ID / AD-LDAP for SSO, SMTP for email)
```

### Call flow
1. Caller → `POST /calls` → `Call` row + LiveKit room → caller gets a token.
2. Gateway emits `call:incoming` to the callee(s) → ringing UI / Windows toast.
3. Accept → `POST /calls/:id/join` → token → connect to the SFU. Decline/timeout (30 s) → missed call → voicemail prompt, Activity entry and a system message in the chat.
4. LiveKit webhooks (`participant_joined/left`, `room_finished`, `egress_ended`) keep call state, attendance and recordings in sync.

### Realtime events (Socket.IO)
`message:new|updated|deleted · reaction:changed · typing:start|stop · read:updated · presence:changed · call:incoming|updated|ended|transferred · voicemail:new · meeting:lobby|admitted · notification:new · channel:updated · team:updated · conversation:updated`

---

## 7. Data Model (core; module tables added per phase)

```
User(id, username UNIQUE, email, passwordHash?, authProvider[local|entra|ldap], externalId?, displayName,
     avatarUrl, jobTitle, department, office, phone, managerId?, role[admin|user|guest], isActive, createdAt)
Session(id, userId, refreshTokenHash, userAgent, ip, expiresAt, revokedAt)
Presence(userId, status, statusMessage, statusExpiresAt, oooUntil)        -- live state cached in Redis
Team(id, name, description, visibility[public|private|orgwide], avatarUrl, joinCode, archivedAt)
TeamMember(teamId, userId, role[owner|member|guest])
Channel(id, teamId, name, description, type[standard|private|shared], moderation(json), archivedAt)
ChannelMember(channelId, userId, role)
Conversation(id, type[direct|group|channel|meeting|self], title, channelId?, meetingId?)
ConversationMember(conversationId, userId, lastReadAt, muted, pinned, hidden, sectionId?)
Message(id, conversationId, authorId, parentId?, content(json), plainText (tsvector), importance[normal|important|urgent],
        type[text|system|call|card], scheduledFor?, editedAt, deletedAt, createdAt)
Reaction(messageId, userId, emoji) · Mention(messageId, userId?|tagId?|scope) · SavedMessage(userId, messageId)
Attachment / FileItem(id, ownerType[user|team|channel], parentId?, name, mime, size, storageKey, version, deletedAt)
Call(id, conversationId?, meetingId?, kind[audio|video], status[ringing|active|ended|missed|declined], endReason, roomName,
     startedById, transferredById?, transferredFromId?, createdAt, answeredAt, endedAt)
CallParticipant(callId, userId, status[ringing|joined|left|declined|missed|busy|forwarded], isCaller, onHold, forwardedForId?,
     invitedAt, joinedAt, leftAt)
Voicemail(id, userId, fromUserId, callId?, storageKey, mimeType, size, durationMs, listenedAt)
CallSettings(userId, forwardMode[off|user|voicemail], forwardToId?, alsoRingId?) · SpeedDial(userId, contactId)
Meeting(id, organizerId, title, description, startAt, endAt, timeZone, recurrence?, joinCode, options(json),
        conversationId, channelId?, kind[meeting|webinar|townhall|appointment])
MeetingAttendee(meetingId, userId?, email?, role, required, rsvp, proposedStartAt?, proposedEndAt?) · Recording(id, meetingId, storageKey, expiresAt)
MeetingSession(id, meetingId, occurrenceStart, roomName, locked, startedAt, endedAt) · MeetingAttendance(sessionId, userId, role, joinedAt, leftAt)
Recording(id, meetingId, sessionId, egressId, storageKey, status[recording|processing|ready|failed], startedById, startedAt, endedAt, durationSec, size, expiresAt)
MeetingPoll(id, meetingId, question, options[], multiple, anonymous, status[draft|live|closed]) · MeetingPollVote(pollId, userId, option)
MeetingQuestion(id, meetingId, authorId, text, anonymous, status[pending|published|answered|dismissed]) · MeetingQuestionVote(questionId, userId)
MeetingWhiteboard(meetingId, state = Yjs update) · User.guestMeetingId (anonymous meeting guests)
WorkingHours(userId, timeZone, days[], startMinute, endMinute)
Notification(id, userId, type, payload(json), readAt, createdAt) · PushSubscription(...)
AuditLog(id, actorId, action, targetType, targetId, meta(json), ip, createdAt)
Policy(id, type[messaging|meeting|calling|apps], name, description, settings(json), isDefault) · PolicyAssignment(policyId, userId?|teamId?)  -- groups = teams
OrgSetting(id="org", settings(json), logoKey) · Message.searchVector / FileItem.searchVector (generated tsvector, GIN)
```

---

## 8. Project Structure

```
/apps
  /web        Next.js frontend (also loaded by the desktop app)
  /api        NestJS backend (REST + WebSocket gateway + jobs)
  /desktop    Electron shell for Windows
/packages
  /shared     shared TS types, event names, zod schemas, permissions
/infra
  docker-compose.yml         dev services (postgres, redis, seaweedfs, livekit, mailpit)
  docker-compose.prod.yml    full production stack
  livekit.yaml
SOURCE_OF_TRUTH.md
```

---

## 9. Delivery Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** ✅ | Monorepo, Docker infra, Prisma schema, auth (local + Entra OIDC + LDAP), sessions, profile, app shell UI | Log in 3 ways; see the app shell with rail |
| **0.5 Windows Desktop shell** ✅ (pulled forward on request) | §3.20 shell: Electron app, setup/offline screens, tray + presence menu, deep links, Windows toasts incl. call toast, screen picker, taskbar badge, idle → Away, pop-outs, global call shortcuts, auto-update, NSIS + MSI | Installer builds; app signs in to the server; native features callable from the web app |
| **1. Chat & Presence** ✅ | §3.2, §3.3 P0/P1, attachments, Activity, notifications. 1:1/group/self chats, realtime delivery (Socket.IO), markdown-lite + @mentions, reply/quote, edit/delete, reactions, typing, read receipts (Seen), unread counts, attachments (S3, signed URLs, image/video/audio preview, drag/paste), delivery options (important/urgent with re-notify every 2 min for 20 min), pin/mute/hide, add/remove/leave/rename with system messages, Activity feed, live presence, desktop/browser notifications, taskbar badge, scheduled send, saved messages, mark unread (chat or from a message), custom chat-list sections, polls, voice clips, link previews (server-side unfurl, SSRF-guarded), pop-out chat, in-chat search, avatar upload, status durations and status-message expiry, out of office (scheduled, compose-box banner, daily auto-reply). Not yet: stickers/GIFs, video clips, Loop-style components (P2), chat bubbles (with meetings), priority contacts / "notify when available" | Two users chat in real time with all P0 chat features ✅ |
| **2. Teams & Channels** ✅ | §3.4 P0/P1: teams (public/private/org-wide; create from scratch or copy channels/settings/tags/members), owner/member/guest roles, team permission settings, standard/private/shared channels (shared: individual people from anywhere plus whole teams), threaded posts with new-post vs reply composer, subjects, importance, @person/@team/@channel/@tag mentions, tags, announcements (headline + header image), cross-post to up to 10 channels, channel moderation (who can post/reply/@mention, moderators, moderator delete), tabs: Posts, Files (attachments list; library in Phase 6), Notes (co-owned markdown page with version check), archive/restore, soft delete with 30-day restore and hourly purge, team discovery + join codes, pin channels, reorder/hide teams, per-channel unread + mention counts and Teams rail badge, Activity entries for team adds and channel mentions. Not yet: channel calendar/meetings (Phase 5), app tabs (Phase 8+), team templates, insights, channel email, modern chat layout toggle (P2), team picture upload | Full channel workflow including private/shared channels ✅ |
| **3. Calling** ✅ | §3.5 P0/P1: LiveKit, 1:1 & group A/V, ringing, screen share, hold/transfer/forward, voicemail, call history. **Done:** all P0 + P1 except consult transfer (blind transfer only) | 6 users in a group video call with screen share |
| **4. Windows Desktop (integration)** ✅ | Wire the Phase 0.5 shell into chat and calls: unread badge counts, message toasts, incoming-call toast actions, mute/camera shortcuts, mini call window. **Done:** call toast (shown while the window isn't in front; Video / Audio / Decline / open), dismissed when answered elsewhere, cancelled or missed; taskbar flash; in-call global shortcuts; always-on-top mini call window (BroadcastChannel remote for the main window's LiveKit room) while minimized or hidden; message toasts honour mute, DND (urgent only) and the chat/channel in view; tray status checkmark; badge = unread chats + channels + Activity; `teamsphere://call/<id>` opens (never answers) a call | Incoming call toast accepts a call ✅; badge matches unread count ✅ |
| **5. Meetings & Calendar** ✅ (5a ✅, 5b ✅) | §3.6 P0/P1, §3.8: scheduling, lobby, roles, recording, breakout rooms, whiteboard, polls, attendance. **5a done:** calendar views + agenda, scheduling form, recurrence with exceptions, scheduling assistant, RSVP/propose time, reminders, working hours, Meet now, pre-join, lobby, roles & options, host controls, gallery/speaker view, hands, reactions, persistent meeting chat, attendance report. **5b done:** recording (Egress → S3, notice, auto-record, expiry, signed playback), breakout rooms (auto/manual, timer, broadcast, move, visit, close/recreate), whiteboard (tldraw + Yjs, saved), meeting polls (draft → live → closed) and moderated Q&A with upvotes, guest join via link (name → lobby). **Remaining:** .ics email invites, meeting notes & agenda (P1), recording verified only up to the Egress request (no Egress container on the dev machine) | Two users: recurring meeting → RSVP → pre-join → lobby → admitted → hand/reaction/chat → host controls → attendance ✅ (5a); organizer + guest: lobby, breakout rooms, live poll, Q&A, whiteboard ✅; recording API side ✅ (5b) |
| **6. Files** ✅ | §3.9 P1: libraries, versions, sharing, recycle bin. **Done:** personal My files and per-channel document libraries (channel Files tab), folders, move/copy/rename, upload with progress, previews, versions + restore, people sharing and org links, access requests, Shared with me / Recent / search, Chat files view, recycle bin with 93-day purge. **Remaining:** team-wide (non-channel) libraries; P2 items (ONLYOFFICE, quotas, ClamAV) | Team document library usable ✅ |
| **7. Search, Admin & Settings** ✅ | §3.10 search, §3.18 P1, §3.19. **Done:** global search (people, chat messages, channel posts, files, teams, channels, meetings; filters from / in / date range / has attachment; typeahead + results page) on PostgreSQL full-text search with permission filtering; command box (Ctrl+E/K, `/available /busy /dnd /brb /away /offline /call /chat /goto /files /saved /activity /settings /keys /admin`); admin center (usage overview, users & guests: create, role, enable/disable, reset password, effective policies; teams & channels: archive/restore/delete, owners; org settings: name + logo, guest access, upload size limit, link previews; audit log with filters, paging and CSV export); policies (messaging, meeting, calling, apps) per person or team with an org default, enforced server-side; personalization (light/dark/high-contrast, density, zoom, language + time zone with an i18n catalog, full shortcut set + Ctrl+. cheat sheet). **Remaining:** retention/external access (P2 with §3.18), more languages, configurable pinned rail apps | Admin can manage users and policies; global search works ✅ |
| **8. Productivity apps** | Planner/To Do, Approvals, Lists, Pages/Loop, Forms, Whiteboard app, Stream | Each app usable as a personal app and a channel tab |
| **9. Office co-editing & Premium meetings** | ONLYOFFICE, watermark, branding, E2EE, templates, Q&A, PDF presenting, together/large gallery | Premium features enforced via meeting options |
| **10. Events** | Webinars, town halls (HLS), Bookings & virtual appointments | 1 producer → 500 viewers via HLS |
| **11. Frontline & Community** | Shifts, Updates, Walkie Talkie, Community feed, Praise | Usable by a test team |
| **12. Platform & Compliance** | Webhooks, bots, cards, app catalog, workflows, retention, eDiscovery, legal hold, info barriers, DLP | Compliance policies enforced |
| **Future** | Live captions/transcription/translation, AI recap & Copilot-style features, PSTN | — |

---

## 10. Non-Functional Requirements
- **Security:** argon2id, rotating refresh tokens, CSRF protection on cookie routes, RBAC + resource-level checks on every endpoint, rate limiting, presigned file URLs, audit log, helmet headers, HTTPS mandatory (camera/mic need a secure context).
- **Performance:** message fan-out < 300 ms on LAN; cursor pagination (50/page); virtualized lists; simulcast + dynacast for video.
- **Scale target:** ~2,000 registered users on one server. Horizontal scale: Socket.IO Redis adapter, stateless API, multiple LiveKit nodes.
- **Backups:** nightly `pg_dump` + S3 bucket replication (ops script in `/infra`).
- **Browsers:** latest Chrome, Edge, Firefox, Safari. Desktop: Windows 10 22H2+ and Windows 11.

---

## 11. Server Requirements (company server)
- Linux (Ubuntu 22.04/24.04) or Windows Server with Docker; 8+ vCPU, 16+ GB RAM, SSD.
- Ports: 443 (HTTPS + TURN/TLS), 7881/TCP and 50000–60000/UDP (WebRTC media) open on the firewall.
- A DNS name (e.g. `teamsphere.company.local`) with a TLS certificate trusted by company machines.
- Entra ID: an app registration (client ID, secret, tenant ID, redirect URI). AD: an LDAPS endpoint and a bind service account.

---

## 12. Decisions & Open Questions

### Decided
| # | Topic | Decision |
|---|---|---|
| Q1 | Purpose | Internal company tool, single organization |
| Q2 | Stack | Next.js + NestJS + PostgreSQL/Prisma + Redis + Socket.IO |
| Q3 | Media | Self-hosted LiveKit |
| Q4 | Size | Defaults accepted (~100–500 users today, design for 2,000) |
| Q5 | Login | Username + password **and** SSO: Microsoft Entra ID (OIDC) + on-prem AD (LDAP) |
| Q6 | Advanced | Recording, breakout rooms, whiteboard in scope; **live captions deferred** |
| Q7 | Dev machine | Docker Desktop + Node available |
| Q8 | Hosting | Company's own server |
| Q9 | Brand | **TeamSphere**, indigo/violet |
| Q10 | Order | Phase order in §9 |
| Q12 | Recordings | S3 storage (SeaweedFS), kept 90 days (admin-configurable) |
| Q13 | Desktop | **Windows only** |
| Q14 | Scope | **Full Teams parity across all tiers and modules** |
| Q15 | Plans | **No tiers: everything for everyone** |
| Q16 | PSTN | **Excluded**, internal calls only |
| Q17 | AI | **Deferred** with captions |

### Open (not blocking current phase)
| # | Question | Default |
|---|---|---|
| Q18 | Code-signing certificate for the Windows installer? | Unsigned until provided (SmartScreen warns) |
| Q19 | Company SMTP server details for emails | Mailpit in dev; configure via env in prod |

---

## 13. Environment Variables (API)
```
DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, WEB_ORIGIN,
S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET,
LIVEKIT_URL, LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
ENTRA_ENABLED, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI,
LDAP_ENABLED, LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASSWORD, LDAP_BASE_DN, LDAP_USER_FILTER,
EGRESS_S3_ENDPOINT, RECORDING_RETENTION_DAYS,
LINK_PREVIEWS_ENABLED, LINK_PREVIEW_ALLOW_PRIVATE,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
```

---

## 14. Change Log
| Date | Version | Change |
|---|---|---|
| 2026-10-27 | 0.1 | Initial draft |
| 2026-10-27 | 0.2 | Internal tool; Next.js + NestJS; self-hosted LiveKit; recording, captions, breakout rooms, whiteboard in scope |
| 2026-10-27 | 0.3 | Added Electron desktop app |
| 2026-10-30 | 1.5 | Phase 7 (search, admin & settings) built. **Search:** `Message.searchVector` (`to_tsvector('english', body)`) and `FileItem.searchVector` (`'simple'`, name split on `._-`) are STORED generated columns with GIN indexes (Prisma `Unsupported("tsvector")` with the generation expression mirrored as `@default(dbgenerated(...))` so `migrate dev` shows no drift); queries are word-prefix `to_tsquery` (`budg` → budget) built from sanitized words. `GET /api/search` joins `ConversationMember` for the caller (channel access, private/shared included, is already materialized there), applies `historySince`, hides deleted messages/channels/teams and system messages, and re-checks each row with the pure `messageVisible` rule; files go through `FilesService.search` (sharing rules), teams = member or public/org-wide, channels = conversation member, meetings = organizer/attendee. Snippets via `ts_headline` with «» markers. **Policies:** `Policy(type, name, settings, isDefault)` + `PolicyAssignment(userId? | teamId?)`; groups are teams. Resolution per type: direct user policy › the person's team policies combined restrictively (any `false` wins, strictest lobby) › org default › built-in defaults (all on). `PolicyService.effective/assert` (30 s cache, cleared on any change) is checked in chat (edit/delete/urgent/link previews), channel posts (urgent, own delete), calls (calls, video), meetings (schedule, lobby default, recording) and files (uploads). **Org settings:** singleton `OrgSetting` (name, logo capability URL, guest access, upload size limit capped by each endpoint's hard limit, link previews); `GET /api/org` is public. `org:updated` WS event makes clients refetch org + `/org/my-policies`. **Admin center:** `/api/admin/*` (`@Roles('admin')`): overview counts, users (role/active changes revoke sessions; last active admin protected), teams/channels actions, owners, policies, audit log (prefix action filter, actor, dates, cursor paging, CSV with formula-injection guard). **Web:** title-bar `SearchBox` (typeahead + command box), `/search`, `/admin`, `KeyboardShortcuts` + cheat sheet, display prefs in `lib/theme.ts` (classes `dark`/`hc`/`compact`, CSS zoom, applied before paint), `lib/i18n.ts` (catalog + Intl formatting in the chosen zone). Settings → Administration now links to the admin center |
| 2026-10-30 | 1.4 | Phase 5b (meetings advanced) built. **Guests:** `/join/<joinCode>` → name only → `POST /api/meetings/guest-join` (public, 5/min per IP) creates a `role=guest` user with `guestMeetingId` and a 12 h session without a refresh token (so a signed-in cookie in the same browser is untouched); the access-token guard rejects guests on every route not marked `@GuestAllowed()`, services check the meeting; guests always wait in the lobby, are plain attendees, get no chat, never appear in the directory/org-wide teams, and are disabled when the meeting session ends. Meeting option `allowGuests` (default on). **Breakout rooms:** in-memory per live session like the lobby; each room is its own LiveKit room `mbr-<uuid>`; clients ask `GET sessions/:id/token` for the room they belong in and reconnect when rooms open/close or they're reassigned; organizers may visit any room; timers close rooms server-side; closing broadcasts state first and tears rooms down after 3 s; attendance/empty-session checks include breakout rooms; `meeting:broadcast` carries organizer messages. **Recording:** `Recording` model; LiveKit Egress room composite (grid) → MP4 uploaded straight to S3 (`EGRESS_S3_ENDPOINT` as seen from the Egress container); organizers/presenters start/stop, auto-record on go-live, notice in the live state + system line in the meeting chat; status from egress webhooks or a 30 s `listEgress` poll; expired recordings (`RECORDING_RETENTION_DAYS`, default 90) are deleted with their file; playback through signed URLs (`/api/meetings/recordings/:id/content`, Range). Breakout rooms aren't recorded. The `egress` compose service is optional (headless Chrome image, ~2+ GB disk). **Polls & Q&A:** separate `MeetingPoll`/`MeetingQuestion` models (drafts, anonymity and guest voters don't fit chat polls); attendees see live results only after voting; Q&A moderated by default (`allowQna`, `moderateQna` options), anonymous authors hidden from everyone but themselves; `meeting:activity` tells clients to refetch. **Whiteboard:** tldraw records mirrored in a Yjs map, synced over the existing Socket.IO connection (`whiteboard:join/update/awareness/leave`), access re-checked every 30 s per socket, document saved to `MeetingWhiteboard` 2 s after edits (`allowWhiteboard` option). tldraw shows its watermark without a license key (needs one for production). Remaining from Phase 5: .ics email, meeting notes & agenda |
| 2026-10-30 | 1.3 | Phase 5a (meetings & calendar core) built: `Meeting` (recurrence JSON expanded in the meeting's IANA zone, `exceptions` JSON keyed by original occurrence start for moved/cancelled occurrences and per-occurrence RSVP), `MeetingAttendee` (role, required, RSVP, proposed time), `MeetingSession` (one LiveKit room `meeting-<uuid>` per live occurrence), `MeetingAttendance` (join/leave intervals) and `WorkingHours`; user ids are plain columns like Files. Meeting chat = a regular group conversation (or the chat Meet now started from), so it persists. Lobby, admitted/removed sets, hand queue and attendee mic/camera switches live in memory per session (single API instance, like calls); attendee permissions enforced via LiveKit token `canPublishSources` + `updateParticipant`. Attendance comes from LiveKit webhooks (fanned out by `LivekitService.dispatch`) plus a 15 s room poll; empty sessions end after 90 s. Reactions go over the LiveKit data channel. New WS events `meeting:changed`, `meeting:updated`, `meeting:reminder` (+ existing `meeting:lobby`); Activity types `meeting_invite/updated/cancelled/rsvp`. 5b (recording, breakout rooms, whiteboard, polls/Q&A, guest join, .ics) pending |
| 2026-10-29 | 1.2 | Phase 4 desktop integration built: `DesktopBridge` adds `showMainWindow`, `setPresence` and `onWindowState`; shell dedupes pop-outs by URL and places always-on-top windows bottom-right without stealing focus; call toast is silent (the web ringtone plays); pure deep-link parser `apps/desktop/src/links.ts` with `teamsphere://call/<id>` → open; web `lib/desktop-logic.ts` (badge count, notify rule, toast button mapping), `lib/notify.ts`, `lib/mini-call.ts` and `/calls/mini`; DND now silences message toasts except urgent ones; the title/badge count now includes unread channels; vitest added to `apps/web` and `apps/desktop` |
| 2026-10-29 | 1.1 | Phase 6 Files built: `FileItem` (ownerType user/team/channel + ownerId, self-tree, soft delete with shared `deletedAt` + `inRecycleBin` root flag), `FileVersion`, `FileShare`, `ShareLink` + `ShareLinkUse`, `FileAccessRequest`, `FileRecent`; user ids are plain columns (no User back-relations). Permissions are the best of library role, shares and opened org links on the item or any parent folder (pure rules in `files.logic.ts`); viewers read, editors write and share, only library owners purge. Channel libraries: everyone in the channel edits; team owners (standard) or channel owners (private/shared) manage; archived = read-only. Same-name upload creates a new version; restoring a version adds a new latest version. Content served via signed version URLs (`/api/files/content/:versionId`, Range supported); opens, shares, links and requests are audited. File notifications reuse `Notification` (`file_shared`, `file_access_request`, `file_access_approved/denied`); realtime `files:changed`/`files:access_request` (`FILE_WS_EVENTS`). Hourly in-process purge of items deleted > 93 days |
| 2026-10-29 | 1.0 | Phase 3 calling built: `Call`/`CallParticipant`/`Voicemail`/`CallSettings`/`SpeedDial` models; `calls` module (pure state machine in `call-state.ts`, LiveKit tokens, 30 s ring sweep, LiveKit webhook at `POST /api/calls/livekit-webhook` + 20 s room reconcile as a fallback for closed tabs); events simplified to `call:incoming|updated|ended|transferred` + `voicemail:new`; missed calls/voicemails added to Activity; presence `in_call` kept in Redis; blind transfer only (consult transfer deferred); added `LIVEKIT_PUBLIC_URL`. Single API instance assumed for call locks (like presence) |
| 2026-10-29 | 0.9 | Phase 2 Teams & Channels built: `Team`, `TeamMember` (role, personal position/hidden), `Channel` (type, isGeneral, moderation JSON, notes + notesVersion, archivedAt/deletedAt), `ChannelMember`, `ChannelShare` (shared channel → whole team), `ChannelPost` (subject, announcement, header attachment, crossPostId), `Tag`/`TagMember`. Channel posts reuse Conversation/Message: `ConversationType.channel`, `Message.parentId` = thread root; `Channel.conversationId`/`ChannelPost.messageId` are plain ids so chat models stay untouched. Channel access is materialized into `ConversationMember`, so chat reactions/edit/attachments/typing/read state work on posts; chat lists exclude channel conversations and chat send rejects them. @team/@channel/@tag use the mention token with the team/channel/tag id and are expanded server-side into `Mention` rows + `channel_mention` notifications. New realtime events `channel:message`, `channel:notes` (`TEAMS_WS_EVENTS`); `team:updated`/`channel:updated` carry ids and clients refetch |
| 2026-10-28 | 0.8 | Phase 1 P1 items completed: `SavedMessage`, `ChatSection`, `ScheduledMessage`, `Poll`/`PollVote` models; `Message.linkPreview`, `ConversationMember.markedUnread/sectionId/oooRepliedAt`, `User.ooo*` fields. In-process `ChatScheduler` (15 s tick, Redis lock) delivers scheduled messages, re-notifies urgent messages and broadcasts timed presence changes (BullMQ deferred until there are more job types). Link previews fetched server-side with private-address blocking in the socket lookup (`LINK_PREVIEWS_ENABLED`, `LINK_PREVIEW_ALLOW_PRIVATE`). Avatars served from a capability URL (`?v=<random key segment>`) so `<img>` works without auth and caches forever; uploads are type-sniffed (no SVG). Out of office shows over manual statuses except "Appear offline". Pop-out chat uses `?popout=1` (no rail/title bar/list). Phases 2, 3 and 6 started in parallel branches with isolated dev databases |
| 2026-10-28 | 0.7 | Phase 1 core chat & presence built: Conversation/ConversationMember/Message/Reaction/Mention/Attachment/Notification models; Socket.IO gateway (token auth, per-user rooms, Redis connection counts for presence); chat REST API; chat UI, Activity page, rail badges. Message `content` is stored as markdown-lite `body` text with inline mention tokens (JSON cards later). Web retries token refresh during server restarts instead of signing out |
| 2026-10-28 | 0.6 | Desktop shell (Phase 0.5) built in `apps/desktop`: Electron 44, NSIS + MSI, tray/status menu, call toasts with protocol actions, screen picker, taskbar badge, deep links, idle → Away, pop-outs, auto-update from `<server>/desktop/`, server setup/offline screens, `server.json` for IT pre-configuration. API dev port moved 4000 → 4600 (clash with another local app) |
| 2026-10-27 | 0.5 | Phase 0 built: monorepo, Docker infra, Prisma schema (User, UserIdentity, Session, AuditLog), auth (local + Entra OIDC/PKCE + AD LDAP), sessions, profile, presence, app shell, settings. MinIO → SeaweedFS; Turborepo dropped; dev URLs use 127.0.0.1 |
| 2026-10-27 | 0.4 | Full Teams parity scope (all tiers + M365 app modules); no subscription tiers; SSO via Entra ID + AD/LDAP; Windows-only desktop; live captions, AI and PSTN deferred/excluded; 12-phase plan |
