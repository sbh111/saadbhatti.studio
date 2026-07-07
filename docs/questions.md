# Clarifying Questions — saadbhatti.studio
#### Answer these at your own pace, inline under each question. Once you've filled them in I'll fold the answers into the refined plan, then start the Figma design. No wrong answers — "not sure, you decide" is a perfectly good response for any of these.

---

## Q1. Content inventory (how much, right now?)
Roughly how many collections and images will exist at launch, per medium? A ballpark is fine (e.g. "photography: 4 collections, ~15 photos each; oil: 2 collections, ~6 paintings each"). This drives layout density, whether long collections need pagination, and how the sidebar tree behaves when fully expanded.

**Answer: 
Initially, 1 photography collection, with 10 pictures. 0 Oil Painting collections. However, I would still like an Oil Painting ArtMedium tab; and on empty the Main View Area should say "Work in Progress, Stay Tuned...". This could be a WIPView and could be used as a placeholder view for parts of the site that are a work in progress.**

---

## Q2. Sidebar width + mobile behavior
(a) The draft says the sidebar is 1/8 of the screen (~180px on a laptop) — tight for a bold full name plus a nested tree. Keep 1/8 exactly, or allow it to grow to ~1/6 (~220px) for breathing room? 
(b) On phones a fixed side column doesn't work. OK to collapse it into a hamburger menu that slides in on mobile/tablet, keeping the always-visible sidebar for desktop only?

**Answer for (a): Yeah lets say the default is 1/6. I'll see the figma design then make the final decision on the sidebar width.**

**Answer for (b): Yes the hamburger menu idea for mobile sounds good.**


---

## Q3. Image hosting
Do you already have a Cloudinary, S3, or other account — or should I plan around a specific one? (Cloudinary is my recommendation: it auto-resizes/compresses via the image URL, which S3 alone doesn't.) If you have an account, which one?

**Answer: Yes i'm leaning cloudinary. I just made an account for it as well.**


---

## Q4. How will you add/update content later?
When you finish a new collection, how do you want to add it? 
(a) Drop images in a folder + edit a simple JSON list (most control, a little technical), 
(b) A lightweight CMS dashboard (e.g. Sanity/Contentful — nicer UI, more setup), or 
(c) Just hand new images to me/Fable each time and we update it.

**Answer: Could the site pull images from cloudinary? it seems like it has options for organization. is that a bad idea? How do sites normally setup the displaying of images onto a site? i'm not too familiar.**


---

### Q5. Font choice
### Calibri can't be legally served on the web for most visitors. Pick a direction:
  (a) **Inter** (modern, neutral, very close in feel to Calibri) — my recommendation,
  (b) A different specific web font you have in mind,
  (c) You decide, Claude.

**Answer: direction (a), lets go inter for now.**


---

## Q6. Look & feel / palette
What mood are you after? E.g.:
  (a) Bright white gallery (light background, black text),
  (b) Dark / near-black gallery (images glow against dark),
  (c) Warm off-white / paper,
  (d) You decide.
Any sites whose look you admire? (links or names help a lot for the Figma stage).

**Answer: option (c).**


---

## Q7. Artwork labels & collection covers
(a) For each artwork, what should show alongside the image — just the name, or also year / medium / dimensions / a short caption? And where — overlaid on the image, below it, or on hover?
(b) Should a collection's cover default to its first artwork, or do you want to pick the cover per collection?

**Answer for (a): lets show: name, relevant data (because a painting has different relevant data than an image, I may need to update the models to reflect this). lets show it immediately below the image.
Relevant Data Example: For a painting the relevant data could be: (Medium: Oil on Canvas - Dimensions: 24x36in - Year: 2026); and for a photograph can be: (Film: Portra 400)
.**


---

## Q8. Protecting your originals
These are hi-res works. Do you want any basic protection — serving capped-resolution display copies (not the full original), an optional subtle watermark, and/or disabling right-click-save? Or leave images fully open?

**Answer: Lets cap the resolution. I don't think I can upload the tif files anyway, they are too big.
.**


---

## Q9. Domain & hosting
Do you already own **saadbhatti.studio**, and is it registered/pointed anywhere yet? Any preference on where it's hosted (I'd suggest Vercel or Netlify — free tier, simple), or should I decide?

