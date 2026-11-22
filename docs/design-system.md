# Design system

## Logo

The vector in `frontend/src/brand/logoPaths.ts` is traced from `docs/brand/reference.png` (99% overlap with the source). Do not edit, redraw or stretch it. Deep Blue on light surfaces; solid white on Dark Navy. SVG files are in `docs/brand`. Replace the trace with the designer's original vector when available.

## Colour

| Token | Hex | Use |
|---|---|---|
| `--deep` | #254F91 | Headings, primary buttons, **reference** series |
| `--navy` | #0B2D6B | Sidebar, key figures, inhibition indicator |
| `--electric` | #2F6BFF | Links, focus, supporting measurements |
| `--green` | #4FD96B | Live indicator, gradients |
| `--lime` | #A6F684 | Active navigation icon, ring gradient |
| `--mint` | #83E6A3 | Difference shading, accents |
| `--pale` | #F0FFD7 | Healthy status and summary surfaces |

Three functional additions are not in the brand palette:

- **Exposed series #1FA34A**, a darker step of Vibrant Green. #4FD96B on white has 1.8:1 contrast, too faint for a 2 px line. The pair #254F91 and #1FA34A passes colour-vision and 3:1 contrast checks.
- **Amber** for warning and **red** for critical. They mean status only, never a data series, and always appear with an icon and label.

## Type

Outfit for headings and figures (its single-storey *a* matches the wordmark), Figtree for text. Both are open source and bundled, so the application works without internet access.

## The response disc

The ring and gradient disc from the brand sheet are used as a measurement on the dashboard. The outer circle is reference activity. The disc's **area** is exposed activity on the same scale, so the visible ring is the lost activity.

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
