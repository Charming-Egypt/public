# Legacy (Firebase + GitHub) workers — NOT used when Supabase is configured

These five Cloudflare Workers ran the site before the move to Supabase. They are kept only so you can roll back
(clear `supabase.url` in `site.config.json`, `npm run build`, redeploy) and so the old data layout stays documented.
Once you are happy on Supabase for a few weeks, delete this folder and the old Workers in Cloudflare.
