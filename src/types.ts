export interface Config {
  apiKey: string;
  llmsUrl: string;
}

export interface LLMSDocItem {
  title: string;
  content: string;
  url: string;
  topic: string;
}

export interface UploadTask {
  id: string;
  status: 'pending' | 'in_progress' | 'done' | 'error';
  progress: number;
  message?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface DocHashEntry {
  url: string;
  hash: string;
  lastUploaded: number;
}
