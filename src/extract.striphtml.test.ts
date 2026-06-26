import { describe, it, expect } from 'vitest';
import { hasText, extractOtp, extractVerificationLink } from './extract.js';
import { Email } from './types.js';

const html = (bodyHtml: string): Email => ({
  id: '1',
  inboxId: '1',
  from: null,
  subject: null,
  bodyText: null,
  bodyHtml,
  rawSize: null,
  receivedAt: new Date(),
  auth: { spf: null, dkim: null, dmarc: null },
});

describe('stripHtml does not leak <style>/<script> contents', () => {
  it('hasText ignores text inside style blocks', () => {
    const e = html('<style>.x{background:url(spam)}</style><div>Hello team</div>');
    expect(hasText(e, 'background')).toBe(false);
    expect(hasText(e, 'url')).toBe(false);
    expect(hasText(e, 'hello team')).toBe(true);
  });

  it('hasText ignores text inside script blocks', () => {
    const e = html('<script>var secret = "passcode 999999";</script><p>Welcome</p>');
    expect(hasText(e, 'secret')).toBe(false);
    expect(hasText(e, 'welcome')).toBe(true);
  });

  it('extractOtp does not pick numbers out of CSS', () => {
    const e = html('<style>.code{font-size:123456px}</style><p>Your verification code is 884412</p>');
    expect(extractOtp(e)).toBe('884412');
  });

  it('extractVerificationLink ignores hrefs inside script/style', () => {
    const e = html('<style>a{content:"https://evil.example.com/verify"}</style><a href="https://good.example.com/verify">Verify</a>');
    expect(extractVerificationLink(e)).toBe('https://good.example.com/verify');
  });
});
