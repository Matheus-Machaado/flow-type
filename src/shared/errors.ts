/**
 * Erros tipados cross-module. Propagam main → renderer via IPC com shape
 * { ok: false, error: { code, message } } (jamais expõe stack trace na UI em prod).
 */

export class GroqAuthError extends Error {
  readonly code = 'GROQ_AUTH' as const;
}

export class GroqRateLimitError extends Error {
  readonly code = 'GROQ_RATE_LIMIT' as const;
}

export class GroqTimeoutError extends Error {
  readonly code = 'GROQ_TIMEOUT' as const;
}

export class GroqOfflineError extends Error {
  readonly code = 'GROQ_OFFLINE' as const;
}

export class PoolEmptyError extends Error {
  readonly code = 'POOL_EMPTY' as const;
}

export class LocalSttSpawnError extends Error {
  readonly code = 'LOCAL_STT_SPAWN' as const;
}

export class WindowLostError extends Error {
  readonly code = 'WINDOW_LOST' as const;
}

export class PasteBlockedError extends Error {
  readonly code = 'PASTE_BLOCKED' as const;
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION' as const;
  constructor(msg: string, public zodIssues?: unknown) {
    super(msg);
  }
}
