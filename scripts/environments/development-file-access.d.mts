import type {FileSystemServeOptions} from 'vite';
export function developmentFileAccess(root:string,sharedReceipts?:boolean):Required<Pick<FileSystemServeOptions,'strict'|'allow'|'deny'>>;
