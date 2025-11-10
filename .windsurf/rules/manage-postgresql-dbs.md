---
trigger: model_decision
---

Run all dbtool commands from the project root unless a task specifies otherwise. The binary is already on the PATH, so invoke it directly as dbtool ….
Supported subcommands (see dbtool --help for details):
dbtool database list (ls) — list all Xata databases in the workspace.
dbtool database dump (export) <dbname> <filepath> [--structure-only] — export the database to a local file.
dbtool database import (load) <dbname> <filepath> [--overwrite] — import a dump file into the named database.
dbtool database reset (wipe) <dbname> [--noconfirm] — wipe a database (use only when explicitly approved).
dbtool table list (ls) [<dbname>] [--schema=<schema>] — list tables; omit <dbname> to see all.
dbtool query (q) [<dbname>] --query="<sql>" [--json] — run ad‑hoc SQL; add --json to return machine-parseable output.
Always review generated SQL or schema changes before executing destructive commands (reset, import --overwrite, etc.). Prompt the user for confirmation when there is any ambiguity or potential data loss.
Capture command output in the task log or commit summary when it influences code or schema changes (e.g., dumps, query results, migrations).
If you need additional options, call dbtool help <command> [subcommand] to view command-specific usage.