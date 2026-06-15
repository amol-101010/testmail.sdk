// Public surface of @testmail/sdk
// Import only what you need — everything is tree-shakeable.

export { TestmailClient } from './client.js';

export type {
  Inbox,
  Email,
  CreateInboxOptions,
  WaitForEmailOptions,
  ClientOptions,
} from './types.js';

export {
  TestmailError,
  ApiError,
  AuthError,
  AliasConflictError,
  TimeoutError,
  RequestTimeoutError,
  PlanRestrictionError,
  QuotaExceededError,
} from './errors.js';

// Named re-export for convenience
export { pollForEmail } from './poller.js';
