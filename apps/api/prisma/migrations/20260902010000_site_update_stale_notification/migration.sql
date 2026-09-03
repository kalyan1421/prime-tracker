-- A unit on the Site Tracker that nobody has posted about for a week.
--
-- STALE_DAYS = 7 existed only inside SiteTrackerService's summary, so the "No update 7d+"
-- tile was the single surface for it: no notification, no exception-feed entry, no cron —
-- unlike vacancy, which has a whole scheduled job. The number the board asks people to act
-- on could only be seen by someone who happened to open the page.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SITE_UPDATE_STALE';
