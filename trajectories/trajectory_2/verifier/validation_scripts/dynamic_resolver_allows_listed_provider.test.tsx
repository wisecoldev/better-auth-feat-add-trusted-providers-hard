// @ts-nocheck
import type { GoogleProfile } from "@better-auth/core/social-providers";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { signJWT } from "../../crypto";
import { getTestInstance } from "../../test-utils/test-instance";
import { DEFAULT_SECRET } from "../../utils/constants";

import { getTestCases } from "./validationParams";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("dynamic_resolver_allows_listed_provider", () => {
  const cases = getTestCases();
  it.each(cases)("case $#", async ({ inputs, expected }) => {
    // 1. Build a fresh auth instance with the per-case async resolver.
    const resolverReturns = inputs.resolver_returns;
    const { auth, client, cookieSetter } = await getTestInstance({
      socialProviders: {
        google: { clientId: "test", clientSecret: "test", enabled: true },
      },
      emailAndPassword: { enabled: true },
      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: async (_request) => resolverReturns,
        },
      },
    });
    const ctx = await auth.$context;

    // Use unique email/sub per case to avoid collisions
    const caseId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userEmail = `user-${caseId}@example.com`;
    const userSub = `sub-${caseId}`;

    // 2. Pre-create the user so the OAuth callback exercises the LINK branch.
    const created = await ctx.adapter.create({
      model: "user",
      data: {
        email: userEmail,
        name: "Existing User",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const userId = created.id;

    // 3. Stub the Google token-exchange endpoint via msw.
    server.use(
      http.post("https://oauth2.googleapis.com/token", async () => {
        const profile: GoogleProfile = {
          email: userEmail,
          email_verified: false, // unverified → trustedProviders gates
          name: "Test User",
          picture: "https://example.com/photo.jpg",
          sub: userSub,
          iat: 1234567890,
          exp: 1234567890,
          aud: "test",
          azp: "test",
          nbf: 1234567890,
          iss: "test",
          locale: "en",
          jti: "test",
          given_name: "Test",
          family_name: "User",
        };
        const idToken = await signJWT(profile, DEFAULT_SECRET);
        return HttpResponse.json({
          access_token: "test_access_token",
          refresh_token: "test_refresh_token",
          id_token: idToken,
        });
      }),
    );

    // 4. Drive client.signIn.social and capture the redirect URL state.
    const oAuthHeaders = new Headers();
    const signInRes = await client.signIn.social({
      provider: "google",
      callbackURL: inputs.configured_callback_url,
      fetchOptions: { onSuccess: cookieSetter(oAuthHeaders) },
    });
    const state =
      new URL(signInRes.data!.url!).searchParams.get("state") || "";

    // 5. Drive the actual OAuth callback. Capture the final redirect's
    //    Location header via onError (every 302 surfaces as an error here).
    let redirectLocation = "";
    await client.$fetch("/callback/google", {
      query: { state, code: "test_code" },
      method: "GET",
      headers: oAuthHeaders,
      onError(c: any) {
        redirectLocation = c.response.headers.get("location") || "";
      },
    });

    // 6. Read post-flow account rows for the user.
    const accounts = await ctx.adapter.findMany({
      model: "account",
      where: [{ field: "userId", value: userId }],
    });
    const linkedAccountCount = accounts.filter(
      (a: any) => a.providerId === "google",
    ).length;

    // Assertions
    expect(linkedAccountCount).toBe(expected.linked_account_count);
    expect(redirectLocation).toContain(expected.redirect_substring);
    expect(redirectLocation).not.toContain("error=account_not_linked");
  });
});
