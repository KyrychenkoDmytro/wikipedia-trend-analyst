import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import type { AnalysisResult, SeriesResult } from "./types.js";

const COLORS = ["#2b6cb0", "#c0392b", "#27ae60", "#8e44ad", "#d68910", "#16a085"];
const CONFIDENCE_COLORS: Record<string, string> = { low: "#c0392b", moderate: "#b8860b", high: "#1e8449" };

function formatPct(value: number | null): string {
	if (value === null || Number.isNaN(value)) return "n/a";
	const sign = value > 0 ? "+" : "";
	return `${sign}${value.toFixed(1)}%`;
}

function growthColor(value: number | null): string {
	if (value === null || Number.isNaN(value)) return "#888";
	if (value > 0) return "#1e8449";
	if (value < 0) return "#c0392b";
	return "#555";
}

function periodSuffix(granularity: string): string {
	return granularity === "daily" ? "d" : "mo";
}

function unifyDates(results: SeriesResult[]): string[] {
	const set = new Set<string>();
	for (const r of results) for (const p of r.series) set.add(p.date);
	return [...set].sort();
}

/**
 * Draws the trend chart directly with PDFKit's vector primitives - no charting
 * library, no headless browser, no native image bindings. When more than one
 * series is present, values are indexed to the first period = 100 so series
 * with very different raw traffic (e.g. English vs. a smaller-wiki language)
 * can be compared on the same axis; a single series is plotted in raw views.
 */
function drawChart(
	doc: PDFKit.PDFDocument,
	results: SeriesResult[],
	x0: number,
	y0: number,
	width: number,
	height: number,
): void {
	const dates = unifyDates(results);
	if (dates.length < 2) {
		doc.fontSize(9).fillColor("#666").text("Not enough data points to draw a chart.", x0, y0 + height / 2, { lineBreak: false });
		return;
	}

	const indexMode = results.length > 1;
	const seriesValues: { color: string; label: string; values: (number | null)[] }[] = results.map((r, i) => {
		const lookup = new Map(r.series.map((p) => [p.date, p.views]));
		const rawFirst = r.series[0]?.views ?? 0;
		const baseline = rawFirst > 0 ? rawFirst : 1;
		const values = dates.map((d) => {
			const v = lookup.get(d);
			if (v === undefined) return null;
			return indexMode ? (v / baseline) * 100 : v;
		});
		return { color: COLORS[i % COLORS.length]!, label: r.spec.label ?? r.spec.project, values };
	});

	const allValues = seriesValues.flatMap((s) => s.values).filter((v): v is number => v !== null);
	const maxY = Math.max(...allValues, indexMode ? 100 : 1);
	const minY = 0;

	doc.strokeColor("#999").lineWidth(0.5).moveTo(x0, y0).lineTo(x0, y0 + height).lineTo(x0 + width, y0 + height).stroke();

	const yTicks = 4;
	for (let i = 0; i <= yTicks; i++) {
		const value = minY + ((maxY - minY) * i) / yTicks;
		const y = y0 + height - (height * i) / yTicks;
		doc.strokeColor("#eee").moveTo(x0, y).lineTo(x0 + width, y).stroke();
		doc
			.fontSize(7)
			.fillColor("#666")
			.text(Math.round(value).toString(), x0 - 28, y - 3, { width: 24, align: "right", lineBreak: false });
	}

	const xTickCount = Math.min(5, dates.length);
	for (let i = 0; i < xTickCount; i++) {
		const dateIndex = Math.round((i * (dates.length - 1)) / (xTickCount - 1 || 1));
		const x = x0 + (width * dateIndex) / (dates.length - 1 || 1);
		doc
			.fontSize(7)
			.fillColor("#666")
			.text(dates[dateIndex]!, x - 20, y0 + height + 4, { width: 40, align: "center", lineBreak: false });
	}

	for (const s of seriesValues) {
		doc.strokeColor(s.color).lineWidth(1.5);
		let started = false;
		for (let i = 0; i < s.values.length; i++) {
			const v = s.values[i];
			const x = x0 + (width * i) / (dates.length - 1 || 1);
			if (v === null || v === undefined) {
				started = false;
				continue;
			}
			const y = y0 + height - ((v - minY) / (maxY - minY || 1)) * height;
			if (!started) {
				doc.moveTo(x, y);
				started = true;
			} else {
				doc.lineTo(x, y);
			}
		}
		doc.stroke();
	}

	let legendX = x0;
	const legendY = y0 - 14;
	for (const s of seriesValues) {
		doc.rect(legendX, legendY, 8, 8).fill(s.color);
		doc.fontSize(8).fillColor("#333").text(s.label, legendX + 12, legendY - 1, { lineBreak: false });
		legendX += 12 + doc.widthOfString(s.label) + 16;
	}

	if (indexMode) {
		doc
			.fontSize(7)
			.fillColor("#888")
			.text("Indexed: first period in range = 100 (compares growth shape, not raw traffic volume)", x0, y0 + height + 16, {
				lineBreak: false,
			});
	}
}

function buildNextSteps(result: AnalysisResult): string[] {
	const steps: string[] = [];
	const highConfidenceGrowth = result.results.filter(
		(r) => r.trend.confidence !== "low" && (r.trend.growthPerPeriodPct ?? 0) > 0,
	);
	const lowConfidence = result.results.filter((r) => r.trend.confidence === "low");

	if (highConfidenceGrowth.length > 0) {
		const leader = highConfidenceGrowth[0]!;
		steps.push(
			`${leader.spec.label ?? leader.spec.project} shows the clearest sustained growth - a reasonable next step is validating demand there directly (e.g. a landing page or a small ad test) rather than committing based on pageviews alone.`,
		);
	}
	if (lowConfidence.length > 0) {
		steps.push(
			`${lowConfidence.map((r) => r.spec.label ?? r.spec.project).join(", ")} had low-confidence trends - widen the date range or re-check after a few more months before drawing conclusions there.`,
		);
	}
	steps.push(
		"Pageview growth reflects reading interest, not willingness to pay - treat this as a prioritization signal for further validation, not a go/no-go decision on its own.",
	);
	return steps;
}

