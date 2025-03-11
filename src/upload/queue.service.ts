import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';
import { EventsGateway } from './events.gateway';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private waitingJobs = new Map<string, boolean>();
  private jobDependencies = new Map<string, string[]>();
  private activeJobCount = 0;
  private maxConcurrentJobs = 10;

  constructor(private readonly eventsGateway: EventsGateway) {}

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);

    if (job.dependsOn && job.dependsOn.length > 0) {
      this.jobDependencies.set(job.id, [...job.dependsOn]);
    }

    this.logger.log(`enqueueJob: ${job.id}, ${job.fn.name} ${job.clientId}`);
    this.logger.debug(`enqueueJob: ${job.id}, ${job.fn.name}`);
    this.eventsGateway.sendJobUpdate(job.clientId, job);

    this.processQueue();
  }

  private async processQueue() {
    // If there are no jobs to process or we're already at max capacity, just return
    if (this.jobQueue.length === 0 || this.activeJobCount >= this.maxConcurrentJobs) {
      return;
    }

    // Process as many jobs as we can up to the max concurrent limit
    while (this.jobQueue.length > 0 && this.activeJobCount < this.maxConcurrentJobs) {
      const job = this.jobQueue.shift();
      if (!job) continue;

      // Skip jobs that are already waiting on dependencies
      if (this.waitingJobs.has(job.id)) {
        continue;
      }

      // Check if job has dependencies that are not completed
      if (job.dependsOn && job.dependsOn.length > 0) {
        const pendingDependencies = job.dependsOn.filter(depId => {
          const depJob = this.jobMap.get(depId);
          return !depJob || depJob.status !== JobStatus.COMPLETED;
        });

        if (pendingDependencies.length > 0) {
          // Mark this job as waiting and put it back in the queue
          this.waitingJobs.set(job.id, true);
          this.jobQueue.push(job);
          continue; // Skip to the next job instead of processing this one
        }

        // All dependencies are completed, remove from waiting list if it was there
        this.waitingJobs.delete(job.id);
      }

      this.activeJobCount++;

      // Process the job without awaiting
      this.processJob(job)
      .catch(error => {
        this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);
      })
      .finally(() => {
        this.activeJobCount--;

        // After a job completes, check if any waiting jobs can now proceed
        this.checkWaitingJobs();

        // When a job finishes, try to process more from the queue
        this.processQueue();
      });
    }
  }

  private checkWaitingJobs() {
    // For each waiting job, check if all dependencies are now completed
    for (const [jobId, _] of this.waitingJobs) {
      const job = this.jobMap.get(jobId);
      if (!job) {
        this.waitingJobs.delete(jobId);
        continue;
      }

      const allDependenciesCompleted = job.dependsOn.every(depId => {
        const depJob = this.jobMap.get(depId);
        return depJob && depJob.status === JobStatus.COMPLETED;
      });

      if (allDependenciesCompleted) {
        // This job can now proceed
        this.waitingJobs.delete(jobId);

        // Make sure the job is in the queue
        if (!this.jobQueue.some(queuedJob => queuedJob.id === jobId)) {
          this.jobQueue.push(job);
        }
      }
    }
  }

  private async processJob(job: Job) {
    try {
      this.logger.log(
      `Processing job ${job.id} ${job.fn.name} (clientId: ${job.clientId})`,
      );

      if (job.status === JobStatus.FAILED) {
        this.eventsGateway.sendJobUpdate(job.clientId, job);
        this.logger.error(`Job failed due to ${job.error}`);
        this.cleanJobMap(job.id);
        return;
      }

      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();
      this.eventsGateway.sendJobUpdate(job.clientId, job);

      // Check for dependency failures
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

        // Get results from completed dependencies
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
      } else {
        // No dependencies, just execute with parameters
        job.result = await job.fn(...(job.parameters || []));
        job.status = JobStatus.COMPLETED;
        job.updatedAt = new Date();
      }

      // Job completed successfully
      this.eventsGateway.sendJobUpdate(job.clientId, job);
      this.logger.log(
      `Job ${job.id} ${job.fn.name} completed successfully (clientId: ${job.clientId})`,
      );

      // Clean up job resources
      this.cleanJobMap(job.id);

      // When a job completes, check if any waiting jobs can now be processed
      this.checkWaitingJobs();

    } catch (error) {
      job.error = error.message;
      job.status = JobStatus.FAILED;
      job.updatedAt = new Date();

      this.eventsGateway.sendJobUpdate(job.clientId, job);

      // Mark dependent jobs as failed
      this.failDependentJobs(job.id);
      this.cleanJobMap(job.id);

      this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
      throw error;
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

          // Remove from waiting list if it was there
          this.waitingJobs.delete(jobId);

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
      this.waitingJobs.delete(jobId);
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
        this.waitingJobs.delete(parentJobId);

        // Recursively check if this parent job's dependencies can also be deleted
        this.deleteParentJobs(parentJobId);
      }
    }
  }
}