# Privacy: draft notice and procedure (for Spartan to approve)

**Status: draft, written 19 November 2026 for Spartan to review.** Nothing here has been approved. A public version is on the site at /privacy.html (from 19 November 2026, because Google sign-in needs a privacy page to link to): it says plainly what is still being confirmed and leaves out the bracketed parts. Update both together. Spartan decides who the data controller is, the lawful basis, how long data is kept and who handles requests; the bracketed parts need their answers.

## Draft notice for referees

> **How SpartanReferee uses your information**
>
> SpartanReferee is run for [Spartan Race, Inc. / the Spartan entity to confirm] ("Spartan"), who decides how your information is used (the data controller). Contact: [privacy contact].
>
> **What we keep.** Your name and email address (and profile picture, if any) as your Microsoft or Google account gives them, the region and country an administrator records, and what you do on the learning platform: the programmes you're enrolled in, the lessons you complete, your quick-check and refresher practice (with the weeks you learned and the badges you earned), your assessment answers and results, and the credentials you earn. For the burpee cameras: which events you're assigned to, as head referee or referee, and the bookings you make. Every change an administrator makes is recorded in an audit log.
>
> **Why.** To train and assess referees, to record who is qualified to referee Spartan events, and to run the camera booking for events. [Lawful basis to confirm: e.g. legitimate interests in running a consistent, fair officiating programme, or the agreement under which you referee.]
>
> **Who sees it.** You see your own record. Administrators see everyone's; a regional coordinator sees people in their region; programme owners and assessors see what their programme needs. It is stored in Microsoft Azure in the UK (database and files in UK South; camera servers in Italy North during events).
>
> **How long.** [To confirm: e.g. while you're a Spartan referee, and for N years after, so qualifications can be checked.] Narration audio and camera recordings are kept for 7 days.
>
> **Your rights.** You can download everything the learning platform holds about you from **My profile → Download my data**. To correct something, ask an administrator (you can change your preferred name and language yourself). To have your information erased, or to object or complain, contact [privacy contact]; you can also complain to [the relevant supervisory authority].

## Procedure

**A referee asks for their data (access).** They download it themselves: /learn → My profile → Download my data (a JSON file of everything the learning platform holds). An admin can do the same for them from their profile (Export their data). The camera site's own records (the referee list entry, account and assignments) are listed on the admin page and can be read out to them.

**A referee asks to be erased.**
1. In /learn, as an admin (as yourself, not viewing as someone): their profile → Their data → type ERASE → Erase this person. Their name, email address and country are removed, their sign-in link and roles go, and they're suspended. Their learning records stay, anonymised, so credential numbers and reports stay consistent.
2. On the admin page, remove them from the referee list (and as head referee or referee from any events).
3. Remove their address from older audit entries, which the site itself can't change: `source scripts/learn-env.sh && node scripts/learn-erase.mjs their@address`.
4. Their account record on the camera site (Table Storage `user` and `profile` rows) is removed by [to build: an admin action; for now ask the developer].
5. Nightly backups keep the old data for up to 30 days, then it's gone.

**Records to keep** (Spartan to confirm): each request, the date, who handled it and what was done. The learning platform's audit log records the export and the erasure.

## Still to decide (Spartan)

- The data controller and privacy contact.
- The lawful basis, and the retention period after someone stops refereeing.
- Whether credential numbers stay valid after erasure (today they stay, anonymised).
- A data protection impact assessment, if Spartan's policy calls for one, before using real assessment results for qualifications.
