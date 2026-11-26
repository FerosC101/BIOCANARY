# Design system

## Logo

The vector in `frontend/src/brand/logoPaths.ts` is traced from `docs/brand/reference.png` (99% overlap with the source). Do not edit, redraw or stretch it. The application runs on a dark night surface, so the logo is solid white there; Deep Blue only on light surfaces such as the device body and PDF reports. SVG files are in `docs/brand`. Replace the trace with the designer's original vector when available.

## Style: bioluminescent

A deep-navy night surface (#04122C) with soft blue and green glows, glowing numbers and chart lines, and quiet translucent glass panels. Navigation is five text tabs in a top bar with a glowing lime underline on the active one; on phones the tabs become a fixed bar at the bottom. Tokens are in `frontend/src/index.css` (`:root`).

| Token | Hex | Use |
|---|---|---|
| `--night` | #04122C | Page surface (Dark Navy darkened) |
| `--solid` | #0B1F47 | Popovers, dialogs, menus |
| `--surface` | white 4.5% | Glass panels |
| `--electric` | #2F6BFF | Links, focus, background glow |
| `--green` / `--lime` | #4FD96B / #A6F684 | Live indicator, active tab, primary button gradient |
| `--pale` | #F0FFD7 | Accent text on the night surface |

Series colours (`frontend/src/lib/colors.ts`) are lighter steps of the brand hues so they glow and stay readable on the night surface: reference #8FB6FF, exposed #7CF09A, inhibition #FFB547, supporting measurements #C6B8FF.

## Ranges and the dial

Inhibition is shown on a 270° dial (`components/Dial.tsx`). The protocol's ranges are drawn as faint zones (green, yellow, amber, red) with ticks at the boundaries; the value arc glows in its zone colour and the caption names the range in words ("Moderate range · 25–50%"). Elsewhere the same shape appears small: mini dials on the station cards and a 16 px range arc (`RangeGlyph`) beside severity words in tables and alerts.

- No pills, warning flags or segmented severity bars. Level reads from position on the arc plus a word, never colour alone.
- Ranges appear only when validated thresholds apply. Otherwise the ring is grey and the caption says "Unclassified"; offline stations show a dimmed last-known value.
- Amber and red mean range only, never a data series.

## Wall display

`/wall` (`frontend/src/pages/Wall.tsx`) is a full-screen control-room view for a TV: one tile per station with its dial, range in words, 24 h of both chambers, and a footer with open alerts. It is not a navigation section; the TV button in the top bar opens it, and the ✕ in its header (shown on hover) leaves it. It fits a 1080p screen without scrolling and updates from the same live stream. Offline stations show a dimmed last-known trace and when they last reported; simulated data is tagged in the header.

## Facility (3D monitoring)

The Facility tab (`frontend/src/pages/Facility.tsx`) shows the whole plant in 3D with every station at its place: pins with the range arc and inhibition, unit lamps in the station's status colour, pulsing rings where a station is in a warning or critical state, and live sample and upload flows from reporting units only. Selecting a station (pin, list or the view switch) flies the camera to its unit and shows its dial, chamber readings and links to Dashboard, Monitoring and AI Analysis. The side panel summarises how many stations report, open alerts and the highest inhibition. It shares the scene and pins with the explainer (`components/plant/PlantCanvas.tsx`).

## Plant explainer

`/plant` (`frontend/src/pages/Plant.tsx`, scene in `components/plant/plantScene.ts`) is a full-screen 3D illustration of a treatment plant with a seven-step tour of how BIOCANARY works: inflow, sampling, the two chambers, divergence, analysis, and the alert to the control room. It opens from "See them on the plant" above the Dashboard station cards and from the Facility tab; it is not a navigation section itself.

- The plant is built procedurally in three.js (no model or image files): textures for grass, fields, concrete, asphalt, water ripples, corrugated roofing, steel panels, facades and foliage are drawn on canvases at load (`components/plant/textures.ts`). Lighting is a physical late-afternoon sky with sun shadows and sky reflections. Its layout is illustrative and the page says so.
- Stations are placed by name (influent, equalisation, industrial; live hardware at the control room). Their lamps, pins and sample/upload flows follow live status; an offline unit is dark and sends nothing.
- The analysis step names where analysis actually runs, from the system status; it never shows Huawei Cloud unless that is the verified mode.
- Reduced motion stops flows and bridge rotation and makes camera moves instant. Without WebGL the steps remain as text.

## Type

Outfit for headings and figures (its single-storey *a* matches the wordmark), Figtree for text. Both are open source and bundled, so the application works without internet access.

## Charts

One y axis per chart. Paired chamber charts share a scale, and charts on one page share a hover position. Gaps in data stay gaps. Every series is labelled directly or in a legend, values are available by hover and arrow keys, and Monitoring lists every reading in a table.

## Writing

Plain terms for operators. State what was measured, compared with what. Say "association" for correlations. Never state that water is safe or unsafe.

## 3D device

The sign-in page and the top of Monitoring show the device in 3D (`frontend/src/components/device`, model in `frontend/public/device`, source in `device3d`).

- The three status lamps follow real state: Wireless is lit while readings arrive, Cloud only when Huawei Cloud is verified as connected, Status takes the station status colour. On the sign-in page they are part of the product illustration.
- The model is dimmed when a station is not reporting. Chamber colour never changes with readings, because it does not represent microbial health; the caption says so.
- Simulated stations state that no physical unit is connected.
- With reduced motion the bubbles stop and view changes are immediate. Without WebGL a still image is shown, labelled as not reflecting the station's state.
