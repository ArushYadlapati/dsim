/**
 * AUTH FLOWS — the ONE module that calls Neon Auth's password-reset and
 * email-verification endpoints.
 *
 * ⚠️ WHY IT IS ONE FILE. `@neondatabase/auth` is a BETA SDK (0.4.2-beta, pinned
 * exactly in package.json) wrapping Better Auth, whose client surface is
 * generated from the server's route table — so a method can be renamed by a
 * dependency bump nobody in this repo made. Every call below is therefore made
 * here and nowhere else: an SDK rename is a one-file fix, and the four exported
 * functions are what the UI is written against.
 *
 * THE EXACT SIGNATURES THIS FILE DEPENDS ON, read out of
 * `node_modules/@neondatabase/auth/dist/better-auth-react-adapter-D53HN_n5.d.mts`
 * (line numbers at the version pinned today):
 *
 *   1668  requestPasswordReset({ email: string; redirectTo?: string })
 *           → { status: boolean; message: string }
 *   1545  resetPassword({ newPassword: string; token?: string })
 *           → { status: boolean }
 *   1578  sendVerificationEmail({ email: string; callbackURL?: string })
 *           → { status: boolean }
 *   1562  verifyEmail({ query: { token: string; callbackURL?: string } })
 *           → { status: boolean } | void
 *
 * ⚠️ `forgetPassword` — which the roadmap named — is NOT a top-level method on
 * this build. The only `forgetPassword` in the .d.mts is `forgetPassword.emailOtp`
 * (line 1207), a one-time-code variant we do not use. The top-level request is
 * `requestPasswordReset`, Better Auth's current name for the same route, and that
 * is what this file calls. Likewise the `emailOtp.*` and `phoneNumber.*` variants
 * are deliberately untouched: they are different flows, not aliases.
 *
 * NOTHING HERE THROWS AT THE UI. Every function answers a discriminated
 * `AuthFlowResult`, so a screen renders a sentence instead of an unhandled
 * rejection. The sentences live here too, beside the code that decides which one
 * applies (the `adminCopy.ts` precedent — five spellings of one failure had
 * accumulated across two files before that).
 *
 * NO DOM AND NO SDK AT MODULE SCOPE. `src/lib/authClient.ts` reads
 * `import.meta.env`, which is a TypeError under plain Node — so the client is
 * resolved by a DYNAMIC import inside each call. That is what lets the headless
 * smoke import this module and exercise the result shapes against a stub client
 * with no network and no bundler. The dynamic import costs nothing at runtime:
 * `authClient` is already in the main chunk (App, Account and AuthPanel import it
 * statically), so this resolves to the module that is loaded either way.
 */
import { SITE_URL } from '../seo';

// ---------------------------------------------------------------- the SDK ---

/** Better Fetch's response union — `{data, error: null} | {data: null, error}`.
 *  Declared locally so this file depends on a SHAPE rather than on a type the
 *  beta SDK re-exports from a transitive dependency. */
export interface SdkError {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
}
export type SdkResponse<T> = { data: T | null; error: SdkError | null };

/**
 * The four methods this module uses, and nothing else. `authClient` is cast to
 * this — the hand-typed `AuthClient` in `authClient.ts` covers the session and
 * sign-in surface the rest of the app calls directly, and widening it for four
 * methods only this file touches would put the SDK's names back in two places.
 */
export interface AuthFlowsClient {
  requestPasswordReset: (a: { email: string; redirectTo?: string }) => Promise<
    SdkResponse<{ status: boolean; message?: string }>
  >;
  resetPassword: (a: { newPassword: string; token?: string }) => Promise<
    SdkResponse<{ status: boolean }>
  >;
  sendVerificationEmail: (a: { email: string; callbackURL?: string }) => Promise<
    SdkResponse<{ status: boolean }>
  >;
  verifyEmail: (a: { query: { token: string; callbackURL?: string } }) => Promise<
    SdkResponse<{ status: boolean } | void>
  >;
}

/** resolved lazily — see the module note. Null when auth is off in this build. */
async function liveClient(): Promise<AuthFlowsClient | null> {
  const { authClient } = await import('./authClient');
  return (authClient as unknown as AuthFlowsClient | null) ?? null;
}

