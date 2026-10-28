# Farm & Orchard Planner (Farm Tasks)

Task planner for Mahakaruna Farm, Ngatimoti. Express API and React web planner in one container.

## Where it runs

- Live app: Google Cloud Run, service `farm-tasks`, project `farm-tasks-ngatimoti`, region `australia-southeast1` (Sydney).
- Database: Neon Postgres (project `wandering-pond-24940270`). Migrations in `lib/db/drizzle` run on startup.
- Logins: Clerk.
- Secrets live in Google Secret Manager, never in this repo.

## How changes go live

Every push to `main` runs the Cloud Build trigger `deploy-farm-tasks`, which builds with `cloudbuild.yaml` and deploys to Cloud Run. The trigger passes `_CLERK_PUBLISHABLE_KEY` as a substitution.

Check a deploy in the Cloud console under Cloud Build > History.
