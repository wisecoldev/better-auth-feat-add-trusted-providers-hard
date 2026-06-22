## Task

Our OAuth account-linking has a configurable allow-list of providers
that bypass the "unverified email" check — providers on the list can
complete account-linking even when the OAuth callback returns an
unverified email. Today the list has to be a static array known at
startup.

The motivating use case is enterprise SAML: the allow-list depends
on the tenant identified by something on the incoming request
(subdomain, header, query param). Right now there's no way to
compute it per request, so anyone wiring up SAML providers
dynamically has no way to opt them into account linking.

Extend the config to also accept a dynamic resolver, mirroring the
shape we already use for `trustedOrigins`. No breaking changes.

## User stories

- When the OAuth account-linking allow-list is supplied as an async function and the function returns a list containing the OAuth provider, an unverified-email user from that provider is treated as trusted and the account is linked. The OAuth callback follows through to the configured callbackURL.
- When the dynamic resolver returns a list that does NOT contain the OAuth provider, an unverified-email account-linking attempt for that provider is rejected — the account row is never created.
- The dynamic resolver receives the incoming Request object on each callback so the application can vary trust decisions per request. With a single resolver implementation that derives the allow-list from something on the incoming request (a header, a query parameter, the URL path), two callbacks made with different request inputs must produce different trust outcomes — one allowing the link, the other rejecting it.

## General instructions

- The code repo is at /repo/better-auth.
- You are inside of a Docker container. You may not be able to perform all operations you would normally be able to do on a local machine. Dependencies have not been pre-installed, and you may need to install them yourself.
- You are expected to act autonomously as a software engineer to complete tasks you are given.
- Do not stop until you feel you have completed the task and your code changes can be merged.
- You may need to use software engineering skills like analyzing the codebase, researching technologies, running services, analyzing logs, etc. to complete the task. Not all tasks will be solvable by reading source code alone.