**Answer: Yes I already own saadbhatti.studio. It is registered on porkbun.com I prefer hosting on vercel.
.**


---

## Q10. Ready-to-use content
Which of these do you already have on hand, and which should we placeholder for now?
  - The landing hero photo (you holding a brush / with a piece)
  - The About-me bio text
  - Contact details (email — and any Instagram / other socials to link?)
  - Final collection and artwork names

**Answer: I have the landing hero photo. The about me can be a place holder. For contact, i have an instagram ready. It's "instagram.com/sbhphotographyaccount/"; Lets just put that up there while i setup a business email. I have a photography collection ready, it's on my local drive. 
.**


---

## Some additional thoughs and ideas:
**Here are some thoughts i had while answering these: I was thinking to have an admin mode, which you access via username and password in the URL. However, I am not sure what admin features to add currently. I'm sure other portfolio sites have this feature, waht do they incorporate. What would we need to manage the auth as well? Vault? Auth0? 
.**

---
---

# Round 2 — Follow-up Questions (Q11–Q20)

Your answers were great and settled most of the plan. These follow-ups chase down the few
new threads you opened (Cloudinary-as-source, per-medium metadata, resolution cap, the WIP
placeholder, and the admin/auth idea). Same rules — answer inline, "you decide" is fine.

---

## Q11. Where does the content "live" — Cloudinary directly, or a manifest? (answers your Q4)
You asked: *"Could the site pull images from Cloudinary directly? How do sites normally do
this?"* Good instinct — here's how it's normally done, and the real tradeoff:

- **Pattern A — Cloudinary is the source of truth.** You organize images into folders in
  Cloudinary (e.g. `photography/street-2026/`), and the site asks Cloudinary's API for
  "everything in this folder" at build time. Adding a photo = upload to the folder, redeploy.
  *Pro:* one place to manage, no separate list to maintain. *Con:* Cloudinary folders don't
  cleanly store per-image details like a caption or "Film: Portra 400", and ordering is
  awkward — you'd lean on filenames or Cloudinary "tags"/"context metadata."
- **Pattern B — a small manifest file (JSON) is the source of truth.** Images live in
  Cloudinary, but a `content.json` in the project lists collections, artwork order, names,
  and the per-medium metadata. Adding a photo = upload to Cloudinary + add a few lines to the
  JSON. *Pro:* full control over labels, order, and the different metadata fields per medium.
  *Con:* two steps instead of one.

My recommendation: **Pattern B** for Phase 0 — it's the only clean way to support the
per-medium metadata you described in Q7, and it's still simple at your scale (10 photos). We
can layer an admin panel on top later (see Q16) so you're not hand-editing JSON forever.
Which pattern do you want — or should I go with B?

**Answer: Oh ok, then lets do Pattern B
.**


---

## Q12. Cloudinary organization
Whichever pattern we pick, I need to know how you want things named/foldered so it stays tidy
as it grows.
(a) What's your Cloudinary **cloud name** (the identifier in your account — it appears in
image URLs; not a secret)?
(b) OK to use a folder convention like `saadbhatti/<medium>/<collection>/` (e.g.
`saadbhatti/photography/street-2026/`)?
(c) What's the name of your first (ready) photography collection?

**Answer to (a): I believ it's jelgaehs
.**
**Answer to (b): the convention is: `/<medium>/<collection>/` i believe
.**
**Answer to (c): "pakistan2023"**


---

## Q13. Exact metadata fields per medium (firms up your Q7)
You want different "relevant data" per medium, shown below each image. Confirm the field sets
so I can build the models and the Figma label layout:
- **Photograph:** name + { Film, ... }? Anything else — Location, Year, Camera/Lens?
- **Painting:** name + { Medium, Dimensions, Year }? Anything else — Availability (e.g.
  "Sold" / "Private collection")?
Give me the final list per medium, and I'll make them optional so blanks just don't render.

**Answer:\
for paintings: name + {Medium, Dimensions, Year}; Availibility and Price can come later when we implement purhcasing features. Unless it's better to implement now and leave blank.\
for photos: name + {film}. and that's it.\
What about implementing these fields programmatically? An ArtWork class can have the name field, and it's subClasses can have specific fields. There can be a Photograph class that implements a ArtWork class, and it has an additional 'film' field.
.**


---

