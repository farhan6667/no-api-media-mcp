# Lessons from real use

These lessons come from real image work for websites, repositories and social posts: banners, hero art, share cards, illustrations and one short video. Each is a mistake that actually happened and how it was fixed. A short list of the most useful ones is built into `design_brief`, so the same mistake is avoided on the first try. The full list is here for people who want the detail.

Honest limits: the work was done before these MCP tools existed in their current form, mostly with Codex image generation and Google Flow, so the lessons are about the craft and not about the tool names. The counts are small, so read "times seen" as a guide, not as statistics. No poster, infographic or icon work was observed, so there are no lessons for those yet.

## Lessons table

| # | Lesson (imperative) | Why | Asset type | Times seen |
|---|---|---|---|---|
| 1 | Never let the image model draw text, numbers, logos or UI. Generate art with "no text, no letters, no numbers, no logos, no people" and put real text and the real logo on top with HTML or an image library. | Generated text is garbled or invented. The user's stated rule was: real logo composited afterwards. | all | 3 |
| 2 | For hero, banner and social art, ask for a calm, dark, low detail zone (about 40 to 45 percent) on the side where the headline goes, and put the bright detail in the middle horizontal band. | Text stays readable and the central band survives wide crops. Every background made this way passed its first audit. | hero, banner, social | 1 (5 images, all passed round 1) |
| 3 | Put every subject in the centre with a wide margin on all sides, even for a "wide" request. | A crop to a link preview ratio cut the top off a phone in one image. A portrait image used as a share card was cut badly. A centred subject survived both desktop and phone crops in the video. | hero, share card, video | 3 |
| 4 | Build the share card at its real size (1200x630) and fit the whole subject into it. If the source is shorter or narrower, extend the background with a sampled colour instead of cropping the subject. | Link previews crop hard. | social preview | 2 |
| 5 | Make illustrations blend with the page. Ask for a background that matches the page colour, then remove the background (transparent cut-out) before placing it. | The user said the images looked pasted on and the site colour looked different. Boxes of grey or green around art were the main complaint. | hero, illustration | 1 (2 rounds plus a fix) |
| 6 | Match the hero to the rest of the site before adding art: same width, same background tone, same card style, same fade on the edges. | The user said the new hero looked like a different person designed it. A hard edge on a cut-out and a content box narrower than the site were the causes. | hero | 1 (3 rounds) |
| 7 | Audit every generated image like a lead designer before using it: brand colours, stray text, melted shapes, clutter, crop, legibility over the text zone, contrast against the page. Fix and re-render, do not ship the first pass. | The first set of repo art looked flat and not luxurious to the user. After a designer-style audit loop, the second set was accepted. | all | 3 |
| 8 | Zoom into documents, screens and clipboards in generated art. | Documents and screens are where models put fake, unreadable text. The check found none, but it is the right place to look. | illustration | 1 |
| 9 | Give luxury a concrete recipe: deep matte dark base, polished glass or obsidian planes, volumetric light, fine grain, 3 or 4 exact hex colours, one thin warm accent, "restrained, not cartoonish". Avoid bright flat gradients. | "Premium", "luxurious" and "eye catching" were the user's words. Vague words gave flat results, the concrete recipe passed. | hero, banner | 2 |
| 10 | Keep brand colours as exact hex codes in the prompt, and name the one accent colour and where it goes (for example "thin accent light at the lower right"). | Palette drift was the first thing checked in each audit. | all | 3 |
| 11 | For product screenshot cards, capture clean screenshots on a demo machine with sample data. Capture each window over a black and a white backdrop to get exact transparent corners. | Real screenshots from a real machine leak names and addresses, and dark app windows on a dark background lose their edges. | screenshot card | 1 |
| 12 | Render screenshots at 2x or higher, resize with a high quality filter to the final size, and add a small zoom bubble when the text inside is small. | Screenshots looked blurry at 1x, and text in small cards could not be read. | screenshot card | 1 |
| 13 | Give dark screenshots a soft rim light or glass sheen on dark backgrounds. | Dark windows disappeared into dark art. | screenshot card | 1 |
| 14 | Check cards for overlap: headline against the window, window over the best part of the art, window against the right edge, heading wrapping to three lines. | These overlap and crop faults appeared in the first draft and again in the first audit of the second draft. | banner, card | 1 (4 faults, 2 audit rounds) |
| 15 | Draw semi transparent chips on their own layer, not straight onto the image. | Chips written onto the pixels turned into solid white boxes. | banner | 1 |
| 16 | Put a small brand mark in a corner of each image when the user asks for brand consistency, and use the real logo file, never a re-drawn one. Check the logo file for transparency and size first. | The user wanted the real logo placed. | all | 2 |
| 17 | Use real vendor logos from their official source when the logo is the point (certifications, partners). Do not accept a low resolution favicon, a generic silhouette, or a wrong logo. Fall back to a neutral vector icon if there is none. | Favicon-size marks looked cheap, and one wrong logo went unnoticed until QA. | logo | 1 |
| 18 | When a logo sits on a light plate, check white-on-white and dark-on-dark cases, and check hover states. | A white wordmark vanished on a white plate. A decorative line ended up on top of the logos. | logo | 1 |
| 19 | For a photo in an object-fit cover box whose ratio changes with screen size, crop so the subject survives every ratio, or change the box to the photo ratio. | The same photo was cropped badly at some breakpoints. | photo | 1 |
| 20 | If a site needs different art for light and dark themes, make two versions and compare screenshots of both before choosing. Show the user before replacing. | The user asked for per-theme images and wanted to be able to revert. | photo, hero | 1 |
| 21 | After replacing an image file, bust the cache with a version query on the URL, then re-check the natural size in the browser. | The browser and the framework kept serving the old image, so one audit looked at stale art. | all web | 2 |
| 22 | Compress images before they go on the page: WebP, small sizes. Ten illustrations came to about 92 KB in total. Repo art totalled 2.8 MB. | The user cares about load time, and repo pages should be light. | all | 3 |
| 23 | Test the final placement in the real page at wide and zoomed-out sizes, in every language and both text directions, and click everything. Overlap scripts at two widths missed real faults. | The user found empty hero space at a large effective width and a mis-placed button that the scripts had passed. | hero, banner | 2 |
| 24 | Do not use hero art taller than the screen. Cap its height to the viewport. | Art taller than the screen was pushed off the page. | hero | 1 |
| 25 | For a short clip, name the story beats by second in the prompt, plus the palette, "no text, no logos, no people", and a centred subject. Audit by stepping through the clip, not only the first frame. | An 8 second clip passed its first audit this way. Video costs credits, so a retry should be spare. | video | 1 |
| 26 | Remove AI provenance metadata only when the user asks, and say so openly. In one session a platform showed an AI label from embedded provenance data (C2PA), and re-encoding the pixels into a fresh file dropped it. Invisible pixel watermarks are not removed this way. | The user asked to strip metadata before posting. Whether to do this by default is the maintainer's decision. | social post | 1 |
| 27 | Write alt text for every image in a social post, and keep the order the user approved (hero first). | Alt text was added to each of 8 images by hand. | social post | 1 |
| 28 | Fix one problem, then look again. Do not stack five fixes and ship. | The user said to find the bug before fixing it, after a change that did not fix what they pointed at. | all | 2 |

