import path from "node:path";
import picomatch from "picomatch";

const GLOB_MAGIC = /[*?{}()[\]!+@|]/;

/**
 * The directory an `<escaped path>/**` entry prunes, or null for a real glob.
 * The watcher emits one such entry per pruned dir (thousands in a monorepo),
 * so these go into a set instead of being matched glob by glob.
 */
function literalDirOf(entry: string): string | null {
	if (!entry.endsWith("/**")) return null;
	const escaped = entry.slice(0, -3);
	let literal = "";
	for (let index = 0; index < escaped.length; index += 1) {
		const char = escaped[index] as string;
		if (char === "\\") {
			index += 1;
			if (index >= escaped.length) return null;
			literal += escaped[index];
		} else if (GLOB_MAGIC.test(char)) {
			return null;
		} else {
			literal += char;
		}
	}
	return literal === "" ? null : literal;
}

function isUnderDirs(
	posixRelative: string,
	dirs: ReadonlySet<string>,
	isDirectory: boolean | undefined,
): boolean {
	if (dirs.size === 0) return false;
	let slash = posixRelative.indexOf("/");
	while (slash !== -1) {
		if (dirs.has(posixRelative.slice(0, slash))) return true;
		slash = posixRelative.indexOf("/", slash + 1);
	}
	return isDirectory !== false && dirs.has(posixRelative);
}

/**
 * Compiles a root-relative ignore list into a predicate over absolute paths.
 * A directory matches when the ignore list covers its contents, so a caller
 * pruning a traversal never descends into it.
 */
export function createIgnoreMatcher(
	rootPath: string,
	ignore: readonly string[],
): (absolutePath: string, isDirectory: boolean | undefined) => boolean {
	const prunedDirs = new Set<string>();
	const globs: string[] = [];
	for (const entry of ignore) {
		if (!GLOB_MAGIC.test(entry)) continue;
		const literalDir = literalDirOf(entry);
		if (literalDir === null) globs.push(entry);
		else prunedDirs.add(literalDir);
	}
	const literalPaths = ignore
		.filter((entry) => !GLOB_MAGIC.test(entry))
		.map((entry) => path.resolve(rootPath, entry));
	const matchesGlob =
		globs.length > 0 ? picomatch(globs, { dot: true }) : () => false;

	return (absolutePath, isDirectory) => {
		for (const literal of literalPaths) {
			if (
				absolutePath === literal ||
				absolutePath.startsWith(`${literal}${path.sep}`)
			) {
				return true;
			}
		}
		const relative = path.relative(rootPath, absolutePath);
		if (relative === "" || relative.startsWith("..")) {
			return false;
		}
		const posixRelative =
			path.sep === "/" ? relative : relative.split(path.sep).join("/");
		if (isUnderDirs(posixRelative, prunedDirs, isDirectory)) {
			return true;
		}
		if (matchesGlob(posixRelative)) {
			return true;
		}
		return isDirectory !== false && matchesGlob(`${posixRelative}/_`);
	};
}
