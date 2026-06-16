// --- Public SDK types ----------------------------------------------------------

export interface Inbox {
  id: string;
  address: string;
  prefix: string;
  alias: string | null;
  ttlMinutes: number;
  permanent: boolean;
  createdAt: Date;
  expiresAt: Date;
  /** ID of the team this inbox belongs to, or null for personal inboxes. */
  teamId: string | null;
}

export interface Team {
  id: string;
  name: string;
  /** URL-safe slug used as the address prefix. Immutable after creation. */
  slug: string;
  createdAt: Date;
  role: 'owner' | 'member';
  memberCount: number;
  inboxCount: number;
}

export interface TeamMember {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: Date;
  email?: string;
}

export interface TeamDetail extends Team {
  members: TeamMember[];
}

export interface Email {
  id: string;
  inboxId: string;
  from: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawSize: number | null;
  receivedAt: Date;
}

// --- Request option types ------------------------------------------------------

export interface CreateInboxOptions {
  alias?: string;
  ttlMinutes?: number;
  permanent?: boolean;
  /** Attach inbox to a team; address becomes {teamSlug}-{prefix}@domain. */
  teamId?: string;
}

export interface CreateTeamOptions {
  name: string;
  /** 3-30 chars, lowercase letters/digits/hyphens, starts+ends with alphanum. */
  slug: string;
}

export interface WaitForEmailOptions {
  timeout?: number;
  interval?: number;
  filter?: (email: Email) => boolean;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

// --- Raw server shapes (internal) -----------------------------------------------

export interface RawInbox {
  id: string;
  address: string;
  prefix: string;
  alias: string | null;
  ttl_minutes: number;
  permanent: boolean;
  created_at: string;
  expires_at: string;
  deleted: boolean;
  team_id: string | null;
}

export interface RawTeam {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  role: 'owner' | 'member';
  member_count: number;
  inbox_count: number;
}

export interface RawTeamDetail extends RawTeam {
  members: Array<{
    user_id: string;
    role: 'owner' | 'member';
    joined_at: string;
    email?: string;
  }>;
}

export interface RawMessage {
  id: string;
  inbox_id: string;
  from_addr: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  raw_size: number | null;
  received_at: string;
}
