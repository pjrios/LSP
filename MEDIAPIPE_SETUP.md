# MediaPipe readiness

The exported site runs MediaPipe locally in the browser. Camera frames and
landmarks are not uploaded by the motion runtime. Only the resulting score and
feedback are sent to Supabase when result persistence is enabled.

## Hosting requirements

- Serve this folder over HTTPS in production. `http://localhost` is acceptable
  for development, but opening the HTML with `file://` is not.
- Allow outbound requests to `cdn.jsdelivr.net` and
  `storage.googleapis.com`, which host the pinned MediaPipe runtime, WASM files,
  and Holistic Landmarker model.
- If a practice uses `media_url` instead of a compiled template, the video host
  must permit cross-origin video use by this site.

## Create a real reference

1. Use a person qualified to approve the LSP demonstration.
2. In the builder, set a motion activity to **Crear referencia** and open its
   preview.
3. Record the complete sign with both hands, head, and shoulders visible. The
   builder embeds the resulting version 2 template automatically. The exported
   reference page also offers `motion-reference.json` as a download.
4. For a data-backed practice, place the complete JSON document in
   `practices.mediapipe_reference`. Do this through the trusted Supabase dashboard
   or a protected teacher/admin backend—not with a service-role key in this
   static frontend.
5. Publish only after the reference contains `"version": 2` and at least four
   objects in `frames`.

Metadata such as `{"status":"ready"}` is not a reference. A usable value has
this structure:

```json
{
  "version": 2,
  "durationMs": 3000,
  "approvedAt": "2026-08-04T00:00:00.000Z",
  "frames": [
    {
      "t": 0,
      "handShape": [],
      "location": [],
      "orientation": [],
      "trajectory": [],
      "facePosture": [],
      "quality": 1
    }
  ]
}
```

The arrays above are illustrative only. Never manufacture or hand-edit their
values; use the reference recorder so MediaPipe produces them consistently.

## Readiness query

Run this read-only query in Supabase to find practices that still need a real
reference:

```sql
select id, title, published
from public.practices
where not (
  mediapipe_reference ->> 'version' = '2'
  and jsonb_typeof(mediapipe_reference -> 'frames') = 'array'
  and jsonb_array_length(mediapipe_reference -> 'frames') >= 4
)
and not (coalesce(media_url, '') ~ '^https?://');
```

After replacing placeholder references, test on the production origin in a
current Chromium, Firefox, or Safari browser and confirm camera permission,
reference loading, comparison, and insertion into `practice_attempts`.