## Provider notes

- Codex CLI image generation (ChatGPT login): best for premium abstract backgrounds, 3D style objects, hero art and share art. About one minute per image. Three images in parallel worked. All five repo backgrounds passed the audit on the first round. Weak spot: it ran out of credits after 2 of 11 images in one session ("workspace is out of credits"), so plan a fallback before a batch.
- Windows detail: the wrapper script stopped on harmless stderr under Windows PowerShell 5.1 and worked under PowerShell 7. Environment specific.
- Google Flow with the Nano Banana image model, in the browser: used as the fallback when Codex ran out. Nine images came out clean at no credit cost, 1:1 for small thumbnails and 16:9 for section art. Weak spots: the download step failed several times (the browser moved or removed the temp file), so start the file watcher first and then click download. Backgrounds came out grey or tinted, so they needed the cut-out step in lesson 5.
- Flow video (Veo 3.1 Fast, 720p, 8 s): cost 20 credits and passed audit first try. One attempt on an account with zero credits stopped, and no money was spent. Direct mode (not the agent panel) shows the model chip and the cost.
- Every file download from a provider needed an explicit yes from the user. Keep that step in the workflow.
- Real vendor logos came from icon libraries and official sites. Favicons were too small.
- HTML to PNG rendering (own scenes with exact text and exact logos) worked better than asking a model for finished compositions. It gave the luxury look with glass, glow and tilt, and exact text.
- Browser caution: a fresh browser profile on every render made the operating system count a failed sign-in each time on one machine. Use one fixed profile or a bundled browser. Environment specific.
- Higgsfield: no use seen. Unverified.

## Workflow order that worked best

1. Read the project: palette, fonts, existing art, where assets live, and the exact slot (file name, size, ratio, where the headline goes).
2. Write the plan as one short list and get a yes before spending credits.
3. Generate art only, with no text and no logo. Use exact hex colours, a calm zone for the headline, and the subject in the centre.
4. Audit each image as a lead designer. Zoom into screens and documents. Regenerate only what fails.
5. If the art has a tinted background, cut it out so it blends with the page.
6. Compose with HTML: real text, real logo, real screenshots, glass and glow effects. Render at 2x and downscale with a good filter.
7. Audit the composed image: overlap, crop, wrapping, contrast, legibility of small text, edge touches.
8. Compress to WebP or an optimised JPG, build the share card at 1200x630, and bust caches.
9. Test in the real page: wide and zoomed-out widths, both text directions, both themes, click every control.
10. Before posting to a social site: alt text, approved order, and a decision on metadata with the user.
