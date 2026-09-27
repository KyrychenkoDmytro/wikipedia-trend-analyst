#!/usr/bin/env node
/**
 * A minimal, honest test of the actual requirement: "can a cheap model with
 * tool support use this skill correctly from SKILL.md alone?" - not routed
 * through Claude Code or any other polished agent host, just a plain
 * OpenRouter chat-completions loop with three tools that shell out to the
 * real skill CLI.
 *
 * Usage:
 *   export OPENROUTER_API_KEY=...
 *   npx tsx run-agent.ts "Compare growth of interest in intermittent fasting in pl and cs wikipedia over the last 2 years"
 *
 * Env vars:
 *   MODEL      - OpenRouter model id (default: a free, tool-capable model)
 *   SKILL_DIR  - path to the wikipedia-trend-analyst skill (default: ../wikipedia-trend-analyst)
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// This harness lives inside the skill's own repo now (wikipedia-trend-analyst/harness/),
// so the skill root is just one level up - override with SKILL_DIR if you move this elsewhere.
export const SKILL_DIR = resolve(process.env.SKILL_DIR ?? join(__dirname, ".."));
// openrouter/free is OpenRouter's own router: it auto-selects a currently-live free
// model that supports what the request needs (tool calling, here), so this default
// doesn't rot the way a hardcoded slug does when a specific free model is deprecated.
// Force a specific model instead by setting MODEL, e.g. moonshotai/kimi-k2.6:free.
export const MODEL = process.env.MODEL ?? "openrouter/free";

export function buildSystemPrompt(skillDir: string): string {
	const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf8");
	return [
		'You have exactly three tools available: resolve_title, fetch_pageviews, and analyze. You have no other',
		"tools - no shell, no environment variables, no file access beyond what these three return. Full instructions",
		'for using them ("wikipedia-trend-analyst") are below.',
		"Follow them: choose sensible defaults it lists rather than asking the user unnecessary questions,",
		"and read the JSON each tool call returns (especially `confidence` and `anomalies`) before answering.",
		"Give a short plain-language final answer once you have enough information - never just dump raw JSON at the user.",
		"",
		"----- SKILL.md -----",
		skillMd,
		"----- end SKILL.md -----",
	].join("\n");
}

export const tools = [
	{
		type: "function",
		function: {
			name: "resolve_title",
			description: "Find the exact article title on a given wiki for a rough topic name (run this before analyze whenever you don't already know the exact title).",
			parameters: {
				type: "object",
				properties: {
					project: { type: "string", description: "e.g. pl.wikipedia" },
					query: { type: "string", description: "rough topic name, any language" },
					limit: { type: "number" },
				},
				required: ["project", "query"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "fetch_pageviews",
			description: "Fetch the raw pageview series for a single project/article, with no trend analysis.",
			parameters: {
				type: "object",
				properties: {
					project: { type: "string" },
					article: { type: "string" },
					start: { type: "string", description: "YYYY-MM-DD" },
					end: { type: "string", description: "YYYY-MM-DD" },
					granularity: { type: "string", enum: ["daily", "monthly"] },
				},
				required: ["project", "article", "start", "end"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "analyze",
			description: "Fetch pageviews for one or more project/article series, compute growth + a confidence rating for each, and optionally render a one-page PDF report comparing them.",
			parameters: {
				type: "object",
				properties: {
					series: {
						type: "array",
						items: {
							type: "object",
							properties: {
								project: { type: "string" },
								article: { type: "string" },
								label: { type: "string" },
							},
							required: ["project", "article"],
						},
					},
					start: { type: "string", description: "YYYY-MM-DD" },
					end: { type: "string", description: "YYYY-MM-DD" },
					granularity: { type: "string", enum: ["daily", "monthly"] },
					topic: { type: "string" },
					out: { type: "string", description: "PDF filename, e.g. report.pdf. Only set this if a report was actually requested." },
				},
				required: ["series", "start", "end"],
			},
		},
	},
] as const;

export async function runCli(args: string[], skillDir: string): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync("npx", ["tsx", "scripts/cli.ts", ...args], {
			cwd: skillDir,
			maxBuffer: 10 * 1024 * 1024,
		});
		const out = stdout.trim();
		return out.length > 0 ? out : stderr.trim();
	} catch (err: unknown) {
		// A real CLI failure becomes a tool result the model can see and react to
		// (e.g. re-check a title, widen a date range) instead of crashing the harness.
		const e = err as { stderr?: string; message?: string };
		return `Error: ${e.stderr?.trim() || e.message || String(err)}`;
	}
}

/** Pure helper (unit-testable without spawning anything) for building the `analyze` CLI invocation. */
export function buildAnalyzeCliArgs(args: {
	series: { project: string; article: string; label?: string }[];
	start: string;
	end: string;
	granularity?: string;
	topic?: string;
	out?: string;
}): string[] {
	const cliArgs = ["analyze", "--start", args.start, "--end", args.end];
	for (const s of args.series) {
		cliArgs.push("--series", `${s.project}=${s.article}${s.label ? `|${s.label}` : ""}`);
	}
	if (args.granularity) cliArgs.push("--granularity", args.granularity);
	if (args.topic) cliArgs.push("--topic", args.topic);
	if (args.out) cliArgs.push("--out", args.out);
	return cliArgs;
}

