# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately through GitHub instead:
**Security → Report a vulnerability** on this repository.

Include what is affected (database function, Edge Function, package), how to reproduce it, and what an attacker
could do with it. You should get a reply within a week.

## What counts

- A user granting themselves, or someone else, a reward they didn't earn, or the same reward twice
- Reading another user's data through an RPC, or calling a service-only function as a user
- Webhook or worker endpoints that accept requests without the right secret or signature
- Personal data stored or logged where `docs/privacy.md` says it isn't

## Scope

This repository holds the kit only. An app that uses it runs its own Supabase project, RevenueCat project and keys,
and is responsible for keeping them secret.
