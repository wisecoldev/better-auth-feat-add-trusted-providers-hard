// @ts-nocheck
//
// Behavioural verifier for better-auth-feat-add-trusted-providers (PR #7904).
//
// Single pass-to-pass regression guard: the static-array shape of
// `account.accountLinking.trustedProviders` continues to allow
// unverified-email account-linking for listed providers. Catches
// implementations that "fix" function-shape support by removing the
// static-array path.
//
// All forward-pass behaviour (resolver allows / excludes / per-request
// invocation) is exercised by the validation_spec stories — they hit
// the same `auth.handler` surface but are CC-driven, so we don't
// duplicate them here.
//
// We do NOT read `ctx.context.trustedProviders` or import any
// task-introduced helper function. Any valid alternative implementation
// passes this test: an AuthContext field + helper, inline resolution
// at each callsite, helper in a different module, etc.

import type { GoogleProfile } from "@better-auth/core/social-providers";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { signJWT } from "../crypto";
import { getTestInstance } from "../test-utils/test-instance";
import { DEFAULT_SECRET } from "../utils/constants";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

/**
 * Mock the Google token-exchange endpoint to return an id_token whose
 * decoded profile carries the supplied email + verification flag and a
 * deterministic `sub`. Mirrors the helper pattern in
 * packages/better-auth/src/oauth2/link-account.test.ts.
 */
function stubGoogleTokenExchange(opts: {
	email: string;
	emailVerified: boolean;
	sub: string;
}) {
	server.use(
		http.post("https://oauth2.googleapis.com/token", async () => {
			const profile: GoogleProfile = {
				email: opts.email,
				email_verified: opts.emailVerified,
				name: "Test User",
				picture: "https://example.com/photo.jpg",
				exp: 1234567890,
				sub: opts.sub,
				iat: 1234567890,
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
}

/**
 * Build a fresh auth+client wired with the supplied `trustedProviders`
 * config, pre-create a user with the supplied email so the linking
 * branch is exercised (not the new-user branch), drive the OAuth
 * callback flow, and return the redirect Location plus the post-flow
 * count of Google account rows linked to that user.
 *
 * All steps mirror the in-repo `link-account.test.ts` pattern.
 */
async function driveOAuthCallback(opts: {
	trustedProviders: any;
	userEmail: string;
	emailVerified: boolean;
	sub: string;
	callbackURL?: string;
}): Promise<{ redirectLocation: string; linkedAccountCount: number }> {
	const { auth, client, cookieSetter } = await getTestInstance({
		socialProviders: {
			google: {
				clientId: "test",
				clientSecret: "test",
				enabled: true,
			},
		},
		emailAndPassword: {
			enabled: true,
		},
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: opts.trustedProviders,
			},
		},
	});

	const ctx = await auth.$context;

	// Pre-create the user so the linking branch (not new-user branch)
	// is exercised by the OAuth callback flow. The Kysely adapter
	// auto-generates ids; capture the actual id from the result rather
	// than hardcoding one (the adapter rejects user-supplied ids unless
	// forceAllowId is set, which would be over-coupling).
	const createdUser = await ctx.adapter.create<{
		id: string;
		email: string;
	}>({
		model: "user",
		data: {
			email: opts.userEmail,
			name: "Existing User",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});
	const actualUserId = createdUser.id;

	stubGoogleTokenExchange({
		email: opts.userEmail,
		emailVerified: opts.emailVerified,
		sub: opts.sub,
	});

	const oAuthHeaders = new Headers();
	const signInRes = await client.signIn.social({
		provider: "google",
		callbackURL: opts.callbackURL ?? "/",
		fetchOptions: {
			onSuccess: cookieSetter(oAuthHeaders),
		},
	});

	const state =
		new URL(signInRes.data!.url!).searchParams.get("state") || "";

	let redirectLocation = "";
	await client.$fetch("/callback/google", {
		query: { state, code: "test_code" },
		method: "GET",
		headers: oAuthHeaders,
		onError(context: any) {
			redirectLocation =
				context.response.headers.get("location") || "";
		},
	});

	const accounts = await ctx.adapter.findMany<{ providerId: string }>({
		model: "account",
		where: [{ field: "userId", value: actualUserId }],
	});
	const linkedAccountCount = accounts.filter(
		(a) => a.providerId === "google",
	).length;

	return { redirectLocation, linkedAccountCount };
}

describe("trusted providers (dynamic)", () => {
	it("static array still trusts the provider in OAuth account linking", async () => {
		// Pass-to-pass: regression guard for the existing static-array shape.
		const { redirectLocation, linkedAccountCount } =
			await driveOAuthCallback({
				trustedProviders: ["google"],
				userEmail: "static-array@example.com",
				emailVerified: false,
				sub: "g_static_001",
			});

		// The link succeeded, so the redirect does not carry an error.
		expect(redirectLocation).not.toContain("error=account_not_linked");
		// And the account row exists.
		expect(linkedAccountCount).toBe(1);
	}, 60_000);
});
