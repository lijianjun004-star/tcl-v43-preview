# Local-only backend replay

`source/` holds byte-identical copies of the original tests; `snapshots/` holds their final synthetic results. `SOURCE-SHA256.json` records every copied file's original SHA256. There are no real credentials, private fixtures, database files or dependencies in this delivery. Literal passwords and invitations in the tests are public local-only fixtures; the Native provider is a test double.

Install the pinned local test dependencies in this directory with `npm ci`, then run:

```sh
node run-local.mjs
```

When dependencies are already installed elsewhere, no installation is necessary:

```sh
node run-local.mjs --deps /workspace/r25-name-identity-tests
```

The runner creates a fresh `/tmp/r25ni-replay-*` directory, symlinks the explicitly selected dependencies and changes only absolute filesystem paths in temporary copies. It points the handler test at the current repository's `handler.cjs`. It runs service 102, handler 48, namespace 17, historical precedence 7, and native PostgreSQL concurrency 19 assertions sequentially. The historical test needs the included pre-casefold SQL fixture to construct an upgrade collision.

Fresh result files, stdout/stderr logs, local PostgreSQL data and `replay-summary.json` remain in that temporary directory, including on failure; original snapshots are never overwritten. The native PostgreSQL server listens only on localhost and is stopped by the test. The runner does not deploy, invoke CloudBase, read credentials or create real accounts. It stops on the first failed suite and does not automatically repeat it.

The two-connection test uses the pinned `embedded-postgres` Linux binary package. These tests require a compatible Node/Linux environment and permission to run local processes; they do not provide cloud-provider evidence. The runner's filesystem adaptation is explicitly separate from the original recorded snapshots.
