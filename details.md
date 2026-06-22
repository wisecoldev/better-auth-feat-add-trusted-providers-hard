## Recommended approach

Mirror what already exists for `trustedOrigins`. Specifically:

1. Widen the option type in the public `BetterAuthOptions` surface so
   `trustedProviders` accepts `T[] | ((request?: Request) =>
   Awaitable<T[]>)`. T is the same `LiteralUnion<...>` it already uses.
   Keep the JSDoc consistent with the trustedOrigins JSDoc.
2. Resolve the providers in the same way `getTrustedOrigins` resolves
   origins (handle array form, function form, undefined-input, falsy
   entries in the resolved list).
3. Cache the resolved list somewhere the per-callsite checks can read
   from — `AuthContext` is the natural place and matches how
   `trustedOrigins` is plumbed.
4. Re-resolve on every incoming request inside `auth.handler`,
   mirroring the line that already re-assigns `ctx.trustedOrigins` per
   request. Pass the incoming `Request` to the resolver. (The
   init-time call — if you make one for parity — should pass no
   request.)

## Touch every account-linking entry point

The trusted-providers check appears in several places today; all of
them must end up reading the resolved list, not the raw option. By
feature name, the surfaces involved are:

- The interactive `linkSocial` endpoint
- The OAuth callback handler
- The lower-level OAuth user-info handler shared by the two above
- The Google One Tap plugin's link-existing-user branch
- The SAML SSO callback and ACS endpoints in the `@better-auth/sso`
  package

You'll find the existing checks by grepping for the option name
(`trustedProviders`); the goal is to make every existing check
participate in the dynamic-resolution flow rather than each callsite
re-implementing it.

## Things to get right

- **Per-request, not just per-init.** Tenant-aware resolvers will
  produce different lists for different requests; if you only resolve
  once at init, every request after the first sees a stale list.
- **Async support.** The resolver returns `Awaitable<string[]>`, so
  `await` it.
- **Filter falsy values.** A resolver may produce `["google", null,
  undefined, ""]`. The downstream `.includes` checks should not crash
  or false-match on that — match what `getTrustedOrigins` already does.
- **Don't break the static-array shape.** The existing
  `trustedProviders: ["google", "github"]` configuration must keep
  working unchanged.
- **Don't trust by default when a function is supplied.** A resolver
  that returns `[]` (or omits a provider) must continue to reject
  unverified-email account linking for that provider.
