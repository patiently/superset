import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_IGNORE_DIR_NAMES } from "@superset/workspace-fs/host";

const execFileAsync = promisify(execFile);

// Bounds for a pathological repo (thousands of ignored entries): the caller
// turns each dir into a per-event glob/prefix check, so an unbounded list
// would trade watcher churn for matcher churn. Past the cap, the dirs most
// likely to be huge (node_modules, build output) are kept first.
const MAX_IGNORED_DIRS = 200;
const TIMEOUT_MS = 3_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const rootsWarnedOverCap = new Set<string>();

/**
 * Worktree-relative directories that git ignores entirely, straight from
 * `git ls-files --others --ignored --exclude-standard --directory`. Asking
 * git (instead of parsing .gitignore) keeps the answer authoritative across
 * nested .gitignore files, `.git/info/exclude`, and the global excludesfile.
 *
 * Only collapsed `dir/` entries are returned: `--directory` collapses a
 * directory to one entry only when nothing inside it is tracked, so pruning
 * these subtrees can never hide a tracked file's changes. Individual ignored
 * files (e.g. `.env`) are deliberately excluded — files stay watched so an
 * open gitignored file still live-reloads.
 *
 * Returns [] when the root is not a git worktree or does not exist. Every
 * other failure (a timeout under attach load, a corrupt index) rejects, so
 * callers can tell "git ignores nothing here" from "git did not answer".
 */
export async function listGitIgnoredDirs(rootPath: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			[
				"-C",
				rootPath,
				"ls-files",
				"--others",
				"--ignored",
				"--exclude-standard",
				"--directory",
				"-z",
			],
			{
				timeout: TIMEOUT_MS,
				maxBuffer: MAX_BUFFER_BYTES,
				// isNotAWorktree matches git's untranslated messages.
				env: { ...process.env, LC_ALL: "C" },
			},
		);
		const dirs: string[] = [];
		for (const entry of stdout.split("\0")) {
			if (entry.endsWith("/")) dirs.push(entry.slice(0, -1));
		}
		if (dirs.length <= MAX_IGNORED_DIRS) {
			return dirs;
		}
		if (!rootsWarnedOverCap.has(rootPath)) {
			rootsWarnedOverCap.add(rootPath);
			console.warn("[ignored-dirs] more ignored dirs than the cap", {
				rootPath,
				found: dirs.length,
				kept: MAX_IGNORED_DIRS,
			});
		}
		return mostPrunableFirst(dirs).slice(0, MAX_IGNORED_DIRS);
	} catch (error) {
		if (isNotAWorktree(error)) {
			return [];
		}
		throw error;
	}
}

function mostPrunableFirst(dirs: string[]): string[] {
	const rank = (dir: string) => {
		const segments = dir.split("/");
		const generated = DEFAULT_IGNORE_DIR_NAMES.has(segments.at(-1) ?? "");
		return { generated, depth: segments.length };
	};
	return dirs
		.map((dir) => ({ dir, ...rank(dir) }))
		.sort(
			(a, b) => Number(b.generated) - Number(a.generated) || a.depth - b.depth,
		)
		.map(({ dir }) => dir);
}

function isNotAWorktree(error: unknown): boolean {
	const stderr = String((error as { stderr?: unknown } | null)?.stderr ?? "");
	return (
		stderr.includes("not a git repository") ||
		stderr.includes("cannot change to")
	);
}
