import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private jobDependencies = new Map<string, string[]>();
  private isProcessing = false;

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);

    if (job.dependsOn && job.dependsOn.length > 0) {
      this.jobDependencies.set(job.id, [...job.dependsOn]); // Use spread operator to clone array
    }

    // TODO: send ws message that it was queued

    if (!this.isProcessing) {
      this.isProcessing = true; // Set flag before starting processing
      this.processQueue();
    }
  }

  private async processQueue() {
    try {
      while (this.jobQueue.length > 0) {
        const job = this.jobQueue.shift();
        if (!job) continue;

        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error(
        `Error processing job queue: ${error.message}`,
        error.stack,
      );
      // TODO: send ws message with error here
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: Job) {
    try {
      // Update job status
      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();

      // Check if any dependencies failed
      if (job.dependsOn && job.dependsOn.length > 0) {
        for (const depJobId of job.dependsOn) {
          const depJob = this.jobMap.get(depJobId);
          if (!depJob) {
            throw new Error(`Dependency job ID ${depJobId} not found`);
          }

          if (depJob.status === JobStatus.FAILED) {
            throw new Error(
              `Dependency job ID ${depJobId} failed with error: ${depJob.error}`,
            );
          }
        }

        // Check if all dependencies are completed
        const allDependenciesResolved = job.dependsOn.every(
          (depJobId) =>
            this.jobMap.get(depJobId)?.status === JobStatus.COMPLETED,
        );

        if (allDependenciesResolved) {
          // Collect results from dependencies
          const depResults = job.dependsOn.map(
            (depJobId) => this.jobMap.get(depJobId)?.result,
          );

          // Execute the job function with parameters and dependency results
          const jobResult = await job.fn(
            ...(job.parameters || []),
            ...depResults,
          );
          job.result = jobResult;
          job.status = JobStatus.COMPLETED;
          job.updatedAt = new Date();

          // Clean up job map if no other jobs depend on this one
          this.cleanJobMap(job.id);
        } else {
          // Re-queue the job if dependencies aren't all completed
          this.jobQueue.push(job);
          return; // Exit early to avoid marking as complete
        }
      } else {
        // No dependencies, execute directly
        job.result = await job.fn(...(job.parameters || []));
        job.status = JobStatus.COMPLETED;
        job.updatedAt = new Date();

        // Clean up if no other jobs depend on this one
        this.cleanJobMap(job.id);
      }

      // TODO: Send websocket message about job completion
    } catch (error) {
      job.error = error.message;
      job.status = JobStatus.FAILED;
      job.updatedAt = new Date();
      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);

      // TODO: Send websocket message about job failure

      // Mark dependent jobs as failed
      this.failDependentJobs(job.id);
    }
  }

  private failDependentJobs(failedJobId: string) {
    // Find all jobs that depend on the failed job
    for (const [jobId, deps] of this.jobDependencies.entries()) {
      if (deps.includes(failedJobId)) {
        const job = this.jobMap.get(jobId);
        if (job && job.status !== JobStatus.FAILED) {
          job.status = JobStatus.FAILED;
          job.error = `Dependency job ${failedJobId} failed`;
          job.updatedAt = new Date();

          // Recursively fail jobs that depend on this one
          this.failDependentJobs(jobId);
        }
      }
    }
  }

  private cleanJobMap(jobId: string) {
    // Check if any other jobs depend on this one
    let canDelete = true;
    for (const deps of this.jobDependencies.values()) {
      if (deps.includes(jobId)) {
        canDelete = false;
        break;
      }
    }

    if (canDelete) {
      this.jobMap.delete(jobId);
      this.jobDependencies.delete(jobId);
    }
  }
}