## Q14. Display resolution cap (firms up your Q8)
You want to cap resolution (and TIFs are too big to upload anyway — correct, Cloudinary takes
JPG/PNG/WebP, not TIF). What's the largest a single image should ever display?
  (a) **Long edge 2048px** — crisp on laptops, safe default,
  (b) **Long edge 2560–3200px** — sharper on large 4K/5K monitors, bigger files,
  (c) You decide.
(Cloudinary generates these display copies automatically; your originals stay on your drive.)

**Answer: option (a).**


---

## Q15. WIPView — scope of the placeholder
I like the reusable "Work in Progress, Stay Tuned…" view. Confirming how far it reaches:
(a) The **oil paintings** tab still appears in the sidebar, is clickable, and its main area
shows the WIPView (no collections listed under it). Correct?
(b) Should WIPView be reused anywhere else at launch — e.g. the About page if the bio isn't
ready, or "buy a print" stubs — or only oil paintings for now?

**Answer for (a): correct
.**
**Answer for (b): correct
.**

---

## Q16. Admin mode — build it now, or Phase 1? (answers your admin thought)
For context, portfolio-site admin panels typically do: upload/replace images, create and
reorder collections, edit titles/metadata, and reorder artwork within a collection — i.e.
they're a friendly UI over the same content the site reads (the manifest in Q11).

Honest recommendation: **defer admin to Phase 1.** For a launch with 1 collection of 10
photos, an admin panel is a lot of scaffolding (auth, a database or write-back to the
manifest, protected routes) for something you'll touch rarely. For Phase 0, updates via the
manifest are quick and I can help each time. Do you want to **(a) defer admin to Phase 1**, or
**(b) include a basic admin panel in Phase 0** anyway?

**Answer: (a).**


---

## Q17. If we do build admin — which features matter to you?
Only if you leaned toward including it. Rank/pick what you'd actually use:
  - Upload/replace images
  - Create & reorder collections
  - Edit artwork names + metadata
  - Reorder artworks within a collection
  - Toggle a collection/medium between "published" and "WIP"

**Answer: all of the above. In addition, I want an order log View as well. A view that displays a table of orders and their status, time submitted and some other relevant fields. We'll discuss it when we implement phase 1.
.**


---

## Q18. Auth approach + a security note on the URL idea
Heads-up on *"access admin via username and password in the URL"* — putting credentials in
the URL is insecure (URLs get logged, cached, and saved in browser history), so I'd steer us
away from that specific approach. Better options if we do admin:
  - **Vercel password protection** — simplest; one shared password gate on the admin route,
    zero code. Good if it's just you.
  - **Clerk / Auth0** — full login systems with a real username/password UI. More setup than
    you need for a solo admin, but robust. (Vault is for *server secrets*, not user login, so
    it's not the right tool here.)
  - **A single admin secret** stored as an environment variable in Vercel (never in the URL).
Given it's just you, I'd suggest **Vercel password protection** if/when we add admin. Which
direction do you prefer — or defer this along with Q16?

**Answer: I like the vercel password protection, but lets defer it to phase 1.**


---

## Q19. About page & bio seed
You said the About text can be a placeholder for now.
(a) Should the About page reuse the landing hero photo, or do you have a separate headshot in
mind (or a placeholder for now)?
(b) Even for a placeholder, a few true details help it read real — want to give me 2–3
bullets (where you're based, what you shoot/paint, how long you've been at it) to seed it?

**Answer for (a): I have a seperate headshot.**
**Answer for (b): \
- I'm Saad Bhatti, a Software Engineer by trade, but a creative at heart.\
- I've been shooting film or a few years on my film cameras, and have expanded my creative endeavors to oil painting.
.**

---

## Q20. Site polish — the small stuff that makes it feel finished
Quick calls so I can include them in the design/build:
(a) **Favicon / browser-tab icon** — do you have a mark/logo, use your initials "SB", or skip
for now?
(b) **Browser tab title & social-share preview** — OK to use "Saad Bhatti — Studio" and the
hero image for link previews (e.g. when the site is shared on Instagram/iMessage)?
(c) **Analytics** — want simple, privacy-friendly visitor stats (Vercel Analytics, one
click), or none for now?

**Answer for (a): skip, i'll make a logo later**
**Answer for (b): for the title let's do: Saad Bhatti's Studio. and sure the hero image previews.**
**Answer for (c): yes i want analytics**