/**
 * Draws a left-aligned block of text at an explicit position and returns the
 * y coordinate just below it. Every call in this module goes through here (or
 * passes its own explicit x/y) so the text cursor never carries stale state
 * from one section into the next - that was the source of an earlier bug
 * where later sections inherited a leftover x position from the table.
 */
function block(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, fontSize: number, color: string, underline = false): number {
	doc.fontSize(fontSize).fillColor(color).text(text, x, y, { width, underline });
	return doc.y;
}

export async function generateReport(result: AnalysisResult, outPath: string): Promise<void> {
	const doc = new PDFDocument({ size: "A4", margin: 40 });
	const stream = createWriteStream(outPath);
	doc.pipe(stream);

	const left = doc.page.margins.left;
	const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
	let y = doc.page.margins.top;

	y = block(doc, `Wikipedia interest trend: ${result.topic}`, left, y, contentWidth, 18, "#111") + 4;

	const opts = result.results[0]?.options;
	if (opts) {
		y =
			block(
				doc,
				`${opts.start} - ${opts.end}   |   granularity: ${opts.granularity}   |   access: ${opts.access}   |   agent: ${opts.agent}   |   generated ${result.generatedAt}`,
				left,
				y,
				contentWidth,
				9,
				"#555",
			) + 24;
	}

	const chartHeight = 170;
	const chartX = left + 30;
	const chartWidth = contentWidth - 30;
	drawChart(doc, result.results, chartX, y, chartWidth, chartHeight);
	y = y + chartHeight + 40;

	y = block(doc, "Summary", left, y, contentWidth, 11, "#111", true) + 8;

	const granularity = result.results[0]?.options.granularity ?? "monthly";
	const suffix = periodSuffix(granularity);

	const colX = [left, left + 175, left + 245, left + 330, left + 400];
	const colW = [175, 65, 80, 65, 100];
	const headers = ["Series", "History", `Growth/${suffix}`, "Fit (R^2)", "Confidence"];

	doc.font("Helvetica-Bold").fontSize(8).fillColor("#333");
	headers.forEach((h, i) => doc.text(h, colX[i]!, y, { width: colW[i]!, lineBreak: false }));
	doc.font("Helvetica");
	y += 12;
	doc.moveTo(left, y).lineTo(left + contentWidth, y).strokeColor("#999").lineWidth(0.75).stroke();
	y += 6;

	const rowHeight = 18;
	result.results.forEach((r, i) => {
		if (i % 2 === 1) {
			doc.rect(left, y - 3, contentWidth, rowHeight).fill("#f7f7f7");
		}

		const seriesColor = COLORS[i % COLORS.length]!;
		doc.rect(colX[0]!, y + 1, 7, 7).fill(seriesColor);
		doc
			.fontSize(8)
			.fillColor("#222")
			.text(r.spec.label ?? `${r.spec.project} / ${r.spec.article}`, colX[0]! + 12, y, { width: colW[0]! - 12, lineBreak: false });

		doc.fillColor("#333").text(`${r.trend.points} ${suffix}`, colX[1]!, y, { width: colW[1]!, lineBreak: false });

		doc.fillColor(growthColor(r.trend.growthPerPeriodPct)).text(formatPct(r.trend.growthPerPeriodPct), colX[2]!, y, {
			width: colW[2]!,
			lineBreak: false,
		});

		doc.fillColor("#333").text(r.trend.r2 !== null ? r.trend.r2.toFixed(2) : "n/a", colX[3]!, y, { width: colW[3]!, lineBreak: false });

		const confColor = CONFIDENCE_COLORS[r.trend.confidence] ?? "#333";
		doc.font("Helvetica-Bold").fontSize(7.5);
		const badgeWidth = doc.widthOfString(r.trend.confidence) + 14;
		doc.save();
		doc.fillColor(confColor).fillOpacity(0.12).roundedRect(colX[4]!, y - 2, badgeWidth, 14, 6).fill();
		doc.restore();
		doc.fillOpacity(1).fillColor(confColor).text(r.trend.confidence, colX[4]!, y + 1, { width: badgeWidth, align: "center", lineBreak: false });
		doc.font("Helvetica");

		y += rowHeight;
	});
	y += 8;

	y = block(doc, "Assumptions & limitations", left, y, contentWidth, 11, "#111", true) + 4;
	const limitations = [
		"Growth is estimated with a log-linear regression per series - a directional read, not a statistical significance test.",
		"Pageview interest is not the same as willingness to pay, or as demand for a specific product feature.",
		...result.notes,
		...result.results.flatMap((r) => r.trend.confidenceReasons.map((reason) => `${r.spec.label ?? r.spec.project}: ${reason}`)),
	];
	for (const line of limitations) {
		y = block(doc, `\u2022 ${line}`, left, y, contentWidth, 8, "#333") + 2;
	}
	y += 8;

	y = block(doc, "Suggested next steps (auto-generated - verify before acting)", left, y, contentWidth, 11, "#111", true) + 4;
	for (const step of buildNextSteps(result)) {
		y = block(doc, `\u2022 ${step}`, left, y, contentWidth, 8, "#333") + 2;
	}

	doc.end();
	await new Promise<void>((resolve, reject) => {
		stream.on("finish", () => resolve());
		stream.on("error", reject);
	});
}
