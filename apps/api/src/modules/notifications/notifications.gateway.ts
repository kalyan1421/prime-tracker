import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(NotificationsGateway.name);
  private userSockets = new Map<string, Set<string>>(); // userId → Set<socketId>

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }
      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.data.userId = payload.sub;
      if (!this.userSockets.has(payload.sub)) this.userSockets.set(payload.sub, new Set());
      this.userSockets.get(payload.sub)!.add(client.id);
      client.join(`user:${payload.sub}`);
      this.logger.debug(`Client ${client.id} connected for user ${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) this.userSockets.delete(userId);
    }
  }

  emitToUser(userId: string, event: string, data: unknown) {
    // `server` is only injected once the Socket.IO adapter has initialised, which happens
    // in main.ts on listen(). Anything that boots AppModule WITHOUT an HTTP server —
    // NestFactory.createApplicationContext, as prisma/qa-unit-history-check.ts does — has
    // no gateway, and an unguarded call threw inside every notifications.send(). EventBus
    // swallows handler errors by design, so that surfaced as notifications silently never
    // arriving rather than as a failure. Live delivery is a best-effort extra on top of
    // the row already written to the DB; its absence must never break the send.
    this.server?.to(`user:${userId}`).emit(event, data);
  }
}
