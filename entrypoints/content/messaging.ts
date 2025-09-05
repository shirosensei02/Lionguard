import { api } from '../core/browserApi';

export function sendRuntimeMessage<T>(msg: any): Promise<T> {
  return new Promise((resolve) => api.runtime.sendMessage(msg, (resp: T) => resolve(resp)));
}