export async function executeTool(name: string, args: any, skillDir: string = SKILL_DIR): Promise<string> {
	switch (name) {
		case "resolve_title":
			return runCli(
				["resolve-title", "--project", args.project, "--query", args.query, ...(args.limit ? ["--limit", String(args.limit)] : [])],
				skillDir,
			);
		case "fetch_pageviews":
			return runCli(
				[
					"fetch",
					"--project", args.project,
					"--article", args.article,
					"--start", args.start,
					"--end", args.end,
					...(args.granularity ? ["--granularity", args.granularity] : []),
				],
				skillDir,
			);
		case "analyze":
			return runCli(buildAnalyzeCliArgs(args), skillDir);
		default:
			return `Error: unknown tool "${name}"`;
	}
}

async function callOpenRouter(messages: unknown[], apiKey: string): Promise<any> {
	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
	});
	if (!res.ok) {
		throw new Error(`OpenRouter request failed (${res.status} ${res.statusText}): ${await res.text()}`);
	}
	return res.json();
}

async function runOneTurn(messages: any[], apiKey: string): Promise<void> {
	const MAX_STEPS = 10;
	for (let step = 0; step < MAX_STEPS; step++) {
		console.log(`--- model step ${step + 1} ---`);
		const data = await callOpenRouter(messages, apiKey);
		// openrouter/free picks a different underlying free model per call if it wants to -
		// surface which one actually answered, since that's often the interesting part.
		if (data.model) console.log(`(answered by: ${data.model})`);
		const message = data.choices[0].message;
		messages.push(message);

		if (!message.tool_calls || message.tool_calls.length === 0) {
			console.log("\n=== ANSWER ===\n");
			console.log(message.content);
			return;
		}

		for (const call of message.tool_calls) {
			const args = JSON.parse(call.function.arguments || "{}");
			console.log(`tool call: ${call.function.name}(${JSON.stringify(args)})`);
			const result = await executeTool(call.function.name, args);
			console.log(`tool result (${result.length} chars): ${result.slice(0, 600)}${result.length > 600 ? "..." : ""}\n`);
			messages.push({ role: "tool", tool_call_id: call.id, content: result });
		}
	}
	console.log("Stopped after max steps without an answer for this turn - inspect the transcript above.");
}

async function main(): Promise<void> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error("Set OPENROUTER_API_KEY first.");
		process.exit(1);
	}

	// Each CLI argument is one user turn, run in order against the SAME conversation -
	// this is what lets you test "asks a follow-up / changes an assumption after the
	// first response" (e.g. a second arg like "actually widen that to 3 years")
	// rather than only ever testing a single question in isolation.
	const userTurns = process.argv.slice(2);
	if (userTurns.length === 0) {
		console.error('Usage: npx tsx run-agent.ts "first question" ["follow-up question" ...]');
		process.exit(1);
	}

	console.log(`Model: ${MODEL}`);
	console.log(`Skill: ${SKILL_DIR}\n`);

	const messages: any[] = [{ role: "system", content: buildSystemPrompt(SKILL_DIR) }];

	for (let i = 0; i < userTurns.length; i++) {
		console.log(`\n########## USER TURN ${i + 1}: ${userTurns[i]} ##########\n`);
		messages.push({ role: "user", content: userTurns[i] });
		await runOneTurn(messages, apiKey);
	}
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
