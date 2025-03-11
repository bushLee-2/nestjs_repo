import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';
import { EventsGateway } from './events.gateway';
// TODO: Make sure all independent jobs are eventually cleared
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private jobDependencies = new Map<string, string[]>();
  private isProcessing = false;

  constructor(private readonly eventsGateway: EventsGateway) {}

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);

    if (job.dependsOn && job.dependsOn.length > 0) {
      this.jobDependencies.set(job.id, [...job.dependsOn]);
    }

    this.logger.log(`enqueueJob: , ${job.id}, ${job.fn.name} ${job.clientId}`);
    this.logger.debug(`enqueueJob: , ${job.id}, ${job.fn.name}`);
    this.eventsGateway.sendJobUpdate(job.clientId, job);

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

        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error(
        `Error processing job queue: ${error.message}`,
        error.stack,
      );
      // Continue th queue
      if (this.jobQueue.length > 0) {
        this.processQueue()
      }
    }
  }

  private async processJob(job: Job) {
    try {
      this.logger.log(
        `Processing job ${job.id} ${job.fn.name} (clientId: ${job.clientId})`,
      );
      if (job.status == JobStatus.FAILED) {
        this.eventsGateway.sendJobUpdate(job.clientId, job);
        this.logger.error(`Job failed due to ${job.error}`);
        this.cleanJobMap(job.id);
        return;
      }

      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();
      this.eventsGateway.sendJobUpdate(job.clientId, job);

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

          this.eventsGateway.sendJobUpdate(job.clientId, job);

          this.logger.log(
            `Job ${job.id} ${job.fn.name} completed successfully (clientId: ${job.clientId})`,
          );

          this.cleanJobMap(job.id);
        } else {
          this.logger.debug(
            `Not all dependencies completed for job ${job.id}, re-queuing`,
          );
          this.jobQueue.push(job);
          setImmediate(() => this.processQueue());
          return; // Return to avoid marking as complete
        }
      } else {
        this.logger.debug(
          `Job ${job.id}  ${job.fn.name} has no dependencies, executing directly`,
        );
        job.result = await job.fn(...(job.parameters || []));
        job.status = JobStatus.COMPLETED;
        job.updatedAt = new Date();

        // Clean up if no other jobs depend on this one
        this.cleanJobMap(job.id);
      }
    } catch (error) {
      job.error = error.message;
      job.status = JobStatus.FAILED;
      job.updatedAt = new Date();

      this.eventsGateway.sendJobUpdate(job.clientId, job);

      // Mark dependent jobs as failed
      this.failDependentJobs(job.id);
      this.cleanJobMap(job.id);

      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
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
      this.deleteParentJobs(jobId);
      this.jobMap.delete(jobId);
      this.jobDependencies.delete(jobId);
    }
  }

  private deleteParentJobs(dependentJobId: string) {
    const job = this.jobMap.get(dependentJobId);
    if (!job || !job.dependsOn || job.dependsOn.length === 0) {
      return; // No dependencies to process
    }

    const parentJobIds = job.dependsOn;

    // Process each parent job
    for (const parentJobId of parentJobIds) {
      let canDelete = true;

      // Check if any other active job depends on this parent job
      for (const [otherJobId, otherJob] of this.jobMap.entries()) {
        // Skip the current dependent job we're processing
        if (otherJobId === dependentJobId) {
          continue;
        }

        // Skip jobs that are already completed or failed
        if (
          otherJob.status === JobStatus.COMPLETED ||
          otherJob.status === JobStatus.FAILED
        ) {
          continue;
        }

        // If this active job depends on our parent, we can't delete the parent
        if (otherJob.dependsOn && otherJob.dependsOn.includes(parentJobId)) {
          canDelete = false;
          break;
        }
      }

      // If no other active job depends on this parent, we can delete it
      if (canDelete) {
        this.logger.debug(
          `Removing parent job ${parentJobId} as no active jobs depend on it`,
        );
        this.jobMap.delete(parentJobId);
        this.jobDependencies.delete(parentJobId);

        // Recursively check if this parent job's dependencies can also be deleted
        this.deleteParentJobs(parentJobId);
      }
    }
  }
}
