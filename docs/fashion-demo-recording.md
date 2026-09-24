# Captioned fashion demo recording

This opt-in rehearsal records real browser interactions, thirteen locally saved
chapter results, a model-selection round trip, refresh persistence and one new
CPU-only custom-node execution. It does not generate synthetic application UI or
silently install models. Previously generated images are labelled throughout.

Prepare the curated chapters using the backend's fashion-editorial demo guide.
The recording expects their unique titles in My workflows and an explicitly
enabled `custom.FashionEditorialRegions` extension. Use an idle local backend;
the live-run check refuses to submit behind unrelated work.

In PowerShell, from the client checkout:

```powershell
$env:MODIFF_FASHION_RECORD = 'C:\demo\curated\manifest.json'
$env:MODIFF_REVIEW_OUTPUT_DIR = 'C:\demo\recording'
$env:MODIFF_LONG_RUNNING_QUALIFICATION = '1'
npx playwright test tests/e2e/live-backend/fashion-demo-recording.spec.ts --workers=1 --retries=0 --reporter=line
```

`MODIFF_RECORD_SMOKE=1` shortens caption holds and omits the CPU run for a bounded
rehearsal. Unset it for the final capture. Each attempt creates uniquely named
presentation copies; it does not edit the curated originals. It has a 15-minute
deadline and performs no automatic retry.

The test enables 1920×1080 video explicitly, despite long-generation trace/video
defaults. The recording-only caption overlay uses the application's font and
semantic color variables, reserving a bottom strip instead of covering controls.
This stylesheet is never shipped into the application. `captions.json`, an SRT
transcript, chapter screenshots and the actual live task receipt go into the
selected local directory. Playwright attaches the completed WebM under its test
results; copy it out before a subsequent Playwright run cleans that directory.

The SRT times are measured from scenario setup, while the video starts with the
browser page. The visible captions are burned into the browser recording and are
the authoritative timing. If distributing a separately selectable SRT, align its
offset against the first visible caption after any edit or transcode.

Use a locally installed FFmpeg with H.264 support to create an MP4. Keep the
source recording, trim only explicitly explained idle footage, and inspect the
result for readable captions, complete image framing and truthful live/retained
labels. Do not call retained model output a new live Windows qualification.
