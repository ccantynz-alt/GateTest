# 30-second hero demo video — storyboard

> **Goal:** answer "what does GateTest actually look like?" in under 30s.
> **Where it goes:** above the fold on gatetest.ai, the GitHub Marketplace
> listing carousel, the npm package README, the Twitter/X launch post.
> **Production:** can be filmed as a screen recording on any laptop.
> No actor, no voiceover, just clean kinetic on-screen typography.

---

## Format

- **Duration:** 30 seconds, hard cap
- **Aspect:** 16:9, 1920x1080
- **Audio:** none (designed to autoplay muted in browsers — captions baked in)
- **Format:** MP4 (H.264) for web, plus a 1:1 square crop for Twitter
- **File size:** under 8MB so it embeds inline without a CDN

---

## Shot list (each shot ~3 seconds)

### Shot 1 (0–3s): The pain

**Visual:**  Black screen. Text fades in centered:

> **You ship 10 PRs a week.**
> **You have 8 quality tools.**
> **None of them agree.**

**Production:** typewriter animation, white text on dark background, ~24px.

---

### Shot 2 (3–6s): The promise

**Visual:** Cut to a clean monospace terminal-ish screen. One line types out:

```
$ gatetest --suite full
```

Then text appears below:

> **One gate. 90 modules. One decision.**

**Production:** terminal aesthetic, pure CSS terminal block, no fancy editor chrome.

---

### Shot 3 (6–12s): The scan in motion

**Visual:** Real screen recording of `/scan/status` with the live terminal scrolling. Modules tick green one by one. The progress bar fills. Module names visible: syntax → lint → secrets → security → accessibility → performance → aiReview.

**Production:**
1. On your laptop: paste a small public repo URL (e.g. https://github.com/sindresorhus/got) into the new free-preview scanner
2. Hit "Scan free →"
3. Screen-record the 12 seconds it takes
4. Speed up to 6 seconds if needed (1.5–2x playback)

---

### Shot 4 (12–18s): The findings

**Visual:** Cut to the FindingsPanel showing real issues. Severity badges (red error / amber warning) visible. One issue is a real security finding with file path + line number.

**Production:** static screenshot from a real scan, hold for 6 seconds with a subtle fade-in animation per row.

Suggested overlay text (bottom):

> **47 issues found. 23 auto-fixable.**

---

### Shot 5 (18–24s): The fix

**Visual:** Quick cut between:
- The DiffViewer component showing red `-` / green `+` (a real before/after fix)
- A real GitHub PR titled "GateTest: 23 fixes auto-applied" with the green merge button

**Production:** screen-record opening one of the proofs (e.g. the gatetest self-fix PR). Show 3 seconds of the diff, 3 seconds of the PR.

Overlay text (bottom):

> **Pull request opened. Card hold released.**

---

### Shot 6 (24–30s): The CTA

**Visual:** Black screen, text fades in:

> **gatetest.ai**
> **Scan any public repo free.**
> **Pay only when fixes ship.**

**Production:** typewriter animation, then the gatetest.ai URL becomes a pulsing button.

---

## Production tools

Pick whatever's already on your machine:

| Tool | Use |
|---|---|
| **QuickTime Player** (Mac, free) | Screen recording for shots 3, 4, 5 |
| **OBS Studio** (free, all OS) | Same, with finer crop control |
| **Loom** (paid but you may have it) | Quick screen recording with auto-trim |
| **iMovie / DaVinci Resolve** | Cut shots together, add typewriter text overlays |
| **Canva Video** (web, easy) | Drop screen recordings + text overlays without editing software |

---

## Title overlays — exact copy (paste verbatim)

```
SHOT 1:
You ship 10 PRs a week.
You have 8 quality tools.
None of them agree.

SHOT 2:
One gate. 90 modules. One decision.

SHOT 4 OVERLAY:
47 issues found.
23 auto-fixable.

SHOT 5 OVERLAY:
Pull request opened.
Card hold released.

SHOT 6:
gatetest.ai
Scan any public repo free.
Pay only when fixes ship.
```

---

## Where to embed once filmed

Save the rendered MP4 as `website/public/demo.mp4` and add to Hero.tsx:

```tsx
<video
  src="/demo.mp4"
  autoPlay
  muted
  loop
  playsInline
  className="rounded-2xl border border-foreground/15 shadow-2xl"
  poster="/demo-poster.png"
/>
```

(`demo-poster.png` is a still frame from shot 4 — the findings panel —
so the video has something to show before the autoplay kicks in.)

---

## Estimated time

- **Filming:** 30 minutes (just retake screen recordings until the timing feels right)
- **Editing:** 1 hour (cut shots, add text overlays)
- **Export:** 5 minutes (1080p H.264, 8MB target)

If you want a polished version for paid ads later, hire someone on Fiverr ($50-150) and hand them this storyboard verbatim. They'll need ~1 day.
