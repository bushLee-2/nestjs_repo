export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class Job {
  id: string;
  fn: Function;
  parameters?: any;
  status: JobStatus;
  dependsOn?: string | string[];
  result?: any;
  error?: string;
  clientId: string;
  createdAt: Date;
  updatedAt: Date;
}
