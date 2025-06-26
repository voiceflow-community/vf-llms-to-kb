import dotenv from 'dotenv';
dotenv.config();
import { Config } from './types';

export function getConfig(overrides?: Partial<Config>): Config {
  return {
    apiKey: overrides?.apiKey || process.env.API_KEY || '',
    llmsUrl: overrides?.llmsUrl || process.env.LLMS_URL || '',
  };
}

export function getApiBaseUrl(): string {
  const domain = process.env.DOMAIN || 'voiceflow.com';
  return `https://api.${domain}`;
}
