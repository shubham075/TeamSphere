import { io, Socket } from 'socket.io-client';
import { refreshSession } from './api';
import { useAuth } from './auth-store';

let socket: Socket | null = null;

function socketUrl(): string | undefined {
  const port = process.env.NEXT_PUBLIC_SOCKET_PORT;
  return port ? `${location.protocol}//${location.hostname}:${port}` : undefined; // undefined = same origin
}

/** One shared, authenticated Socket.IO connection for the signed-in user. */
export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(socketUrl() ?? '', {
    transports: ['websocket', 'polling'],
    // Called on every (re)connect, so reconnects always use a fresh access token.
    auth: (cb) => cb({ token: useAuth.getState().accessToken }),
    reconnectionDelayMax: 10_000,
  });
  socket.on('auth_error', async () => {
    // Access token expired while disconnected: refresh, then let socket.io reconnect.
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed) socket?.connect();
    else setTimeout(() => socket?.connect(), 5000);
  });
  return socket;
}

export function closeSocket() {
  socket?.removeAllListeners();
  socket?.close();
  socket = null;
}
