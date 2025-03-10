import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsResponse,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { Job, BatchJob } from './interfaces/job.interface';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private clientMap = new Map<string, string[]>(); // Maps clientId to socket IDs

  handleConnection(client: Socket) {
    const clientId = client.handshake.query.clientId as string;
    if (!clientId) {
      this.logger.warn('Client connected without clientId, disconnecting');
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${client.id} for clientId: ${clientId}`);

    // Add this socket to the clientId mapping
    if (!this.clientMap.has(clientId)) {
      this.clientMap.set(clientId, []);
    }
    this.clientMap.get(clientId).push(client.id);

    // Join a room based on the clientId
    client.join(clientId);
  }

  handleDisconnect(client: Socket) {
    const clientId = client.handshake.query.clientId as string;
    if (clientId) {
      this.logger.log(
        `Client disconnected: ${client.id} for clientId: ${clientId}`,
      );

      // Remove this socket from the clientId mapping
      if (this.clientMap.has(clientId)) {
        const sockets = this.clientMap.get(clientId);
        const index = sockets.indexOf(client.id);
        if (index !== -1) {
          sockets.splice(index, 1);
        }
        if (sockets.length === 0) {
          this.clientMap.delete(clientId);
        }
      }
    }
  }

  @SubscribeMessage('requestJobStatus')
  handleJobStatusRequest(
    client: Socket,
    payload: { jobId: string },
  ): WsResponse<any> {
    this.logger.log(
      `Client ${client.id} requested job status for job ${payload.jobId}`,
    );
    return {
      event: 'jobStatusResponse',
      data: { jobId: payload.jobId, status: 'requested' },
    };
  }

  sendJobUpdate(clientId: string, job: Job) {
    this.logger.debug(
      `Sending job update to client ${clientId} for job ${job.id}`,
    );
    this.server.to(clientId).emit('jobUpdate', job);
  }

  sendBatchJobUpdate(clientId: string, batchJob: BatchJob) {
    this.logger.debug(
      `Sending batch job update to client ${clientId} for batch job ${batchJob.id}`,
    );
    this.server.to(clientId).emit('batchJobUpdate', batchJob);
  }

  // Returns if the client is currently connected
  isClientConnected(clientId: string): boolean {
    return (
      this.clientMap.has(clientId) && this.clientMap.get(clientId).length > 0
    );
  }
}
