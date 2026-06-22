// Public surface of @testmail-stream/sdk
// Import only what you need — everything is tree-shakeable.

export { TestmailClient } from './client.js';

export type {
  Inbox,
  Email,
  Team,
  TeamMember,
  TeamDetail,
  Attachment,
  CreateInboxOptions,
  CreateTeamOptions,
  WaitForEmailOptions,
  SearchEmailsOptions,
  EmailPage,
  AttachmentDownload,
  ClientOptions,
  ExtractOtpOptions,
  ExtractLinkOptions,
  WaitForOtpOptions,
  WaitForLinkOptions,
} from './types.js';

export {
  extractOtp,
  extractLinks,
  extractVerificationLink,
  extractLinkByText,
  hasText,
  normalizeText,
  normalizeWhitespace,
  findEmailBySubject,
  findEmailByText,
} from './extract.js';

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