// ------------------------------------------------------------- the result ---

/**
 * Why a flow did not complete. The UI switches on this, never on a message
 * string, so the copy can change without breaking a branch.
 */
export type AuthFlowFailure =
  | 'unavailable' // auth is not configured in this build
  | 'invalid-token' // expired, already spent, or not ours
  | 'weak-password'
  | 'invalid-email'
  | 'rate-limited'
  | 'network'
  | 'unknown';

export type AuthFlowResult = { ok: true } | { ok: false; reason: AuthFlowFailure; message: string };

/**
 * The shortest password the auth server accepts (Better Auth's default minimum).
 * Checked HERE as well so a too-short password is refused before a round trip
 * that would answer with the same thing a second later.
 */
export const PASSWORD_MIN = 8;

/** one sentence per failure — `Couldn’t <verb>.` plus a concrete next step
 *  (docs/area/ui.md). No "Something went wrong." */
const MESSAGES: Record<AuthFlowFailure, string> = {
  unavailable: 'Accounts are turned off in this build.',
  'invalid-token':
    'That link has expired or has already been used. Request a new one and open it from the newest email.',
  'weak-password': `Passwords need at least ${PASSWORD_MIN} characters.`,
  'invalid-email': 'That doesn’t look like an email address.',
  'rate-limited': 'Too many attempts. Wait a minute, then try again.',
  network: 'Couldn’t reach the sign-in service. Check your connection and try again.',
  unknown: 'Couldn’t complete that. Try again in a moment.',
};

const fail = (reason: AuthFlowFailure): AuthFlowResult => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

/**
 * An SDK error → one of ours.
 *
 * Better Auth answers with a `code` (`INVALID_TOKEN`, `PASSWORD_TOO_SHORT`, …)
 * on the routes that have one and only an HTTP status on the rest, and the beta
 * SDK passes both through untouched. So the code is read first and the status is
 * the fallback — matching on the MESSAGE would break the first time the upstream
 * reworded one of its own sentences.
 */
export function classifySdkError(error: SdkError | null | undefined): AuthFlowFailure {
  if (!error) return 'unknown';
  const code = (error.code ?? '').toUpperCase();
  if (code.includes('TOKEN') || code.includes('EXPIRED')) return 'invalid-token';
  if (code.includes('PASSWORD')) return 'weak-password';
  if (code.includes('EMAIL') && !code.includes('VERIF')) return 'invalid-email';
  const status = error.status ?? 0;
  if (status === 429) return 'rate-limited';
  // 400/401/403 on any of these four routes means the TOKEN is what was rejected:
  // the address is never checked (see the enumeration note below) and the caller
  // supplies nothing else the server could object to.
  if (status === 400 || status === 401 || status === 403) return 'invalid-token';
  if (status >= 500 || status === 0) return 'network';
  return 'unknown';
}

/** call an SDK method, turning a rejection into a `network` failure rather than
 *  letting it reach a component */
async function run<T>(call: () => Promise<SdkResponse<T>>): Promise<AuthFlowResult> {
  let res: SdkResponse<T>;
  try {
    res = await call();
  } catch {
    return fail('network');
  }
  if (res?.error) return fail(classifySdkError(res.error));
  return { ok: true };
}

// ------------------------------------------------------------- the URLs -----

/** the app's own routes the auth server sends people back to */
export const RESET_PATH = '/account/reset';
export const VERIFY_PATH = '/account/verify';

/**
 * An absolute URL for one of this app's routes — the link inside an email, and the
 * two legal documents the terms gate links out to.
 *
 * ORIGIN-RELATIVE where there is an origin, so a Vercel preview deployment sends
 * people back to that preview rather than to production. Under Electron the
 * document is `file://`, where an origin is meaningless in an email — so the
 * desktop app points at the live site, which is where the desktop shell loads
 * from anyway whenever it is online.
 */
export function appUrl(path: string): string {
  const loc = typeof window === 'undefined' ? null : window.location;
  const origin = loc && /^https?:$/.test(loc.protocol) ? loc.origin : SITE_URL;
  return origin + path;
}

