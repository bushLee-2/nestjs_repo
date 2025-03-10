import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { Job } from './queue.service';

@WebSocketGateway({
  cors: {
    origin: '*', // Configure according to your security requirements
  },
  namespace: '/jobs',
})
@Injectable()
export class WorkerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private clients: Map<string, string> = new Map();

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() clientId: string,
  ) {
    this.clients.set(clientId, client.id);
    console.log(`Client registered: ${clientId} with socket ${client.id}`);
    return { event: 'registered', data: { status: 'success', clientId } };
  }

  handleDisconnect(client: Socket) {
    // Find and remove the disconnected client
    for (const [clientId, socketId] of this.clients.entries()) {
      if (socketId === client.id) {
        this.clients.delete(clientId);
        console.log(`Client disconnected: ${clientId}`);
        break;
      }
    }
  }

  notifyJobCompleted(job: Job): void {
    const socketId = this.clients.get(job.clientId);

    if (socketId) {
      this.server.to(socketId).emit('jobCompleted', job);
      console.log(
        `Notification sent to client ${job.clientId} for job ${job.id}`,
      );
    } else {
      console.log(
        `Client ${job.clientId} not connected, couldn't send notification for job ${job.id}`,
      );
    }
  }
}
