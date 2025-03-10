import { Injectable } from '@nestjs/common';
import { Job, JobStatus } from './interfaces/job.interface';

@Injectable()
export class JobService {
  private jobQueue: Job[] = [];
  private jobMap = new Map<string, Job>();
  private jobDependencies = new Map<string, string[]>();
  private isProcessing = false;

  public async enqueueJob(job: Job): Promise<void> {
    this.jobQueue.push(job);
    this.jobMap.set(job.id, job);
    if (job.dependsOn) {
      this.jobDependencies.set(job.id, job.dependsOn);
    }
    //   TODO: send ws message that it was queued

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    try {
      while (this.jobQueue.length > 0) {
        const job: Job = this.jobQueue.shift();
        await this.processJob(job);
      }
    } catch (error) {
      //   TODO: send ws message with error here ?
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: Job) {
    // region Check if any of the dependecies failed
    if (job.dependsOn && job.dependsOn.length > 0) {
      for (const debJobId of job.dependsOn) {
        if (this.jobMap.get(debJobId).status === JobStatus.FAILED) {
          job.status = JobStatus.FAILED;
          throw new Error(
            `Job ID ${debJobId} failed with status ${this.jobMap[debJobId].error}`,
          );
        }
      }
    }
    // endregion

    try {
      job.status = JobStatus.PROCESSING;
      job.updatedAt = new Date();

      // region Job dependecies
      if (job.dependsOn && job.dependsOn.length > 0) {
        let allDependeciesResolved: boolean = true;
        for (const debJobId of job.dependsOn) {
          if (this.jobMap.get(debJobId).status !== JobStatus.COMPLETED) {
            allDependeciesResolved = false;
            break;
          }
        }

        if (allDependeciesResolved) {
          const results = []
          for (const debJobId of job.dependsOn) {
            let result = this.jobMap.get(debJobId).result;
            results.push(...result);
          }
          const jobResult = await job.fn(...job.parameters, ...results);
          job.result = jobResult;
          job.status = JobStatus.COMPLETED;
          this.cleanJobMap(job.id)
        } else {
          this.jobQueue.push(job);
        }
        //   endregion
      } else {
        job.result = await job.fn(...job.parameters);
        job.status = JobStatus.COMPLETED;
        //   Delete job from map if there are no dependencies for it
        this.cleanJobMap(job.id)
      }
    } catch (error) {
      job.error = error.message;
      job.status = JobStatus.FAILED;
    }
  }

  private cleanJobMap(jobToCheck: string) {
    let toDelete = true;
    for (const [_, job] of this.jobMap.entries()) {
      if (job.dependsOn && job.dependsOn.includes(jobToCheck)) {
        toDelete = false;
        break;
      }
    }

    if (toDelete) {
      this.jobMap.delete(jobToCheck);
    }}
}
