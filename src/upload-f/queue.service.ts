import { Injectable } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';

@Injectable()
export class JobService {
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private jobDependencies = new Map<string, string[]>();
  private jobResults = new Map<string, any>;
  private isProcessing = false;

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);

    if (Array.isArray(job.dependsOn)) {
      for (const dependentJob in job.dependsOn) {
        this.jobDependencies[job.id].append(dependentJob);
      }
    } else {
      this.jobDependencies[job.id].append(job.dependsOn);
    }

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  public async enqueueBatchJob(job: Job): Promise<void> {}

  private async processQueue() {
    if (!this.isProcessing) {
      return;
    }

    try {
      while (this.jobQueue.length > 0) {
        const job = this.jobQueue.shift();
        await this.processJob(job);
      }
    } catch (error) {}
  }

  private async processJob(job: Job): Promise<void> {
    try {
      // Update job status to processing
      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();
      // this.notifyClient(job);
      if (!job.parameters) {
      }
      const result = await job.fn();

      // Update job status to completed
      job.status = JobStatus.COMPLETED;
      job.updatedAt = new Date();
      // this.notifyClient(job);

      console.log(`Job completed: ${job.id}`);
    } catch (error) {
      console.error(`Job failed: ${job.id}`, error.stack);

      // Update job status to failed
      job.status = JobStatus.FAILED;
      job.error = error.message;
      job.updatedAt = new Date();
      // this.notifyClient(job);
    }
  }
}
