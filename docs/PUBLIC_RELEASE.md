# Public repository checklist

The local application is ready to be reviewed as source. Publication and deployment are separate owner decisions. This page tracks what should be checked before the first public commit.

## Source and data

- Keep `.env.local`, `data/`, SQLite and WAL files, private recordings, browser traces, logs, `.next/` and `node_modules/` out of the repository. The current `.gitignore` excludes these paths, but inspect staged files before every publication.
- Publish only the labeled synthetic screenshots under `docs/images/`. Private genuine evidence and payment references are not bundled or approved as public fixtures.
- Do not paste model prompts, access tokens, API keys, buyer details or raw provider responses into issues, screenshots, documentation or example code.
- Run a clean checkout with `npm ci` and the no-key exercises. Confirm that genuine archive cards report unavailable rather than substituting synthetic data.
- Confirm the README, product brief, setup and technical guide describe the same current routes and limitations.

## Optional integrations

Local Qwen3 setup and optional Channel3 key acquisition are in [SETUP.md](SETUP.md), with links to official sources. Contributors use their own keys in an ignored `.env.local` file. No shared key, private database or buyer account is needed for a clean checkout. The sandbox adapter remains an internal, server-owned test boundary; default tests mock external transport.

## Security and deployment limit

The current app is local and single-owner. It has no authenticated multi-tenant service, production rate limits, hosted secret management, approval ownership, database tamper evidence or supported public financial deployment. Do not expose the development server as an internet-facing financial control product. A hosted version needs a separate threat model, authentication, tenant isolation, retention, backup/restore, provider-access review and operational monitoring.

## Licenses

The application is MIT licensed. AG Grid **Community** is used; no Enterprise module is installed. Lockfile review previously found MIT, ISC, BSD, Apache-2.0, 0BSD, a dual MIT/WTFPL option, CC-BY-4.0 (`caniuse-lite`) and compound Apache/MIT/LGPL notices for Sharp binary/WASM packages. Preserve upstream notices and applicable redistribution obligations; the root MIT license does not relicense dependencies. Ollama and Qwen3 are separate optional installations subject to their upstream terms. Re-run license and dependency checks before distributing a packaged build.

## Final checks

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Review the generated client assets and staged files for accidental credentials. Verify that no test created a new financial operation. Record actual results in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md). No source publication or deployment has been performed by this checklist.