// ------------------------------------------------------------ the flows -----

/** a very loose address check — the auth server is the authority, this only
 *  avoids a round trip for something that is obviously not one */
const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * (1) "I forgot my password" — send the reset email.
 *
 * ⚠️ ALWAYS ANSWERS `ok` FOR A WELL-FORMED ADDRESS THE SERVER ACCEPTED. Whether
 * an account exists is not something this is allowed to reveal: a form that says
 * "no account with that email" is an account-enumeration oracle, and this one is
 * unauthenticated. The caller shows the neutral "if an account exists, we sent a
 * link" line; the auth server behaves the same way and answers `status: true`
 * either way.
 */
export async function requestPasswordReset(email: string): Promise<AuthFlowResult> {
  if (!looksLikeEmail(email)) return fail('invalid-email');
  const client = await liveClient();
  if (!client) return fail('unavailable');
  return run(() =>
    client.requestPasswordReset({
      email: email.trim(),
      redirectTo: appUrl(RESET_PATH),
    }),
  );
}

/** (2) set the new password, using the token from the emailed link. */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<AuthFlowResult> {
  if (!token.trim()) return fail('invalid-token');
  if (newPassword.length < PASSWORD_MIN) return fail('weak-password');
  const client = await liveClient();
  if (!client) return fail('unavailable');
  return run(() => client.resetPassword({ newPassword, token: token.trim() }));
}

/**
 * (3) send (or re-send) the verification email for an address.
 *
 * ⚠️ TAKES THE ADDRESS, unlike the zero-argument name the roadmap sketched: the
 * SDK's `sendVerificationEmail` requires `email`, and the caller always has it —
 * it is the signed-in session's own address, or the one just typed into the
 * sign-up form. Reading it back out of `getSession()` here would be a second
 * round trip to learn something the caller already knows.
 */
export async function requestEmailVerification(email: string): Promise<AuthFlowResult> {
  if (!looksLikeEmail(email)) return fail('invalid-email');
  const client = await liveClient();
  if (!client) return fail('unavailable');
  return run(() =>
    client.sendVerificationEmail({
      email: email.trim(),
      callbackURL: appUrl(VERIFY_PATH),
    }),
  );
}

/** (4) complete verification from the emailed link's token. */
export async function completeEmailVerification(token: string): Promise<AuthFlowResult> {
  if (!token.trim()) return fail('invalid-token');
  const client = await liveClient();
  if (!client) return fail('unavailable');
  return run(() => client.verifyEmail({ query: { token: token.trim() } }));
}

// ------------------------------------------------------------ test seam -----

/**
 * Run the four flows against a STUB client instead of the real one.
 *
 * Exported for `scripts/smoke.ts`, which asserts the RESULT SHAPES — that a
 * rejected token comes back `{ok: false, reason: 'invalid-token'}` rather than
 * throwing — with no network and no bundler. Production code never calls it, and
 * each entry is the body of its public twin with the client passed in rather than
 * resolved, so the classification and the guards under test are the shipped ones.
 */
export const authFlowsForTesting = {
  classifySdkError,
  async passwordReset(client: AuthFlowsClient, email: string): Promise<AuthFlowResult> {
    if (!looksLikeEmail(email)) return fail('invalid-email');
    return run(() => client.requestPasswordReset({ email, redirectTo: RESET_PATH }));
  },
  async completeReset(client: AuthFlowsClient, token: string, pw: string): Promise<AuthFlowResult> {
    if (!token.trim()) return fail('invalid-token');
    if (pw.length < PASSWORD_MIN) return fail('weak-password');
    return run(() => client.resetPassword({ newPassword: pw, token }));
  },
  async sendVerification(client: AuthFlowsClient, email: string): Promise<AuthFlowResult> {
    if (!looksLikeEmail(email)) return fail('invalid-email');
    return run(() => client.sendVerificationEmail({ email, callbackURL: VERIFY_PATH }));
  },
  async completeVerification(client: AuthFlowsClient, token: string): Promise<AuthFlowResult> {
    if (!token.trim()) return fail('invalid-token');
    return run(() => client.verifyEmail({ query: { token } }));
  },
};
