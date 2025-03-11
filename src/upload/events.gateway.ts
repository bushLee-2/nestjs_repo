import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsResponse,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { Job } from './interfaces/job.interface';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // Maps clientId to active socket ID (only one allowed)
  private activeClients = new Map<string, string>();

  // Maps socket ID to client ID for quick lookup on disconnect
  private socketToClient = new Map<string, string>();

  private messageCounter = new Map<string, number>(); // Rate limit counter
  private readonly MAX_MESSAGES_PER_MINUTE = 60;

  handleConnection(client: Socket) {
    const clientId = client.handshake.query.clientId as string;
    if (!clientId) {
      this.logger.warn('Client connected without clientId, disconnecting');
      client.disconnect();
      return;
    }

    // TODO: Add some kind of auth mechanism so you can call disconect() when it fails

    // Check if this clientId already has an active connection
    if (this.activeClients.has(clientId)) {
      const existingSocketId = this.activeClients.get(clientId);

      // Get the existing socket
      if (existingSocketId) {
        const existingSocket =
          this.server.sockets.sockets.get(existingSocketId);

        if (existingSocket) {
          this.logger.debug(
            `Client ${clientId} already has an active connection (${existingSocketId}). Disconnecting old socket.`,
          );

          // Notify the existing client that it's being disconnected
          existingSocket.emit('connection_replaced', {
            message: 'Your connection was replaced by a new session',
          });

          // Disconnect the existing socket
          existingSocket.disconnect(true);

          // Clean up maps for the old socket
          this.socketToClient.delete(existingSocketId);
        }
      }
    }

    // Store this as the active connection for this clientId
    this.activeClients.set(clientId, client.id);
    this.socketToClient.set(client.id, clientId);

    // Join a room based on the clientId
    client.join(clientId);

    // Initialize or reset rate limiting for this client
    this.messageCounter.set(clientId, 0);

    this.logger.debug(
      `Client connected: ${client.id} for clientId: ${clientId} (now the active connection)`,
    );

    // Inform the client they are now connected
    client.emit('connection_established', {
      message: 'You are now the active connection for this client ID',
    });
  }

  handleDisconnect(client: Socket) {
    const socketId = client.id;
    const clientId = this.socketToClient.get(socketId);

    if (clientId) {
      this.logger.debug(
        `Client disconnected: ${socketId} for clientId: ${clientId}`,
      );

      // Check if this was the active socket for this clientId
      if (this.activeClients.get(clientId) === socketId) {
        this.activeClients.delete(clientId);
        this.messageCounter.delete(clientId);
      }

      // Clean up the socket-to-client mapping
      this.socketToClient.delete(socketId);

      // Have the socket leave the room
      client.leave(clientId);
    }
  }

  @SubscribeMessage('requestJobStatus')
  handleJobStatusRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { jobId: string },
  ): WsResponse<any> {
    const socketId = client.id;
    const clientId = this.socketToClient.get(socketId);

    // Verify this is the active connection for this clientId
    if (!clientId || this.activeClients.get(clientId) !== socketId) {
      return {
        event: 'error',
        data: {
          message:
            'This connection is not the active session for this client ID',
        },
      };
    }

    // Rate limiting check
    if (this.isRateLimited(clientId)) {
      return {
        event: 'error',
        data: { message: 'Rate limit exceeded. Please try again later.' },
      };
    }

    // Increment message counter for rate limiting
    this.incrementMessageCount(clientId);

    return {
      event: 'jobStatusResponse',
      data: { jobId: payload.jobId, status: 'requested' },
    };
  }

  sendJobUpdate(clientId: string, job: Job) {
    try {
      if (!this.isClientConnected(clientId)) {
        this.logger.debug(
          `Client ${clientId} not connected, skipping job update for job ${job.id}`,
        );
        return;
      }

      if (job.sendResponse) {
        // Create a sanitized version of the job to send to the client
        const jobUpdate = this.sanitizeJobForClient(job);
        // Send the update to the client's room
        this.server.to(clientId).emit('jobUpdate', jobUpdate);
      }
    } catch (error) {
      this.logger.error(
        `Error sending job update to client ${clientId} for job ${job.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // Returns if the client has an active connection
  isClientConnected(clientId: string): boolean {
    return this.activeClients.has(clientId);
  }

  // Check if client is rate limited
  private isRateLimited(clientId: string): boolean {
    const count = this.messageCounter.get(clientId) || 0;
    return count >= this.MAX_MESSAGES_PER_MINUTE;
  }

  // Increment message count for rate limiting
  private incrementMessageCount(clientId: string): void {
    const currentCount = this.messageCounter.get(clientId) || 0;
    this.messageCounter.set(clientId, currentCount + 1);
  }

  // Create a sanitized version of the job with only the necessary information
  private sanitizeJobForClient(job: Job): any {
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.result,
      error: job.error,
      //   TODO: remove in production
      name: job.fn.name,
    };
  }
}
