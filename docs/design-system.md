# Design system

## Logo

The vector in `frontend/src/brand/logoPaths.ts` is traced from `docs/brand/reference.png` (99% overlap with the source). Do not edit, redraw or stretch it. The application runs on a dark night surface, so the logo is solid white there; Deep Blue only on light surfaces such as the device body and PDF reports. SVG files are in `docs/brand`. Replace the trace with the designer's original vector when available.

## Style: bioluminescent

A deep-navy night surface (#04122C) with soft blue and green glows, glowing numbers and chart lines, and quiet translucent glass panels. Navigation is four text tabs in a top bar with a glowing lime underline on the active one; on phones the tabs become a fixed bar at the bottom. Tokens are in `frontend/src/index.css` (`:root`).

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
