// What the Worker is configured with (wrangler.toml bindings, secrets and
// variables). The D1 binding and ASSETS come from wrangler.toml; everything
// optional switches a feature on when present.
export interface AppEnv {
  "split-expense": D1Database;
  ASSETS?: Fetcher;
  // The site owner's admin key (also the old administrator PIN).
  ADMIN_PIN?: string;
  // Pepper for password and PIN hashes; rotating it invalidates them all.
  SESSION_SECRET?: string;
  // Lower PBKDF2 iterations for local tests only.
  PIN_HASH_ITERATIONS?: string;
  // "development": error details in 500 responses.
  ENVIRONMENT?: string;
  // Sign in with Google.
  GOOGLE_CLIENT_ID?: string;
  // Email links (Brevo).
  BREVO_API_KEY?: string;
  BREVO_API_URL?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  // Phone notifications (Web Push).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export const databaseOf = (env: AppEnv): D1Database => env["split-expense"];
