// The scripted tour for the golden-master test: every API route, the normal
// path and the refusals (bad input, wrong person, wrong PIN, limits), in the
// order a real group would meet them. Only requests and the clock: whatever
// the Worker answers is recorded by the harness, not asserted here.
const PASS = "secret2468", PIN = "1357";

export async function scenario(t) {
  const c = t.call;
  const ids = {};
  const signup = async (who, name, extra = {}, ip) => {
    const r = await c(`signup ${who}`, "POST", "/api/auth/signup", { keepAs: who, body: { name, username: who, password: PASS, ...extra }, ip });
    ids[who] = r.data.id;
    return r;
  };

  // ----- Before signing in -----
  await c("asset without ASSETS binding", "GET", "/");
  await c("CORS preflight", "OPTIONS", "/api/groups");
  await c("cross-site write refused", "POST", "/api/auth/signin", { origin: "https://evil.example", body: {} });
  await c("auth config", "GET", "/api/auth/config");
  await c("me signed out", "GET", "/api/me");
  await c("groups signed out", "GET", "/api/groups");
  await c("unknown path signed out", "GET", "/api/nope");
  await c("old app endpoint", "POST", "/api/access/signin", { body: {} });
  await c("old admin endpoint", "GET", "/api/admin/groups");
  await c("old public groups", "GET", "/api/groups/public");
  await c("username invalid", "GET", "/api/auth/username?u=1x");
  await c("username free", "GET", "/api/auth/username?u=@Nikhil");

  // ----- Sign up -----
  await c("signup short name", "POST", "/api/auth/signup", { body: { name: "N", username: "nn1", password: PASS } });
  await c("signup bad username", "POST", "/api/auth/signup", { body: { name: "Nikhil", username: "1nik", password: PASS } });
  await c("signup bad email", "POST", "/api/auth/signup", { body: { name: "Nikhil", username: "nik", email: "nope", password: PASS } });
  await c("signup weak password", "POST", "/api/auth/signup", { body: { name: "Nikhil", username: "nik", password: "short" } });
  await c("signup no body", "POST", "/api/auth/signup", { rawBody: "not json", headers: { "content-type": "application/json" } });
  await signup("nikhil", "Nikhil  Srivastava", { email: "Nikhil@Example.com" });
  await c("signup username taken", "POST", "/api/auth/signup", { body: { name: "Other", username: "NIKHIL", password: PASS } });
  await c("signup email taken", "POST", "/api/auth/signup", { body: { name: "Other", username: "other", email: "nikhil@example.com", password: PASS } });
  await signup("vicky", "Vicky", {}, "10.0.0.2");
  await signup("jagan", "Jagan", { email: "jagan@example.com" }, "10.0.0.2");
  await signup("arsha", "Arsha", {}, "10.0.0.2");
  await signup("paro", "Paro", {}, "10.0.0.3");
  await signup("cutie", "Cute Mosquito 🦟", {}, "10.0.0.3");
  await c("username taken (signed out)", "GET", "/api/auth/username?u=vicky");
  await c("username own (signed in)", "GET", "/api/auth/username?u=vicky", { as: "vicky" });
  await c("me signed in", "GET", "/api/me", { as: "nikhil" });
  await c("body too large", "POST", "/api/auth/signin", { rawBody: "x".repeat(17 * 1024), headers: { "content-type": "application/json" } });

  // ----- Email links -----
  await c("verify email", "POST", "/api/auth/verify-email", { body: { token: t.lastEmailToken("verify-email", "nikhil@example.com") } });
  await c("verify email again", "POST", "/api/auth/verify-email", { body: { token: t.lastEmailToken("verify-email", "nikhil@example.com") } });
  await c("verify email bad token", "POST", "/api/auth/verify-email", { body: { token: "nope" } });
  await c("me email verified", "GET", "/api/me", { as: "nikhil" });
  await c("forgot unknown", "POST", "/api/auth/forgot", { body: { login: "ghost" } });
  await c("forgot unverified email", "POST", "/api/auth/forgot", { body: { login: "jagan" } });
  await c("forgot verified", "POST", "/api/auth/forgot", { body: { login: "nikhil@example.com" }, ip: "10.0.0.9" });
  const reset = t.lastEmailToken("reset", "nikhil@example.com");
  await c("reset link check", "GET", "/api/auth/reset/" + reset);
  await c("reset link bad", "GET", "/api/auth/reset/" + "x".repeat(30));
  await c("reset weak password", "POST", "/api/auth/reset", { body: { token: reset, password: "short" } });
  await c("reset ok", "POST", "/api/auth/reset", { keepAs: "nikhil", body: { token: reset, password: "newpass2468" } });
  await c("reset reused", "POST", "/api/auth/reset", { body: { token: reset, password: "newpass1357" } });
  await c("reset link used", "GET", "/api/auth/reset/" + reset);
  await c("me after reset", "GET", "/api/me", { as: "nikhil" });
  await c("change password back", "POST", "/api/me/password", { as: "nikhil", body: { currentPassword: "newpass2468", newPassword: PASS } });
  await c("verify send, already verified", "POST", "/api/me/email/verify", { as: "nikhil" });
  await c("verify send, no email", "POST", "/api/me/email/verify", { as: "vicky" });
  await c("verify send", "POST", "/api/me/email/verify", { as: "jagan" });
  t.env.BREVO_API_KEY = "";
  await c("forgot, email off", "POST", "/api/auth/forgot", { body: { login: "nikhil" } });
  await c("verify send, email off", "POST", "/api/me/email/verify", { as: "jagan" });
  await c("auth config, email off", "GET", "/api/auth/config");
  t.env.BREVO_API_KEY = "brevo-key";

  // ----- Sign in -----
  await c("signin unknown", "POST", "/api/auth/signin", { body: { login: "ghost", password: PASS } });
  await c("signin no password", "POST", "/api/auth/signin", { body: { login: "vicky" } });
  for (let i = 1; i <= 5; i++) await c(`signin wrong password ${i}`, "POST", "/api/auth/signin", { body: { login: "arsha", password: "wrong1234" }, ip: "10.0.1." + i });
  await c("signin while locked", "POST", "/api/auth/signin", { body: { login: "arsha", password: PASS }, ip: "10.0.1.9" });
  t.tick(16 * 60 * 1000);
  await c("signin after lock", "POST", "/api/auth/signin", { keepAs: "arsha", body: { login: "@Arsha", password: PASS }, ip: "10.0.1.9" });
  await c("signin by email", "POST", "/api/auth/signin", { keepAs: "nikhil2", body: { login: "NIKHIL@example.com", password: PASS } });
  await c("signin old pin field", "POST", "/api/auth/signin", { keepAs: "vicky2", body: { login: "vicky", pin: PASS } });
  await c("logout", "POST", "/api/logout", { as: "nikhil2" });
  await c("me after logout", "GET", "/api/me", { as: "nikhil2" });
  await c("logout without cookie", "POST", "/api/logout");

  // ----- Accounts from before usernames (legacy) -----
  const now = Date.now();
  t.raw.prepare("INSERT INTO appx_groups(id,name,created_at) VALUES('old-group','Old Trip',?)").run(now);
  t.raw.prepare("INSERT INTO appx_users(id,username,display_name,legacy,created_at) VALUES('admin','oldadmin_aa11','Old Admin',1,?),('old-1','raju_000001','Raju',1,?),('old-2','sam_000002','Sam',1,?),('old-3','sam_000003','Sam',1,?)").run(now, now, now, now);
  t.raw.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status) VALUES('old-group','admin','Old Admin','admin','active'),('old-group','old-1','Raju','member','active'),('old-group','old-2','Sam','member','active'),('old-group','old-3','Sam','member','active')").run();
  await c("legacy missing", "POST", "/api/auth/legacy-signin", { body: { group: "", name: "Raju" } });
  await c("legacy unknown", "POST", "/api/auth/legacy-signin", { body: { group: "Old Trip", name: "Nobody", password: PASS } });
  await c("legacy ambiguous", "POST", "/api/auth/legacy-signin", { body: { group: "old trip", name: "sam", password: PASS } });
  await c("legacy no password yet", "POST", "/api/auth/legacy-signin", { body: { group: "Old Trip", name: "raju", password: "raju12345" } });
  await c("legacy create weak", "POST", "/api/auth/legacy-signin", { body: { group: "Old Trip", name: "raju", password: "123", createPassword: true } });
  ids.raju = "old-1";
  await c("legacy create", "POST", "/api/auth/legacy-signin", { keepAs: "raju", body: { group: "Old Trip", name: "raju", password: "raju12345", createPassword: true } });
  await c("legacy again", "POST", "/api/auth/legacy-signin", { body: { group: " Old  Trip ", name: "RAJU", password: "raju12345" } });
  await c("old admin wrong key", "POST", "/api/auth/signin", { body: { login: "oldadmin_aa11", password: "nope" } });
  await c("old admin needs new password", "POST", "/api/auth/signin", { body: { login: "oldadmin_aa11", password: "old-admin-key-77" } });
  await c("old admin chooses password", "POST", "/api/auth/signin", { keepAs: "oldadmin", body: { login: "oldadmin_aa11", password: "old-admin-key-77", newPassword: "admin2468x" } });
  await c("old admin signs in", "POST", "/api/auth/signin", { body: { login: "oldadmin_aa11", password: "admin2468x" } });
  await c("raju picks username", "POST", "/api/me/profile", { as: "raju", body: { username: "raju" } });
  await c("raju me", "GET", "/api/me", { as: "raju" });

  // ----- Google -----
  t.tick(16 * 60 * 1000); // a fresh sign-in rate-limit window
  await c("google bad token", "POST", "/api/auth/google", { body: { credential: "a.b.c" } });
  await c("google unverified email", "POST", "/api/auth/google", { body: { credential: t.google.token({ email_verified: false }) } });
  await c("google email taken", "POST", "/api/auth/google", { body: { credential: t.google.token({ email: "nikhil@example.com", sub: "g-nik" }) } });
  ids.gina = (await c("google new account", "POST", "/api/auth/google", { keepAs: "gina", body: { credential: t.google.token({ sub: "g-gina", email: "Gina@Example.com", name: "Gina Rao" }) } })).data.id;
  await c("google known account", "POST", "/api/auth/google", { keepAs: "gina", body: { credential: t.google.token({ sub: "g-gina", email: "gina@example.com", name: "Gina Rao" }) } });
  await c("google account signin with password", "POST", "/api/auth/signin", { body: { login: "ginarao", password: PASS } });
  ids.gina2 = (await c("google new account, same name", "POST", "/api/auth/google", { keepAs: "gina2", body: { credential: t.google.token({ sub: "g-gina2", email: "gina2@example.com", name: "Gina Rao" }) } })).data.id;
  ids.zed = (await c("google new account, odd name", "POST", "/api/auth/google", { keepAs: "zed", body: { credential: t.google.token({ sub: "g-zed", email: "9@example.com", name: "9" }) } })).data.id;
  await c("gina me", "GET", "/api/me", { as: "gina" });
  await c("gina disconnect without password", "POST", "/api/me/google/disconnect", { as: "gina" });
  await c("gina sets password", "POST", "/api/me/password", { as: "gina", body: { newPassword: PASS } });
  await c("gina disconnect", "POST", "/api/me/google/disconnect", { as: "gina" });
  await c("connect google taken", "POST", "/api/me/google", { as: "vicky", body: { credential: t.google.token({ sub: "g-gina2", email: "gina2@example.com" }) } });
  await c("connect google (vicky, no email)", "POST", "/api/me/google", { as: "vicky", body: { credential: t.google.token({ sub: "g-vicky", email: "vicky@example.com", name: "Vicky" }) } });
  await c("connect google (jagan, same email)", "POST", "/api/me/google", { as: "jagan", body: { credential: t.google.token({ sub: "g-jagan", email: "jagan@example.com" }) } });
  await c("connect google (nikhil, other email)", "POST", "/api/me/google", { as: "nikhil", body: { credential: t.google.token({ sub: "g-nik", email: "nik.other@example.com" }) } });
  await c("google signin vicky", "POST", "/api/auth/google", { body: { credential: t.google.token({ sub: "g-vicky", email: "vicky@example.com" }) } });
  t.env.GOOGLE_CLIENT_ID = "";
  await c("google off", "POST", "/api/auth/google", { body: { credential: "x" } });
  await c("connect google off", "POST", "/api/me/google", { as: "vicky", body: { credential: "x" } });
  await c("config google off", "GET", "/api/auth/config");
  t.env.GOOGLE_CLIENT_ID = "golden.apps.googleusercontent.com";

  // ----- Profile -----
  await c("profile bad username", "POST", "/api/me/profile", { as: "paro", body: { username: "9x" } });
  await c("profile username taken", "POST", "/api/me/profile", { as: "paro", body: { username: "vicky" } });
  await c("profile bad email", "POST", "/api/me/profile", { as: "paro", body: { email: "x@" } });
  await c("profile email taken", "POST", "/api/me/profile", { as: "paro", body: { email: "jagan@example.com" } });
  await c("profile short name", "POST", "/api/me/profile", { as: "paro", body: { name: "P" } });
  await c("profile all", "POST", "/api/me/profile", { as: "paro", body: { username: "Paro.K", email: "paro@example.com", name: "  Paro   K " } });
  await c("profile clear email", "POST", "/api/me/profile", { as: "paro", body: { email: "" } });
  await c("old name endpoint", "POST", "/api/me/name", { as: "paro", body: { name: "Paro" } });
  await c("old name endpoint bad", "POST", "/api/me/name", { as: "paro", body: { name: "" } });
  await c("password needs current", "POST", "/api/me/password", { as: "paro", body: { newPassword: "paro24680" } });
  await c("password weak", "POST", "/api/me/password", { as: "paro", body: { currentPassword: PASS, newPassword: "x" } });
  await c("password wrong current", "POST", "/api/me/password", { as: "paro", body: { currentPassword: "wrong999x", newPassword: "paro24680" } });
  await c("password via old pin route", "POST", "/api/me/pin", { as: "paro", body: { currentPin: PASS, newPin: "paro24680" } });
  await c("password back", "POST", "/api/me/password", { as: "paro", body: { currentPassword: "paro24680", newPassword: PASS } });
  await c("username back", "POST", "/api/me/profile", { as: "paro", body: { username: "paro" } });

  // ----- Payment method (UPI) -----
  const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64");
  const fakePng = "data:image/png;base64," + Buffer.from([1, 2, 3, 4]).toString("base64");
  await c("upi none", "GET", "/api/payment-method", { as: "vicky" });
  await c("upi bad id", "POST", "/api/payment-method", { as: "vicky", body: { upiId: "nope" } });
  await c("upi bad qr", "POST", "/api/payment-method", { as: "vicky", body: { upiId: "vicky@okaxis", qr: fakePng } });
  await c("upi not image", "POST", "/api/payment-method", { as: "vicky", body: { upiId: "vicky@okaxis", qr: "hello" } });
  await c("upi with qr", "POST", "/api/payment-method", { as: "vicky", body: { upiId: "vicky@okaxis", qr: png } });
  await c("upi keep qr", "POST", "/api/payment-method", { as: "vicky", body: { upiId: "vicky.k@okaxis" } });
  await c("upi qr image", "GET", "/api/payment-method/qr", { as: "vicky" });
  await c("upi remove qr", "POST", "/api/payment-method", { as: "nikhil", body: { upiId: "nik@ybl", qr: null } });
  await c("upi qr none", "GET", "/api/payment-method/qr", { as: "nikhil" });
  await c("upi delete", "POST", "/api/payment-method/delete", { as: "paro" });

  // ----- Push -----
  await c("push key", "GET", "/api/push/key", { as: "vicky" });
  await c("push subscribe bad", "POST", "/api/push/subscribe", { as: "vicky", body: { endpoint: "https://evil.example/x", keys: {} } });
  await c("push subscribe vicky", "POST", "/api/push/subscribe", { as: "vicky", body: t.phone("https://fcm.googleapis.com/fcm/send/vicky-phone") });
  await c("push subscribe jagan", "POST", "/api/push/subscribe", { as: "jagan", body: t.phone("https://fcm.googleapis.com/fcm/send/jagan-phone") });
  const gone = t.phone("https://fcm.googleapis.com/fcm/send/arsha-old");
  await c("push subscribe arsha", "POST", "/api/push/subscribe", { as: "arsha", body: gone });

  // ----- Friends -----
  await c("friends empty", "GET", "/api/friends", { as: "nikhil" });
  await c("friend request nothing", "POST", "/api/friends/request", { as: "nikhil", body: {} });
  await c("friend request unknown username", "POST", "/api/friends/request", { as: "nikhil", body: { login: "ghost" } });
  await c("friend request unknown email", "POST", "/api/friends/request", { as: "nikhil", body: { login: "ghost@example.com" } });
  await c("friend request self", "POST", "/api/friends/request", { as: "nikhil", body: { login: "nikhil" } });
  await c("friend request vicky", "POST", "/api/friends/request", { as: "nikhil", body: { login: "@vicky" } });
  await c("friend request again", "POST", "/api/friends/request", { as: "nikhil", body: { login: "vicky" } });
  await c("friends of vicky", "GET", "/api/friends", { as: "vicky" });
  await c("friend accept wrong side", "POST", `/api/friends/${ids.vicky}/accept`, { as: "nikhil" });
  await c("friend accept", "POST", `/api/friends/${ids.nikhil}/accept`, { as: "vicky" });
  await c("friend request already friends", "POST", "/api/friends/request", { as: "vicky", body: { userId: ids.nikhil } });
  await c("friend request jagan", "POST", "/api/friends/request", { as: "jagan", body: { login: "paro" } });
  await c("friend asked back accepts", "POST", "/api/friends/request", { as: "paro", body: { login: "jagan" } });
  await c("friend request arsha", "POST", "/api/friends/request", { as: "arsha", body: { login: "vicky" } });
  await c("friend decline wrong side", "POST", `/api/friends/${ids.vicky}/decline`, { as: "arsha" });
  await c("friend decline", "POST", `/api/friends/${ids.arsha}/decline`, { as: "vicky" });
  await c("friend act unknown", "POST", `/api/friends/${ids.cutie}/remove`, { as: "vicky" });
  await c("friend request cutie", "POST", "/api/friends/request", { as: "cutie", body: { login: "vicky" } });
  await c("friend cancel mine", "POST", `/api/friends/${ids.vicky}/remove`, { as: "cutie" });
  await c("friend request vicky->jagan", "POST", "/api/friends/request", { as: "vicky", body: { login: "jagan" } });
  await c("friend accept jagan", "POST", `/api/friends/${ids.vicky}/accept`, { as: "jagan" });
  await c("friends of nikhil", "GET", "/api/friends", { as: "nikhil" });

  // ----- Groups -----
  await c("group bad name", "POST", "/api/groups", { as: "nikhil", body: { name: "G", pin: PIN } });
  await c("group bad pin", "POST", "/api/groups", { as: "nikhil", body: { name: "Goa Trip", pin: "12" } });
  const goa = (await c("group create", "POST", "/api/groups", { as: "nikhil", body: { name: "  Goa   Trip ", pin: PIN } })).data.group.id;
  const G = `/api/groups/${goa}`;
  await c("groups list", "GET", "/api/groups", { as: "nikhil" });
  await c("group detail", "GET", G, { as: "nikhil" });
  await c("group not mine", "GET", G, { as: "vicky" });
  await c("group bad id", "GET", "/api/groups/bad$id", { as: "nikhil" });
  await c("invite empty", "POST", G + "/members/invite", { as: "nikhil", body: { login: " " } });
  await c("invite unknown", "POST", G + "/members/invite", { as: "nikhil", body: { login: "ghost" } });
  await c("invite unknown email", "POST", G + "/members/invite", { as: "nikhil", body: { login: "ghost@x.com" } });
  await c("invite self", "POST", G + "/members/invite", { as: "nikhil", body: { login: "nikhil" } });
  for (const who of ["vicky", "jagan", "arsha", "cutie"]) await c(`invite ${who}`, "POST", G + "/members/invite", { as: "nikhil", body: { login: who } });
  await c("invite again", "POST", G + "/members/invite", { as: "nikhil", body: { login: "vicky" } });
  await c("invitations vicky", "GET", "/api/invitations", { as: "vicky" });
  await c("accept no pin", "POST", G + "/invitation/accept", { as: "vicky", body: {} });
  await c("accept wrong pin", "POST", G + "/invitation/accept", { as: "vicky", body: { pin: "0000" } });
  await c("accept", "POST", G + "/invitation/accept", { as: "vicky", body: { pin: PIN } });
  await c("accept again", "POST", G + "/invitation/accept", { as: "vicky", body: { pin: PIN } });
  await c("accept jagan", "POST", G + "/invitation/accept", { as: "jagan", body: { pin: PIN } });
  await c("accept arsha", "POST", G + "/invitation/accept", { as: "arsha", body: { pin: PIN } });
  await c("decline cutie", "POST", G + "/invitation/decline", { as: "cutie" });
  await c("accept after decline", "POST", G + "/invitation/accept", { as: "cutie", body: { pin: PIN } });
  await c("group detail admin", "GET", G, { as: "nikhil" });
  await c("group detail member", "GET", G, { as: "vicky" });
  await c("groups list vicky", "GET", "/api/groups", { as: "vicky" });
  // A second device (vicky2) has to enter the PIN.
  await c("locked on new device", "GET", G, { as: "vicky2" });
  await c("locked expenses", "GET", G + "/expenses", { as: "vicky2" });
  await c("locked groups list", "GET", "/api/groups", { as: "vicky2" });
  for (let i = 1; i <= 5; i++) await c(`unlock wrong ${i}`, "POST", G + "/unlock", { as: "vicky2", body: { pin: "000" + i } });
  await c("unlock rate limited", "POST", G + "/unlock", { as: "vicky2", body: { pin: PIN } });
  t.tick(15 * 60 * 1000);
  await c("unlock bad format", "POST", G + "/unlock", { as: "vicky2", body: { pin: "12" } });
  await c("unlock", "POST", G + "/unlock", { as: "vicky2", body: { pin: PIN } });
  await c("unlocked", "GET", G, { as: "vicky2" });
  // Invite link and QR.
  await c("invite link member", "GET", G + "/invite-link", { as: "vicky" });
  await c("invite link reset by member", "POST", G + "/invite-link/reset", { as: "vicky" });
  await c("invite link wrong method", "PUT", G + "/invite-link", { as: "nikhil" });
  await c("invite link off", "POST", G + "/invite-link/off", { as: "nikhil" });
  await c("invite link member while off", "GET", G + "/invite-link", { as: "vicky" });
  await c("invite link admin makes one", "GET", G + "/invite-link", { as: "nikhil" });
  const code = (await c("invite link reset", "POST", G + "/invite-link/reset", { as: "nikhil" })).data.code;
  await c("join bad code", "GET", "/api/join/" + "z".repeat(22), { as: "paro" });
  await c("join look", "GET", "/api/join/" + code, { as: "paro" });
  await c("join wrong method", "PUT", "/api/join/" + code, { as: "paro" });
  await c("join wrong pin", "POST", "/api/join/" + code, { as: "paro", body: { pin: "9999" } });
  await c("join ask", "POST", "/api/join/" + code, { as: "paro", body: { pin: PIN } });
  await c("join ask again", "POST", "/api/join/" + code, { as: "paro", body: { pin: PIN } });
  await c("join look pending", "GET", "/api/join/" + code, { as: "paro" });
  await c("join as member", "POST", "/api/join/" + code, { as: "vicky", body: {} });
  await c("pending not let in yet", "GET", G, { as: "paro" });
  await c("waiting list (admin)", "GET", G, { as: "nikhil" });
  await c("approve pending via invite", "POST", G + "/members/invite", { as: "nikhil", body: { login: "paro" } });
  await c("invite gina", "POST", G + "/members/invite", { as: "nikhil", body: { login: "ginarao" } });
  await c("join as invited", "POST", "/api/join/" + code, { as: "gina", body: { pin: PIN } });
  // Members suggest friends; admins approve.
  await c("member suggests non-friend", "POST", G + "/members/invite", { as: "jagan", body: { login: "user9" } });
  await c("member suggests friend already in", "POST", G + "/members/invite", { as: "jagan", body: { login: "vicky" } });
  await c("raju asks nikhil", "POST", "/api/friends/request", { as: "raju", body: { login: "nikhil" } });
  await c("nikhil accepts raju", "POST", "/api/friends/request", { as: "nikhil", body: { login: "raju" } });
  await c("vicky asks raju", "POST", "/api/friends/request", { as: "vicky", body: { login: "raju" } });
  await c("raju accepts vicky", "POST", `/api/friends/${ids.vicky}/accept`, { as: "raju" });
  await c("member suggests friend", "POST", G + "/members/invite", { as: "vicky", body: { login: "raju" } });
  await c("member suggests again", "POST", G + "/members/invite", { as: "vicky", body: { login: "raju" } });
  await c("suggested in waiting", "GET", G, { as: "nikhil" });
  await c("approve suggestion by member", "POST", G + "/members/old-1/approve", { as: "vicky" });
  await c("approve suggestion", "POST", G + "/members/old-1/approve", { as: "nikhil" });
  await c("raju accepts", "POST", G + "/invitation/accept", { as: "raju", body: { pin: PIN } });
  await c("cancel invite not invited", "POST", G + `/members/${ids.vicky}/cancel-invite`, { as: "nikhil" });
  await c("invite zed", "POST", G + "/members/invite", { as: "nikhil", body: { login: "user9" } });
  await c("cancel invite", "POST", G + `/members/${ids.zed}/cancel-invite`, { as: "nikhil" });
  await c("approve not waiting", "POST", G + `/members/${ids.vicky}/approve`, { as: "nikhil" });
  await c("manage unknown person", "POST", G + "/members/nobody/remove", { as: "nikhil" });
  await c("make admin", "POST", G + `/members/${ids.vicky}/make-admin`, { as: "nikhil" });
  await c("make admin again", "POST", G + `/members/${ids.vicky}/make-admin`, { as: "nikhil" });
  await c("make member", "POST", G + `/members/${ids.vicky}/make-member`, { as: "nikhil" });
  await c("last admin can't step down", "POST", G + `/members/${ids.nikhil}/make-member`, { as: "nikhil" });
  await c("remove self", "POST", G + `/members/${ids.nikhil}/remove`, { as: "nikhil" });
  await c("remove not in group", "POST", G + `/members/${ids.zed}/remove`, { as: "nikhil" });
  await c("only admin can't leave", "POST", G + "/leave", { as: "nikhil" });
  await c("detail with friends", "GET", G, { as: "vicky" });

  // ----- Group PIN, rename -----
  await c("pin by member", "POST", G + "/pin", { as: "vicky", body: { pin: "2468" } });
  await c("pin bad", "POST", G + "/pin", { as: "nikhil", body: { pin: "24" } });
  await c("pin change", "POST", G + "/pin", { as: "nikhil", body: { pin: "2468" } });
  await c("locked after pin change", "GET", G, { as: "vicky" });
  for (const who of ["vicky", "jagan", "arsha", "paro", "gina", "raju"]) await c(`unlock ${who}`, "POST", G + "/unlock", { as: who, body: { pin: "2468" } });
  await c("rename by member", "POST", G + "/rename", { as: "vicky", body: { name: "Goa!" } });
  await c("rename bad", "POST", G + "/rename", { as: "nikhil", body: { name: "x" } });
  await c("rename", "POST", G + "/rename", { as: "nikhil", body: { name: "Goa Trip 2026" } });

  // ----- Expenses -----
  const E = G + "/expenses";
  await c("expenses empty", "GET", E, { as: "vicky" });
  await c("expense no description", "POST", E, { as: "vicky", body: { description: " ", amount: "10", paidBy: ids.vicky, memberIds: [ids.vicky] } });
  await c("expense bad amount", "POST", E, { as: "vicky", body: { description: "Tea", amount: "1.005", paidBy: ids.vicky, memberIds: [ids.vicky] } });
  await c("expense zero", "POST", E, { as: "vicky", body: { description: "Tea", amount: "0", paidBy: ids.vicky, memberIds: [ids.vicky] } });
  await c("expense payer not member", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.zed, memberIds: [ids.vicky] } });
  await c("expense no members", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, memberIds: [] } });
  await c("expense member not active", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, memberIds: [ids.zed] } });
  await c("expense member not string", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, memberIds: [5] } });
  await c("expense bad mode", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, splitMode: "weird" } });
  await c("expense manual empty", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, splitMode: "manual", allocations: [] } });
  await c("expense manual wrong sum", "POST", E, { as: "vicky", body: { description: "Tea", amount: "10", paidBy: ids.vicky, splitMode: "manual", allocations: [{ memberId: ids.vicky, amount: "5" }] } });
  const all5 = [ids.nikhil, ids.vicky, ids.jagan, ids.arsha, ids.paro];
  const hotel = (await c("expense hotel", "POST", E, { as: "nikhil", body: { description: "Hotel", amount: "4500.50", paidBy: ids.nikhil, memberIds: all5 } })).data.id;
  const biryani = (await c("expense biryani", "POST", E, { as: "vicky", body: { description: "Biryani", amount: 999, paidBy: ids.vicky, memberIds: [ids.vicky, ids.jagan, ids.jagan] } })).data.id;
  const cab = (await c("expense cab manual", "POST", E, { as: "arsha", body: { description: "Cab", amount: "333.33", paidBy: ids.arsha, splitMode: "manual", allocations: [{ memberId: ids.arsha, amount: "100" }, { memberId: ids.jagan, amount: "233.33" }, { memberId: ids.paro, amount: "0" }] } })).data.id;
  const scooty = (await c("expense by admin for jagan", "POST", E, { as: "nikhil", body: { description: "Scooty", amount: "600", paidBy: ids.jagan, memberIds: [ids.jagan, ids.raju] } })).data.id;
  await c("expense raju", "POST", E, { as: "raju", body: { description: "Water", amount: "60", paidBy: ids.raju, memberIds: [ids.raju, ids.gina, ids.vicky] } });
  await c("edit not found", "POST", E + "/nope/edit", { as: "nikhil", body: {} });
  await c("edit not allowed", "POST", `${E}/${hotel}/edit`, { as: "vicky", body: { description: "Hotel", amount: "1", paidBy: ids.nikhil, memberIds: [ids.nikhil] } });
  await c("edit invalid", "POST", `${E}/${biryani}/edit`, { as: "vicky", body: { description: "", amount: "1", paidBy: ids.vicky, memberIds: [ids.vicky] } });
  await c("edit biryani", "POST", `${E}/${biryani}/edit`, { as: "vicky", body: { description: "Biryani & drinks", amount: "1299", paidBy: ids.vicky, memberIds: [ids.vicky, ids.jagan, ids.arsha] } });
  await c("edit by admin", "POST", `${E}/${cab}/edit`, { as: "nikhil", body: { description: "Cab to airport", amount: "400", paidBy: ids.arsha, memberIds: [ids.arsha, ids.jagan, ids.paro, ids.nikhil] } });
  await c("expenses list", "GET", E, { as: "jagan" });
  await c("expenses list admin", "GET", E, { as: "nikhil" });
  await c("expense history one", "GET", `${G}/history?expense=${cab}`, { as: "paro" });
  await c("dashboard", "GET", G + "/dashboard", { as: "paro" });
  await c("balances", "GET", G + "/balances", { as: "paro" });
  await c("debts", "GET", G + "/debts", { as: "paro" });
  await c("my debts", "GET", G + "/settlements/mine", { as: "jagan" });
  await c("my debts admin", "GET", G + "/settlements/mine", { as: "nikhil" });
  await c("home balances", "GET", "/api/balances", { as: "jagan" });
  await c("payment methods", "GET", G + "/payment-methods", { as: "jagan" });
  await c("member qr", "GET", G + `/members/${ids.vicky}/qr`, { as: "jagan" });
  await c("member qr none", "GET", G + `/members/${ids.jagan}/qr`, { as: "vicky" });
  await c("member qr outsider", "GET", G + `/members/${ids.zed}/qr`, { as: "vicky" });

  // ----- Payments -----
  const S = G + "/settlements";
  await c("pay nobody", "POST", S, { as: "jagan", body: { amount: "1" } });
  await c("pay self", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.jagan, amount: "1" } });
  await c("pay for others", "POST", S, { as: "jagan", body: { fromMemberId: ids.vicky, toMemberId: ids.nikhil, amount: "1" } });
  await c("pay bad amount", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.nikhil, amount: "abc" } });
  await c("pay outsider", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.zed, amount: "1" } });
  await c("pay no debt", "POST", S, { as: "nikhil", body: { fromMemberId: ids.nikhil, toMemberId: ids.jagan, amount: "1" } });
  await c("pay too much", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.nikhil, amount: "100000" } });
  await c("pay bad screenshot", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.nikhil, amount: "100", proof: fakePng } });
  const p1 = (await c("pay with screenshot", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.nikhil, amount: "100", proof: png } })).data.id;
  await c("pay over waiting", "POST", S, { as: "jagan", body: { fromMemberId: ids.jagan, toMemberId: ids.nikhil, amount: "900" } });
  await c("pending (nikhil)", "GET", "/api/payments/pending", { as: "nikhil" });
  await c("pending (jagan)", "GET", "/api/payments/pending", { as: "jagan" });
  await c("proof image", "GET", `${S}/${p1}/proof`, { as: "vicky" });
  await c("proof none", "GET", `${S}/nope/proof`, { as: "vicky" });
  await c("decide unknown", "POST", `${S}/nope/confirm`, { as: "nikhil" });
  await c("confirm by other member", "POST", `${S}/${p1}/confirm`, { as: "vicky" });
  await c("confirm", "POST", `${S}/${p1}/confirm`, { as: "nikhil" });
  await c("confirm again", "POST", `${S}/${p1}/confirm`, { as: "nikhil" });
  const p2 = (await c("pay arsha->nikhil", "POST", S, { as: "arsha", body: { fromMemberId: ids.arsha, toMemberId: ids.nikhil, amount: "50" } })).data.id;
  await c("reject", "POST", `${S}/${p2}/reject`, { as: "nikhil" });
  const p3 = (await c("pay arsha->nikhil again", "POST", S, { as: "arsha", body: { fromMemberId: ids.arsha, toMemberId: ids.nikhil, amount: "20" } })).data.id;
  await c("cancel by other", "POST", `${S}/${p3}/cancel`, { as: "vicky" });
  await c("cancel by payer", "POST", `${S}/${p3}/cancel`, { as: "arsha" });
  // "They paid me": Vicky records Jagan's payment; an admin approves.
  const pm1 = (await c("they paid me", "POST", S, { as: "vicky", body: { fromMemberId: ids.jagan, toMemberId: ids.vicky, amount: "300" } })).data.id;
  await c("pending (vicky waits)", "GET", "/api/payments/pending", { as: "vicky" });
  await c("pending (admin decides)", "GET", "/api/payments/pending", { as: "nikhil" });
  await c("pending (jagan sees)", "GET", "/api/payments/pending", { as: "jagan" });
  await c("lender can't approve own", "POST", `${S}/${pm1}/confirm`, { as: "vicky" });
  await c("payer can't approve", "POST", `${S}/${pm1}/confirm`, { as: "jagan" });
  await c("admin approves", "POST", `${S}/${pm1}/confirm`, { as: "nikhil" });
  const pm2 = (await c("they paid me 2", "POST", S, { as: "vicky", body: { fromMemberId: ids.jagan, toMemberId: ids.vicky, amount: "10" } })).data.id;
  await c("admin rejects", "POST", `${S}/${pm2}/reject`, { as: "nikhil" });
  const pm3 = (await c("they paid me 3", "POST", S, { as: "vicky", body: { fromMemberId: ids.jagan, toMemberId: ids.vicky, amount: "10" } })).data.id;
  await c("payer cancels they-paid-me", "POST", `${S}/${pm3}/cancel`, { as: "jagan" });
  const pm4 = (await c("they paid me 4", "POST", S, { as: "vicky", body: { fromMemberId: ids.jagan, toMemberId: ids.vicky, amount: "10" } })).data.id;
  await c("lender cancels they-paid-me", "POST", `${S}/${pm4}/cancel`, { as: "vicky" });
  const pm5 = (await c("they paid me 5", "POST", S, { as: "vicky", body: { fromMemberId: ids.jagan, toMemberId: ids.vicky, amount: "10" } })).data.id;
  await c("admin cancels they-paid-me", "POST", `${S}/${pm5}/cancel`, { as: "nikhil" });
  await c("admin records for others", "POST", S, { as: "nikhil", body: { fromMemberId: ids.paro, toMemberId: ids.arsha, amount: "20" } });
  await c("admin receives (auto confirmed)", "POST", S, { as: "nikhil", body: { fromMemberId: ids.paro, toMemberId: ids.nikhil, amount: "100" } });
  // A payment that no longer fits after an expense change.
  const p4 = (await c("pay raju->jagan", "POST", S, { as: "raju", body: { fromMemberId: ids.raju, toMemberId: ids.jagan, amount: "300" } })).data.id;
  await c("edit scooty smaller", "POST", `${E}/${scooty}/edit`, { as: "jagan", body: { description: "Scooty", amount: "100", paidBy: ids.jagan, memberIds: [ids.jagan, ids.raju] } });
  await c("confirm no longer fits", "POST", `${S}/${p4}/confirm`, { as: "jagan" });
  await c("reject it", "POST", `${S}/${p4}/reject`, { as: "jagan" });
  await c("settlements", "GET", S, { as: "vicky" });
  await c("settlements admin", "GET", S, { as: "nikhil" });
  await c("member summary", "GET", G + `/members/${ids.jagan}`, { as: "vicky" });
  await c("member summary me", "GET", G + `/members/${ids.vicky}`, { as: "vicky" });
  await c("member summary unknown", "GET", G + "/members/nobody", { as: "vicky" });
  await c("with person", "GET", G + `/with/${ids.jagan}`, { as: "vicky" });
  await c("pair", "GET", G + `/pair/${ids.nikhil}/${ids.jagan}`, { as: "vicky" });
  await c("pair same", "GET", G + `/pair/${ids.nikhil}/${ids.nikhil}`, { as: "vicky" });
  await c("with outsider", "GET", G + `/with/${ids.zed}`, { as: "vicky" });
  await c("statement", "GET", G + `/members/${ids.jagan}/statement`, { as: "vicky" });
  await c("statement admin", "GET", G + `/members/${ids.nikhil}/statement`, { as: "paro" });
  await c("statement unknown", "GET", G + "/members/nobody/statement", { as: "paro" });
  await c("debts after payments", "GET", G + "/debts", { as: "paro" });
  await c("home balances after", "GET", "/api/balances", { as: "vicky" });
  // A dead phone (410) is forgotten.
  t.setPushReply(410);
  await c("expense while arsha's phone is gone", "POST", E, { as: "vicky", body: { description: "Juice", amount: "40", paidBy: ids.vicky, memberIds: [ids.vicky, ids.arsha] } });
  t.setPushReply(201);
  await c("push unsubscribe", "POST", "/api/push/unsubscribe", { as: "jagan", body: { endpoint: "https://fcm.googleapis.com/fcm/send/jagan-phone" } });
  await c("delete expense not found", "POST", E + "/nope/delete", { as: "vicky" });
  await c("delete expense not allowed", "POST", `${E}/${hotel}/delete`, { as: "vicky" });
  await c("delete expense", "POST", `${E}/${biryani}/delete`, { as: "nikhil" });
  await c("history all", "GET", G + "/history", { as: "jagan" });
  await c("unknown group route", "GET", G + "/whatever", { as: "vicky" });
  await c("unknown group method", "DELETE", G, { as: "vicky" });

  // ----- Leaving and removing -----
  await c("make jagan admin", "POST", G + `/members/${ids.jagan}/make-admin`, { as: "nikhil" });
  await c("jagan removes paro", "POST", G + `/members/${ids.paro}/remove`, { as: "jagan" });
  await c("removed paro opens group", "GET", G, { as: "paro" });
  await c("removed name in expenses", "GET", E, { as: "vicky" });
  await c("admin pays removed", "POST", S, { as: "nikhil", body: { fromMemberId: ids.nikhil, toMemberId: ids.paro, amount: "1" } });
  await c("member pays removed", "POST", S, { as: "arsha", body: { fromMemberId: ids.arsha, toMemberId: ids.paro, amount: "1" } });
  await c("raju leaves", "POST", G + "/leave", { as: "raju" });
  await c("nikhil steps down", "POST", G + `/members/${ids.nikhil}/make-member`, { as: "nikhil" });
  await c("make member not admin", "POST", G + `/members/${ids.vicky}/make-member`, { as: "jagan" });

  // ----- Notifications -----
  for (const who of ["vicky", "jagan", "paro"]) await c(`notifications ${who}`, "GET", "/api/notifications", { as: who });
  await c("notifications read", "POST", "/api/notifications/read", { as: "vicky" });
  await c("notifications after read", "GET", "/api/notifications", { as: "vicky" });

  // ----- Linking another account (merge) -----
  await c("link unknown", "POST", "/api/me/link", { as: "cutie", body: { login: "ghost", password: PASS } });
  await c("link self", "POST", "/api/me/link", { as: "cutie", body: { login: "cutie", password: PASS } });
  await c("link ambiguous legacy", "POST", "/api/me/link", { as: "cutie", body: { group: "Old Trip", name: "Sam", password: PASS } });
  await c("link no password set", "POST", "/api/me/link", { as: "cutie", body: { login: "gina2@example.com" } });
  await c("link missing password", "POST", "/api/me/link", { as: "cutie", body: { login: "arsha" } });
  await c("link wrong password", "POST", "/api/me/link", { as: "cutie", body: { login: "arsha", password: "wrong1234" } });
  await c("link arsha into cutie", "POST", "/api/me/link", { as: "cutie", body: { login: "arsha", password: PASS } });
  await c("arsha's session gone", "GET", "/api/me", { as: "arsha" });
  await c("cutie groups", "GET", "/api/groups", { as: "cutie" });
  await c("cutie unlock", "POST", G + "/unlock", { as: "cutie", body: { pin: "2468" } });
  await c("merged expenses", "GET", E, { as: "cutie" });
  await c("merged friends", "GET", "/api/friends", { as: "cutie" });
  await c("merged notifications", "GET", "/api/notifications", { as: "cutie" });
  for (let i = 0; i < 11; i++) await c(`link rate ${i}`, "POST", "/api/me/link", { as: "zed", body: { login: "ghost" } });

  // ----- Site owner console -----
  await c("site admin hidden (no owner yet)", "GET", "/api/site-admin/overview", { as: "vicky" });
  await c("site admin wrong key", "POST", "/api/site-admin/unlock", { as: "nikhil", body: { key: "nope" } });
  await c("site admin unlock", "POST", "/api/site-admin/unlock", { as: "nikhil", body: { key: "old-admin-key-77" } });
  await c("me as owner", "GET", "/api/me", { as: "nikhil" });
  await c("other can't unlock", "POST", "/api/site-admin/unlock", { as: "vicky", body: { key: "old-admin-key-77" } });
  await c("overview", "GET", "/api/site-admin/overview", { as: "nikhil" });
  await c("users", "GET", "/api/site-admin/users", { as: "nikhil" });
  await c("users search", "GET", "/api/site-admin/users?q=" + encodeURIComponent("Vi%"), { as: "nikhil" });
  await c("groups", "GET", "/api/site-admin/groups", { as: "nikhil" });
  await c("groups search", "GET", "/api/site-admin/groups?q=goa", { as: "nikhil" });
  await c("reset group pin unknown", "POST", "/api/site-admin/groups/nope/reset-pin", { as: "nikhil" });
  await c("reset group pin", "POST", `/api/site-admin/groups/${goa}/reset-pin`, { as: "nikhil" });
  await c("unknown admin route", "GET", "/api/site-admin/whatever", { as: "nikhil" });
  await c("group open without pin", "GET", G, { as: "vicky" });
  await c("lock", "POST", "/api/site-admin/lock", { as: "nikhil" });
  await c("locked console", "GET", "/api/site-admin/overview", { as: "nikhil" });
  await c("other session not unlocked", "GET", "/api/site-admin/users", { as: "nikhil2" });
  t.env.ADMIN_PIN = "";
  await c("admin key not configured", "POST", "/api/site-admin/unlock", { as: "nikhil", body: { key: "x" } });
  t.env.ADMIN_PIN = "old-admin-key-77";

  // ----- Delete the group, then housekeeping -----
  await c("delete by member", "POST", G + "/delete", { as: "vicky" });
  const tmp = (await c("second group", "POST", "/api/groups", { as: "vicky", body: { name: "Weekend", pin: "1111" } })).data.group.id;
  await c("second group expense", "POST", `/api/groups/${tmp}/expenses`, { as: "vicky", body: { description: "Snacks", amount: "50", paidBy: ids.vicky, memberIds: [ids.vicky] } });
  await c("leave as only person", "POST", `/api/groups/${tmp}/leave`, { as: "vicky" });
  await c("delete group", "POST", G + "/delete", { as: "jagan" });
  await c("deleted group", "GET", G, { as: "jagan" });
  await c("groups after delete", "GET", "/api/groups", { as: "jagan" });
  t.tick(8 * 24 * 60 * 60 * 1000);
  await c("session expired", "GET", "/api/me", { as: "vicky" });
  await t.cron("daily cleanup");
  await c("signin after a week", "POST", "/api/auth/signin", { keepAs: "vicky", body: { login: "vicky", password: PASS } });
  t.tick(91 * 24 * 60 * 60 * 1000);
  await c("signin after three months", "POST", "/api/auth/signin", { keepAs: "vicky", body: { login: "vicky", password: PASS } });
  await c("old notifications cleared on read", "GET", "/api/notifications", { as: "vicky" });
  await t.cron("daily cleanup later");

  // ----- No need to pay (waivers), in a new group -----
  // Vicky (admin) and Jagan (made admin) can approve; Paro lends to Gina.
  await c("signin jagan later", "POST", "/api/auth/signin", { keepAs: "jagan", body: { login: "jagan", password: PASS } });
  await c("signin paro later", "POST", "/api/auth/signin", { keepAs: "paro", body: { login: "paro", password: PASS } });
  await c("signin gina later", "POST", "/api/auth/signin", { keepAs: "gina", body: { login: "ginarao", password: PASS } });
  const flat = (await c("flat group", "POST", "/api/groups", { as: "vicky", body: { name: "Flat", pin: PIN } })).data.group.id;
  const F = `/api/groups/${flat}`, W = F + "/settlements/waive", FS = F + "/settlements";
  for (const who of ["jagan", "paro", "ginarao"]) await c(`flat invite ${who}`, "POST", F + "/members/invite", { as: "vicky", body: { login: who } });
  for (const who of ["jagan", "paro", "gina"]) await c(`flat accept ${who}`, "POST", F + "/invitation/accept", { as: who, body: { pin: PIN } });
  await c("flat make jagan admin", "POST", F + `/members/${ids.jagan}/make-admin`, { as: "vicky" });
  await c("flat rent", "POST", F + "/expenses", { as: "paro", body: { description: "Rent", amount: "300", paidBy: ids.paro, memberIds: [ids.paro, ids.gina, ids.vicky] } });
  await c("flat wifi", "POST", F + "/expenses", { as: "vicky", body: { description: "Wifi", amount: "90", paidBy: ids.vicky, memberIds: [ids.vicky, ids.gina] } });
  await c("waive nobody", "POST", W, { as: "paro", body: {} });
  await c("waive self", "POST", W, { as: "paro", body: { fromMemberId: ids.paro } });
  await c("waive outsider", "POST", W, { as: "paro", body: { fromMemberId: ids.nikhil } });
  await c("waive not owed", "POST", W, { as: "jagan", body: { fromMemberId: ids.gina } });
  await c("waive bad amount", "POST", W, { as: "paro", body: { fromMemberId: ids.gina, amount: "abc" } });
  await c("waive too much", "POST", W, { as: "paro", body: { fromMemberId: ids.gina, amount: "500" } });
  const w1 = (await c("waive part", "POST", W, { as: "paro", body: { fromMemberId: ids.gina, amount: "40" } })).data.id;
  await c("waiver pending (admin)", "GET", "/api/payments/pending", { as: "jagan" });
  await c("waiver pending (debtor)", "GET", "/api/payments/pending", { as: "gina" });
  await c("lender can't approve waiver", "POST", `${FS}/${w1}/confirm`, { as: "paro" });
  await c("debtor can't cancel waiver", "POST", `${FS}/${w1}/cancel`, { as: "gina" });
  await c("admin approves waiver", "POST", `${FS}/${w1}/confirm`, { as: "jagan" });
  const w2 = (await c("waive the rest", "POST", W, { as: "paro", body: { fromMemberId: ids.gina } })).data.id;
  await c("waive nothing left", "POST", W, { as: "paro", body: { fromMemberId: ids.gina } });
  await c("admin rejects waiver", "POST", `${FS}/${w2}/reject`, { as: "vicky" });
  const w3 = (await c("waive the rest again", "POST", W, { as: "paro", body: { fromMemberId: ids.gina } })).data.id;
  await c("lender cancels waiver", "POST", `${FS}/${w3}/cancel`, { as: "paro" });
  await c("admin lender waives at once", "POST", W, { as: "vicky", body: { fromMemberId: ids.gina } });
  await c("flat payments", "GET", FS, { as: "gina" });
  await c("flat debts", "GET", F + "/debts", { as: "gina" });
  await c("gina with paro", "GET", F + `/with/${ids.paro}`, { as: "gina" });
  await c("gina summary", "GET", F + `/members/${ids.gina}`, { as: "gina" });
  await c("gina statement", "GET", F + `/members/${ids.gina}/statement`, { as: "gina" });
  for (const who of ["gina", "paro", "vicky", "jagan"]) await c(`waiver notifications ${who}`, "GET", "/api/notifications", { as: who });
}
