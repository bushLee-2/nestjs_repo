import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private jobDependencies = new Map<string, string[]>();
  private isProcessing = false;

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);

    if (job.dependsOn && job.dependsOn.length > 0) {
      this.jobDependencies.set(job.id, [...job.dependsOn]);
    }

    this.logger.log('enqueueJob: ', job);
    // TODO: send ws message that it was queued

    if (!this.isProcessing) {
      this.isProcessing = true;
      this.processQueue();
    }
  }

  private async processQueue() {
    try {
      while (this.jobQueue.length > 0) {
        const job = this.jobQueue.shift();
        if (!job) continue;

        this.processJob(job);
      }
    } catch (error) {
      // TODO: send ws message with error here
      this.logger.error(
        `Error processing job queue: ${error.message}`,
        error.stack,
      );
      throw new Error(
        `Error processing job queue: ${error.message}`,
        error.stack,
      );
    }
  }

  private async processJob(job: Job) {
    try {
      this.logger.log(`Processing job ${job.id} (clientId: ${job.clientId})`);
      if (job.status == JobStatus.FAILED) {
        this.logger.error(`Job failed due to ${job.error}`);
        this.cleanJobMap(job.id);
        return;
      }
      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();

      // region Check if any dependencies
      if (job.dependsOn && job.dependsOn.length > 0) {
        for (const depJobId of job.dependsOn) {
          const depJob = this.jobMap.get(depJobId);
          if (!depJob) {
            this.logger.error(
              `Dependency job ID ${depJobId} not found for job ${job.id}`,
            );
            throw new Error(`Dependency job ID ${depJobId} not found`);
          }

          if (depJob.status === JobStatus.FAILED) {
            this.logger.error(
              `Dependency job ID ${depJobId} failed, failing job ${job.id}`,
            );
            throw new Error(
              `Dependency job ID ${depJobId} failed with error: ${depJob.error}`,
            );
          }
        }
        // endregion

        const allDependenciesResolved = job.dependsOn.every(
          (depJobId) =>
            this.jobMap.get(depJobId)?.status === JobStatus.COMPLETED,
        );

        if (allDependenciesResolved) {
          this.logger.debug(
            `All dependencies resolved for job ${job.id}, executing function`,
          );
          const depResults = job.dependsOn.map(
            (depJobId) => this.jobMap.get(depJobId)?.result,
          );

          const jobResult = await job.fn(
            ...(job.parameters || []),
            ...depResults,
          );
          job.result = jobResult;
          job.status = JobStatus.COMPLETED;
          job.updatedAt = new Date();
          this.logger.log(
            `Job ${job.id} completed successfully (clientId: ${job.clientId})`,
          );

          this.cleanJobMap(job.id);
        } else {
          this.logger.debug(
            `Not all dependencies completed for job ${job.id}, re-queuing`,
          );
          this.jobQueue.push(job);
          return; // Return to avoid marking as complete
        }
      } else {
        this.logger.debug(
          `Job ${job.id} has no dependencies, executing directly`,
        );
        job.result = await job.fn(...(job.parameters || []));
        job.status = JobStatus.COMPLETED;
        job.updatedAt = new Date();

        // Clean up if no other jobs depend on this one
        this.cleanJobMap(job.id);
        // TODO: Send websocket message about job completion
      }
    } catch (error) {
      job.error = error.message;
      job.status = JobStatus.FAILED;
      job.updatedAt = new Date();
      // Mark dependent jobs as failed
      this.failDependentJobs(job.id);
      this.cleanJobMap(job.id);

      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
      // TODO: Send websocket message about job failure
      throw new Error(`Job ${job.id} failed: ${error.message}`, error.stack);
    } finally {
      // set the is processing flag
      if (
        this.jobQueue.length === 0 &&
        !Array.from(this.jobMap.values()).some(
          (j) => j.status === JobStatus.PROCESSING,
        )
      ) {
        this.isProcessing = false;
      }
    }
  }

  private failDependentJobs(failedJobId: string) {
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
