export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class Job {
  id: string;
  fn: Function;
  parameters: any[] = [];
  status: JobStatus;
  dependsOn: string[] = [];
  result?: any;
  error?: string;
  // TODO: remove the "?"
  clientId?: string;
  createdAt: Date;
  updatedAt: Date;
  //  TODO: add a rety limit for failed jobs ?
  //        mark jobs that should return a websocket message
}
