"""Branded PDF report (vector logo, embedded fonts, vector charts)."""

import io
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ASSETS = Path(__file__).parent / "assets"
for name, file in (("Body", "Figtree-400"), ("Body-Bold", "Figtree-600"), ("Display", "Outfit-600")):
    pdfmetrics.registerFont(TTFont(name, ASSETS / f"{file}.ttf"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body", boldItalic="Body-Bold")

DEEP, NAVY, PALE = colors.HexColor("#254F91"), colors.HexColor("#0B2D6B"), colors.HexColor("#F0FFD7")
EXPOSED, INK, MUTED, RULE = colors.HexColor("#1FA34A"), colors.HexColor("#1B2A41"), colors.HexColor("#5B6B82"), colors.HexColor("#DDE4EC")
SEV = {"mild": "#B7791F", "moderate": "#C2570C", "severe": "#B42318", "unclassified": "#5B6B82", "inconclusive": "#5B6B82"}
LOGO = json.loads((ASSETS / "logo.json").read_text())
W, H = A4
M = 18 * mm
CW = W - 2 * M

_s = lambda name, **kw: ParagraphStyle(name, fontName=kw.pop("fontName", "Body"), textColor=kw.pop("textColor", INK), **kw)  # noqa: E731
TITLE = _s("t", fontName="Display", fontSize=22, leading=27, textColor=DEEP)
H2 = _s("h2", fontName="Display", fontSize=12.5, leading=16, textColor=DEEP, spaceBefore=10, spaceAfter=5)
BODY = _s("b", fontSize=9.2, leading=13.2)
SMALL = _s("s", fontSize=7.8, leading=10.6, textColor=MUTED)
CELL = _s("c", fontSize=8.2, leading=10.6)
CELLH = _s("ch", fontName="Body-Bold", fontSize=7.6, leading=10, textColor=MUTED)
BIG = _s("big", fontName="Display", fontSize=17, leading=20, textColor=NAVY)


def draw_path(c, d: str, x: float, y: float, scale: float, vb, fill) -> None:
    """Draws the absolute M/L/C/Z path data of the traced logo. (x, y) is the bottom-left corner."""
    px = lambda v: x + (v - vb[0]) * scale  # noqa: E731
    py = lambda v: y + (vb[1] + vb[3] - v) * scale  # noqa: E731
    p = c.beginPath()
    for op, args in re.findall(r"([MLCZ])([^MLCZ]*)", d):
        n = [float(v) for v in args.split()]
        if op == "M":
            p.moveTo(px(n[0]), py(n[1]))
        elif op == "L":
            p.lineTo(px(n[0]), py(n[1]))
        elif op == "C":
            p.curveTo(px(n[0]), py(n[1]), px(n[2]), py(n[3]), px(n[4]), py(n[5]))
        else:
            p.close()
    c.setFillColor(fill)
    c.drawPath(p, stroke=0, fill=1, fillMode=0)


class LineChart(Flowable):
    """Time-series chart: one y axis, hairline grid, direct end labels."""

    def __init__(self, t, series, tz, height, unit="", bands=None, zero=False):
        super().__init__()
        self.t, self.series, self.tz, self.height, self.width, self.unit, self.bands, self.zero = t, series, tz, height, CW, unit, bands or [], zero

    def draw(self):
        c, left, right, bottom, top = self.canv, 34, 62, 16, 8
        vals = [v for _, ys, _ in self.series for v in ys if v is not None]
        if not vals:
            return
        lo, hi = min(vals), max(vals)
        if self.zero:
            lo, hi = min(0, lo), max(hi, 5)
        span = (hi - lo) or 1
        step = next(s for s in (0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000) if span / s <= 5)
        lo, hi = (lo // step) * step, -((-hi) // step) * step
        px = lambda i: left + (self.width - left - right) * (self.t[i] - self.t[0]) / max(1, self.t[-1] - self.t[0])  # noqa: E731
        py = lambda v: bottom + (self.height - bottom - top) * (v - lo) / ((hi - lo) or 1)  # noqa: E731
        c.setFont("Body", 7)
        v = lo
        while v <= hi + 1e-9:
            c.setStrokeColor(RULE)
            c.setLineWidth(0.5)
            c.line(left, py(v), self.width - right, py(v))
            c.setFillColor(MUTED)
            c.drawRightString(left - 5, py(v) - 2.4, f"{v:g}")
            v += step
        for label, value in self.bands:
            if lo < value < hi:
                c.setStrokeColor(colors.HexColor("#9AA7B8"))
                c.setLineWidth(0.6)
                c.line(left, py(value), self.width - right, py(value))
                c.setFillColor(MUTED)
                c.drawString(self.width - right + 4, py(value) - 2.4, label)
        days = (self.t[-1] - self.t[0]) / 864e5
        for k in range(6):
            i = round(k * (len(self.t) - 1) / 5)
            when = datetime.fromtimestamp(self.t[i] / 1000, self.tz)
            c.setFillColor(MUTED)
            c.drawCentredString(px(i), 4, when.strftime("%d %b" if days > 2 else "%d %b %H:%M"))
        ends = []
        for name, ys, color in self.series:
            c.setStrokeColor(color)
            c.setLineWidth(1.2)
            c.setLineJoin(1)
            p, pen, last = c.beginPath(), False, None
            for i, y in enumerate(ys):
                if y is None:
                    pen = False
                    continue
                (p.lineTo if pen else p.moveTo)(px(i), py(y))
                pen, last = True, (px(i), py(y))
            c.drawPath(p, stroke=1, fill=0)
            if last and name:
                ends.append([last[1], name, color])
        ends.sort()
        for j in range(1, len(ends)):
            ends[j][0] = max(ends[j][0], ends[j - 1][0] + 9)
        for y, name, color in ends:
            c.setStrokeColor(color)
            c.setLineWidth(1.6)
            c.line(self.width - right + 4, y, self.width - right + 11, y)
            c.setFillColor(INK)
            c.drawString(self.width - right + 14, y - 2.4, name)


def _table(rows, widths, align_right=()):
    body = [[Paragraph(str(x), CELLH if i == 0 else CELL) if not isinstance(x, Flowable) else x for x in r] for i, r in enumerate(rows)]
    for r in body:
        for j in align_right:
            if isinstance(r[j], Paragraph):
                st = ParagraphStyle("r", parent=r[j].style, alignment=2)
                r[j] = Paragraph(r[j].text, st)
    t = Table(body, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [("LINEBELOW", (0, 0), (-1, 0), 0.8, DEEP), ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5), ("LEFTPADDING", (0, 0), (0, -1), 0)]
        )
    )
    return t


def build_pdf(r: dict, created_by: str, created_at: datetime, include: set[str] | None = None) -> bytes:
    include = {"verdicts", "charts", "events", "quality"} if include is None else include
    tz = ZoneInfo(r["station"]["timezone"])
    fmt = lambda d: d.astimezone(tz).strftime("%d %b %Y, %H:%M")  # noqa: E731
    simulated = r["station"]["origin"] == "simulated"
    num = lambda v, unit="", d=1: "–" if v is None else f"{v:.{d}f}{unit}"  # noqa: E731
    pct = lambda v: f"{v * 100:.1f}%"  # noqa: E731

    def page(c, doc):
        c.saveState()
        scale = 34 * mm / LOGO["viewBox"][2]
        for part in ("bird", "word"):
            draw_path(c, LOGO[part], M, H - 19 * mm, scale, LOGO["viewBox"], DEEP)
        c.setFont("Body", 8)
        c.setFillColor(MUTED)
        c.drawRightString(W - M, H - 16 * mm, "Biological monitoring report")
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(M, H - 22 * mm, W - M, H - 22 * mm)
        if simulated:
            c.setFillColor(colors.HexColor("#FFF4DB"))
            c.rect(M, H - 29.5 * mm, CW, 5.8 * mm, stroke=0, fill=1)
            c.setFillColor(colors.HexColor("#7A4B00"))
            c.setFont("Body-Bold", 8)
            c.drawString(M + 3 * mm, H - 27.4 * mm, "SIMULATED DATA. Generated for demonstration; not measured by hardware.")
        c.setFillColor(MUTED)
        c.setFont("Body", 7.6)
        c.drawString(M, 11 * mm, "Listen today. A cleaner tomorrow.")
        c.drawRightString(W - M, 11 * mm, f"{r['station']['code']}   Page {doc.page}")
        c.restoreState()

    story: list = [
        Paragraph(r["station"]["name"], TITLE),
        Paragraph(f"{r['station']['facility']} · {r['station']['code']}", BODY),
        Paragraph(f"{fmt(r['period']['start'])} to {fmt(r['period']['end'])} ({r['station']['timezone']})", BODY),
        Spacer(1, 8),
    ]
    stats = [
        ("Assessments", f"{r['assessments']['total']:,}"), ("Inhibition events", str(len(r["events"]))),
        ("Peak inhibition", num(r["inhibition"]["max"], "%")), ("Data valid", pct(r["performance"]["paired"])),
    ]
    t = Table([[Paragraph(a, SMALL) for a, _ in stats], [Paragraph(b, BIG) for _, b in stats]], colWidths=[CW / 4] * 4)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("TOPPADDING", (0, 0), (-1, 0), 8), ("BOTTOMPADDING", (0, 1), (-1, 1), 10), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("ROUNDEDCORNERS", [6] * 4)]))
    story += [t, Spacer(1, 4)]
    if r["severities"]:
        story.append(Paragraph("Events filtered to: " + ", ".join(r["severities"]) + ".", SMALL))

    s, unit = r["series"], r["protocol"]["activity_unit"]
    if "charts" not in include:
        pass
    elif r["has_data"]:
        ch = s["channels"]
        story += [
            KeepTogether([Paragraph(f"Biological activity ({unit})", H2), LineChart(s["t"], [("Reference", ch["ref_activity"], DEEP), ("Exposed", ch["exp_activity"], EXPOSED)], tz, 118)]),
            KeepTogether([
                Paragraph("Inhibition indicator (%)", H2),
                LineChart(s["t"], [("", ch["inhibition"], NAVY)], tz, 100, bands=[(k.capitalize(), v) for k, v in r["protocol"]["thresholds"].items() if v is not None], zero=True),
                Paragraph(f"{r['protocol']['formula']['expression']}. {r['protocol']['formula']['note']}", SMALL),
            ]),
        ]
    else:
        story.append(Paragraph("No measurements were recorded in this period.", BODY))

    if "events" not in include:
        pass
    elif r["events"]:
        story.append(Paragraph("Inhibition events", H2))
        rows = [["Started", "Severity", "Duration", "Peak", "Associated measurements", "Acknowledged"]]
        for e in r["events"]:
            rows.append([
                fmt(e["started_at"]), f'<font color="{SEV.get(e["severity"], "#1B2A41")}"><b>{e["severity_label"]}</b></font>',
                f"{e['hours']:.1f} h" + ("" if e["ended_at"] else " (open)"), num(e["peak_inhibition"], "%"), ", ".join(e["factors"]) or "None detected", e["acknowledged_by"] or "–",
            ])
        story.append(_table(rows, [CW * w for w in (0.19, 0.2, 0.14, 0.09, 0.22, 0.16)], (2, 3)))
        story.append(Paragraph("Associated measurements changed over the same period. Association does not establish cause.", SMALL))
    else:
        story += [Paragraph("Inhibition events", H2), Paragraph("No events match this period and filter.", BODY)]

    if "verdicts" in include and r["assessments"]["total"]:
        rows = [["Assessment result", "Count", "Share"]]
        for a in r["assessments"]["by_severity"]:
            rows.append([a["label"], a["count"], pct(a["count"] / r["assessments"]["total"])])
        story.append(KeepTogether([Paragraph("AI assessments", H2), _table(rows, [CW * 0.4, CW * 0.15, CW * 0.15], (1, 2))]))

    p = r["performance"]
    if "quality" in include:
        rows = [["Sensor", "Unit", "Min", "Median", "Max", "Coverage", "Invalid", "Missing"]]
        for x in r["sensors"]:
            rows.append([x["name"], x["unit"], num(x["min"], "", 2), num(x["median"], "", 2), num(x["max"], "", 2), pct(x["coverage"]), x["invalid"], x["missing"]])
        story += [Paragraph("Sensor summary", H2), _table(rows, [CW * w for w in (0.3, 0.09, 0.1, 0.11, 0.1, 0.12, 0.09, 0.09)], (2, 3, 4, 5, 6, 7))]
        story.append(KeepTogether([
            Paragraph("Monitoring system performance", H2),
            Paragraph(
                f"The station reported in {pct(p['reporting'])} of {p['expected_intervals']} expected {p['interval_minutes']}-minute intervals, and both chambers had "
                f"valid activity readings in {pct(p['paired'])}. {p['missing']} readings were missing, {p['invalid']} invalid and {p['suspect']} suspect; these are excluded from analysis.", BODY),
        ]))
    story.append(KeepTogether([
        Paragraph("Method and limitations", H2),
        Paragraph(
            f"Protocol: {r['protocol']['name']} v{r['protocol']['version']} ({r['protocol']['validation_status']}). {r['protocol']['validation_reference']}", BODY),
        Spacer(1, 4),
        Paragraph("Assessments support decisions by qualified personnel. They do not establish that wastewater is safe or unsafe, and do not replace laboratory testing or professional environmental assessment.", BODY),
        Spacer(1, 6),
        Paragraph(f"Generated {fmt(created_at)} by {created_by}.", SMALL),
    ]))
    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, title=f"BIOCANARY report {r['station']['code']}", author="BIOCANARY", subject="Simulated data" if simulated else "Biological monitoring")
    top = 34 * mm if simulated else 27 * mm
    doc.addPageTemplates(PageTemplate(frames=[Frame(M, 17 * mm, CW, H - top - 17 * mm, 0, 0, 0, 0)], onPage=page))
    doc.build(story)
    return buf.getvalue()
