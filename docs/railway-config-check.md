# Checking deployment docs against Railway (method)

Use this procedure whenever the question "does the documented production sequence match the actual Railway setup?" comes up. Configuration drifts, so do not record a snapshot of IDs, domains, or variable values in the repository — re-run the check instead and record only the durable conclusion (for example, "migrations are manual").

The Railway MCP tools are the preferred path; the CLI equivalents (`railway project list`, `railway service list`, `railway logs`, `railway status`) work when authenticated locally. Never render or print environment variable values — only their names.

1. **Discover scope.** `list-projects`, then match the project by name rather than hard-coding an ID. `list-services` gives the environments, app service, and database service. If more than one environment exists, check each one that hosts the app.
2. **Read the live config.** `describe-service` for the app in the target environment returns the source repo/branch, build and deploy settings, networking/ports, and `variableNames`. Compare the required variable names with the README's Environment Variables table. Do not read variable values.
3. **See what actually runs.** `get-logs` on the latest deployment with `types: ["build"]` shows the real install/build commands and whether any migration command runs. `types: ["deploy"]` shows the runtime start command and listening port. A `[ELIFECYCLE] Command failed` line after a successful start can be the idle-sleep path; confirm with `describe-service` (`sleepApplication`) and `list-deployments` status before treating it as a failure.
4. **Confirm the deployed revision.** `list-deployments` shows the commit and status of each deployment. Match the latest successful one to what the docs claim is deployed.
5. **Compare and report.** Note only durable facts: which commands the platform runs, whether migrations are automatic or manual, which port/domain serves the client, and which variables are required. If the README disagrees, fix the README; do not paste the inspection output into docs or issues.
