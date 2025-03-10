import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerGateway } from './workerGateway.service';

// export interface Job {
//   id: string;
//   clientId: string;
//   data: any;
//   status: 'pending' | 'processing' | 'completed' | 'failed';
//   result?: any;
//   error?: string;
//   createdAt: Date;
//   updatedAt: Date;
// }

export interface Job {
  id: string;
  // data: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  fn: Function;
  params: any;
}

@Injectable()
export class QueueService {
  private queue: Job[] = [];
  private processingJobs: Map<string, Job> = new Map();
  private isProcessing: boolean = false;
  private workerGateway: WorkerGateway;

  constructor(private readonly configService: ConfigService) {}

  async addJob(job: Job) {
    this.queue.push(job);

    if (!this.isProcessing) {
      this.processQueue();
    }

    return job;
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift();

    try {
      job.status = 'processing';
      job.updatedAt = new Date();

      this.processingJobs.set(job.id, job);

      await this.processJob(job);

      this.processQueue();
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);

      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date();

      // Notify clients about the failed job
      this.workerGateway.notifyJobCompleted(job);

      // Remove from processing jobs
      this.processingJobs.delete(job.id);

      // Continue processing the queue
      this.processQueue();
    }
  }

  private async processJob(job: Job) {
    try {
      const result = await job.fn(job.params);

      job.status = 'completed';
      job.result = result;
      job.updatedAt = new Date();
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);

      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date();

      this.workerGateway.notifyJobCompleted(job);

      this.processingJobs.delete(job.id);

      this.processQueue();
    }
  }
}
