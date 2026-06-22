# Review: `better-auth-feat-add-trusted-providers` (hard) task submission

> This is a SWE-bench-style **task-authoring submission**, reverse-engineered from a real merged PR
> (better-auth #7904).

## What this is

An authored agentic-coding task. The feature: extend `account.accountLinking.trustedProviders` so it
accepts a **dynamic async resolver** `(request?) => Awaitable<T[]>` in addition to the existing static
array — mirroring how `trustedOrigins` already works — and thread the resolved list through **all
five** account-linking trust checks (interactive `linkSocial`, OAuth callback, the shared
`handleOAuthUserInfo`, Google One-Tap, and the SAML SSO callback + ACS endpoints). The motivating
case is per-tenant SAML trust. Deliverables: `instruction.md`/`details.md`/`task.toml`, an oracle
patch (91 SLOC, 10 files), an LLM rubric pair, a vitest verifier, a runtime validation spec (3
stories), and two solver trajectories.

## Verdict

**Strong, clean task with an exemplary oracle and a thoughtfully anti-overfit verifier — but its
behavioral coverage is materially narrower than its own acceptance bar, and the trajectory evidence
proves it.** The task explicitly demands all five callsites be updated, yet every deterministic check
and all three validation stories exercise only the OAuth `/callback/google` path. One of the two
recorded solvers shipped a real SSO regression and still scored full reward.

---

## Strengths

**1. Excellent task selection and an exemplary oracle.** "Mirror an existing in-repo pattern
(`trustedOrigins`) for a new option, with a security dimension" is an ideal hard-but-bounded feature
task: it rewards codebase discovery (find all five checks), pattern fluency, per-request reasoning,
async handling, and defensive coding. The oracle (`solution/oracle.patch`) is a model reference — 91
SLOC, idiomatic, no breaking changes, a clean `getTrustedProviders` helper that exactly parallels
`getTrustedOrigins` (`context/helpers.ts`), an `AuthContext.trustedProviders` field, init +
per-request population, and a genuinely good JSDoc block with two `@example`s on the widened type
(`init-options.ts:887+`).

**2. The verifier is deliberately tolerant of valid alternatives.** `verify.test.ts` documents that
it does **not** read `ctx.context.trustedProviders` and does **not** import any task-introduced
helper (`verify.test.ts:16-19`), so inline-at-callsite resolution, a differently-named helper, or a
per-request-only implementation all pass. `task.toml` enumerates those accepted alternatives
explicitly (`:130-139`). That's exactly the right anti-overfit discipline.

**3. The validation stories are genuinely well-designed where they reach.** Story 2 wraps the
resolver in `vi.fn` and asserts on the spy's actual returned list size (`validation_spec.toml:271-302`)
— proving the resolver was *invoked and its content evaluated*, not merely shape-accepted. Story 3
uses a single resolver that branches on a `tenant` query param and asserts two different requests
produce opposite outcomes (`:311-367`) — a direct test of the "don't cache at init" failure mode. The
negative cases (empty list → reject; `tenant=beta` → reject) guard against trust-by-default.

**4. The task validated as solvable and discriminating.** Both solvers passed the static-array
regression and all 6 validation cases (reward 1.0), but the quality axis separated them: one scored
`rubric_all` 1.0; the other scored 0.957 with the "every callsite updated" criterion flagged at 0.7.
The harness produced a clean solvable-but-separating signal.

**5. Communication is strong.** `task.toml`'s narrative/context/solution is thorough and names the
exact failure modes; `details.md` gives a crisp "recommended approach" plus the four things to get
right (per-request not per-init, await, filter falsy, don't trust by default). `instruction.md` stays
appropriately abstract — it states the contract and the SAML motivation without leaking the
five-callsite list, leaving discovery to the solver.

---

## Weaknesses

**1. (Headline) Behavioral coverage is narrower than the task's own acceptance bar — and a trajectory
proves it bites.** The spec's central demand is "touch **every** account-linking entry point" — five
callsites across two packages (`details.md:22-37`). But the deterministic verifier drives only
`/callback/google` (`verify.test.ts:167`), and **all three** validation stories drive that *same*
flow — the spec instructions literally say "every story drives the SAME OAuth callback flow"
(`validation_spec.toml:80-82`). So `linkSocial`, One-Tap, and **both SSO endpoints are never
exercised behaviorally**. The proof: one trajectory introduced an SSO regression (removed the
`trustedProviders.includes(...)` check on the SSO path without the `||` replacement) and **still
earned reward 1.0 and passed all 6 validation cases** — only the LLM `rubric_all` caught it (0.7 on
that criterion). Four of the five required callsites are verified solely by an LLM reading the diff.

**2. The binary reward is decoupled from the coverage/quality rubric that actually catches
regressions.** `reward.txt` is 1.0 for *both* trajectories, including the one with the SSO bug. The
`rubric_all` and taste scores that detected the regression and the architectural misses don't gate
the reward. For a task whose whole point is "all five callsites," the gating signal verifies one of
them and the most discriminating layer (rubric_all) is advisory.

**3. The SSO package — the motivating use case — has zero harness coverage.** `instruction.md`
*leads* with enterprise SAML/tenant trust as the reason the feature exists, and the oracle edits
`packages/sso/src/routes/sso.ts` (two endpoints). Yet neither the verifier nor any validation story
loads `@better-auth/sso`. The most security-sensitive, motivation-central callsites are exactly the
ones with no behavioral test. A single validation story (or verifier test) driving the SSO ACS/callback
path would close the gap that the regressing trajectory fell through.

**4. The core deliverable — a TypeScript type widening — has no compile-time check.** Unlike a sibling
task in this family that gated on `pnpm typecheck`/`build`, this task has no `tsc` gate at all
(`verify.test.ts` is `// @ts-nocheck`, runtime-only). The "type widened to accept both array and
function, no breaking change" requirement (`rubric.json` `trusted_providers_type_widened_to_function`)
is verified *only* by an LLM reading the diff. For a TS-library feature whose spine is a union-type
change, a small `expectTypeOf`/`tsd` assertion (both shapes assignable, static array still assignable)
would be a cheaper, stronger, more reproducible signal than an LLM judgment.

**5. A stated robustness requirement is untested.** `details.md:46-48` explicitly calls out filtering
falsy values (`["google", null, undefined, ""]`), and the oracle implements it — but no validation
case feeds a falsy-laden list. Story 2 tests empty/excluding lists, not the filter robustness the task
makes a point of.

**6. Minor oracle nit (intentional but worth flagging).** The oracle resolves `getTrustedProviders` at
init in `create-context.ts:206` (with `request` undefined) and then again per-request in `base.ts:46`.
Since account-linking only ever runs on a request, the init-time value is always overwritten before
any callsite reads it — for a tenant-aware resolver it's a wasted async call returning `[]`.
`task.toml:135-139` acknowledges this is skippable; keeping it "for parity with trustedOrigins" is
defensible, but it's dead resolution worth a comment.

---

## Dimension summary

| Dimension | Assessment |
|---|---|
| **Code quality** | Excellent oracle — minimal, idiomatic, faithful mirror of `trustedOrigins`, strong JSDoc. One redundant init-time resolve. |
| **Testing approach** | Well-built where it reaches (spy-verified resolver invocation, per-request variance, trust-by-default negatives) and nicely anti-overfit — but coverage is confined to one of five required callsites; no SSO, no type-level, no falsy-filter test. |
| **Problem-solving** | Strong task framing: real PR, clear pattern to mirror, genuine discovery + security reasoning. |
| **Maintainability** | Self-contained, parameterized harness; accepted-alternatives documented. Weakened by reward/coverage decoupling. |
| **Communication** | Very good — precise narrative, failure-mode list, abstract-but-sufficient instruction. |

## If I were to prioritize fixes

1. **Add behavioral coverage for the non-callback callsites** — at minimum one validation story (or
   verifier test) for `linkSocial` and one for the SSO ACS/callback path. Today a regression in four
   of five required callsites passes the gate; a recorded trajectory demonstrates it.
2. **Gate the reward on callsite coverage** (or fold `rubric_all`'s coverage criterion into the binary
   signal) so a real SSO regression can't ship with reward 1.0.
3. **Add a compile-time assertion for the type widening** (`expectTypeOf`/`tsd` or a `typecheck` step)
   — the central API contract is currently LLM-verified only.
4. **Add a falsy-filter behavioral case**, and consider importing `@better-auth/sso` in the verifier
   since SAML is the motivating scenario.

Net: a high-quality, well-communicated task with one of the cleanest oracles in this family — but I'd
hold the merge until the harness actually exercises the five callsites it requires, because the
recorded trajectories already show a required callsite regressing undetected by the gating signal.
