import { describe, it, expect } from 'vitest';
import { extractOtp, extractLinks, extractVerificationLink, extractLinkByText, hasText } from './extract.js';
import { Email } from './types.js';

const mockEmail = (bodyText: string | null, bodyHtml: string | null): Email => ({
  id: 'msg_1',
  inboxId: 'inbox_1',
  from: 'sender@example.com',
  subject: 'Test email',
  bodyText,
  bodyHtml,
  rawSize: 100,
  receivedAt: new Date(),
});

describe('OTP Extraction', () => {
  it('extracts simple numeric code from text email', () => {
    const email = mockEmail('Your code is 123456.', null);
    expect(extractOtp(email)).toBe('123456');
  });

  it('extracts code using keyword proximity scoring', () => {
    const email = mockEmail('Order #202618. Support call +123456789. Your verification code: 987654.', null);
    expect(extractOtp(email)).toBe('987654');
  });

  it('extracts alphanumeric codes when requested', () => {
    const email = mockEmail('Your Slack confirmation code is AB-C123.', null);
    expect(extractOtp(email, { alphanumeric: true })).toBe('AB-C123');
  });

  it('strips html and extracts code', () => {
    const email = mockEmail(null, '<p>Your one-time password is <b>883712</b>.</p>');
    expect(extractOtp(email)).toBe('883712');
  });
});

describe('Link Extraction', () => {
  it('extracts links from HTML href', () => {
    const email = mockEmail(
      null,
      'Click <a href="https://example.com/confirm?token=xyz">here</a> or go to <a href="mailto:test@test.com">email</a>'
    );
    expect(extractLinks(email)).toEqual(['https://example.com/confirm?token=xyz']);
  });

  it('extracts bare links from text', () => {
    const email = mockEmail('Go to https://example.com/verify or https://another.com', null);
    expect(extractLinks(email)).toEqual(['https://example.com/verify', 'https://another.com']);
  });

  it('extracts verification link matching keywords', () => {
    const email = mockEmail(
      null,
      '<a href="https://example.com/terms">Terms</a> and <a href="https://example.com/activate?user=123">Activate</a>'
    );
    expect(extractVerificationLink(email)).toBe('https://example.com/activate?user=123');
  });

  it('respects domain allowlist for verification link', () => {
    const email = mockEmail(
      null,
      '<a href="https://bad.com/verify">Verify Bad</a> and <a href="https://good.com/verify">Verify Good</a>'
    );
    expect(extractVerificationLink(email, { domainAllowlist: ['good.com'] })).toBe('https://good.com/verify');
  });
});

describe('extractLinkByText', () => {
  it('extracts URL by matching text inside anchor tags case-insensitively', () => {
    const email = mockEmail(
      null,
      '<a href="https://example.com/reset">RESET password</a> or <a href="https://example.com/help">Help</a>'
    );
    expect(extractLinkByText(email, 'reset')).toBe('https://example.com/reset');
    expect(extractLinkByText(email, 'HELP')).toBe('https://example.com/help');
    expect(extractLinkByText(email, 'nonexistent')).toBe('');
  });

  it('handles nested HTML tags inside anchor text', () => {
    const email = mockEmail(
      null,
      '<a href="https://example.com/confirm"><b>Confirm</b> your email</a>'
    );
    expect(extractLinkByText(email, 'confirm your email')).toBe('https://example.com/confirm');
  });

  it('extracts URL from plain text line containing the search term', () => {
    const email = mockEmail(
      'To verify, click this link: https://example.com/verify-me\nOtherwise ignore.',
      null
    );
    expect(extractLinkByText(email, 'verify')).toBe('https://example.com/verify-me');
  });

  it('returns empty string if nothing matches', () => {
    const email = mockEmail('Plain text body without link.', null);
    expect(extractLinkByText(email, 'verify')).toBe('');
  });
});

describe('hasText', () => {
  it('detects search text inside email subject', () => {
    const email = mockEmail('Body text', null);
    email.subject = 'Invoice #1024';
    expect(hasText(email, 'invoice')).toBe(true);
    expect(hasText(email, '#1024')).toBe(true);
    expect(hasText(email, 'receipt')).toBe(false);
  });

  it('detects search text inside bodyText', () => {
    const email = mockEmail('Your shipping code is XYZ-987.', null);
    expect(hasText(email, 'shipping code')).toBe(true);
    expect(hasText(email, 'XYZ-987')).toBe(true);
    expect(hasText(email, 'invoice')).toBe(false);
  });

  it('detects search text inside stripped bodyHtml', () => {
    const email = mockEmail(null, '<p>Please click <b>here</b> to verify.</p>');
    expect(hasText(email, 'click here')).toBe(true);
    expect(hasText(email, 'verify')).toBe(true);
    expect(hasText(email, '<b>')).toBe(false); // HTML tags are stripped
  });
});

