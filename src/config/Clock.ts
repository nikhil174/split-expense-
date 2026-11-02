// The current time, injected like any other dependency so time-based rules
// (lockouts, link and session expiry, PIN unlocks) can be tested with a
// fixed clock.
export interface Clock {
  // Milliseconds since the epoch.
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
