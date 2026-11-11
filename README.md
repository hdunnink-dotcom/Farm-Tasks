# Farm & Orchard Planner (Farm Tasks)

Task planner for Mahakaruna Farm, Ngatimoti. Express API and React web planner in one container.

## Where it runs

- Live app: Google Cloud Run, service `farm-tasks`, project `farm-tasks-ngatimoti`, region `australia-southeast1` (Sydney).
- Database: Neon Postgres (project `wandering-pond-24940270`). Migrations in `lib/db/drizzle` run on startup.
- Logins: Clerk.
- Secrets live in Google Secret Manager, never in this repo.

## How changes go live

Pushes run the Cloud Build trigger, which builds with `cloudbuild.yaml`. Only a push to `main` (or a manual `gcloud builds submit`) deploys to Cloud Run; a push to any other branch builds the image as a check and stops there, so work in progress never reaches the live app.

The Clerk publishable key is `_WEB_CLERK_PUBLISHABLE_KEY` in `cloudbuild.yaml` (public by design). The trigger's old `_CLERK_PUBLISHABLE_KEY` setting had lost its leading "p" and is no longer read; it can be deleted from the trigger.

Check a deploy in the Cloud console under Cloud Build > History.

The deploy also creates or updates the Cloud Scheduler job `farm-tasks-keep-warm`. It calls `/api/healthz` every 10 minutes from 6:00 to 18:50 (Pacific/Auckland), so the crew's first tap after a quiet spell does not wait for a cold start. Change the times with the `_KEEP_WARM_SCHEDULE` substitution. If the build account cannot manage Cloud Scheduler, that step is skipped and the deploy still goes ahead.

## Google connection and calendar tasks

- The app reads the farm task sheet, calendars, Drive attachments and Gmail as harnold@hirshberginstitute.com, through an OAuth client in the Google Cloud project `farm-tasks-login` (Hirshberg Workspace). Connect or reconnect at `/api/google/connect`.
- Moving or editing a task that came from Google Calendar (date, time, title, notes, location) updates the calendar event first, so the 30-minute calendar sync keeps the change. This needs the `calendar.events` permission: reconnect once at `/api/google/connect` after it was added. The Hirshberg public calendar feed stays read-only.
