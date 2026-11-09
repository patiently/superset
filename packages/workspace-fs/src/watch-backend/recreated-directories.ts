import { lstat } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";

const RECREATED_DIRECTORY_SETTLE_MS = 100;

/**
 * A directory removed and recreated at the same path keeps its dead
 * `fs.watch` when chokidar's re-read of the parent sees the name both before
 * and after. On Node that happens when both changes land in one inotify read.
 * Bun merges the two `rename` events into one (oven-sh/bun#44005), so there
 * it happens for any back-to-back rm and mkdir.
 *
 * A `rename` from a parent that names a directory in `directories` queues it,
 * and chokidar's own `addDir` for it settles it. A queued directory that
 * still exists once events settle is watched again. The inode can't tell a
 * recreated directory apart: ext4 and tmpfs hand the freed one straight back.
 */
export function rewatchRecreatedDirectories(
	watcher: FSWatcher,
	directories: Set<string>,
	settleMs = RECREATED_DIRECTORY_SETTLE_MS,
) {
	const pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	async function reconcile() {
		timer = undefined;
		const candidates = [...pending].sort();
		pending.clear();
		const stats = await Promise.all(
			candidates.map((dir) => lstat(dir).catch(() => undefined)),
		);
		if (disposed) return;

		const rewatched: string[] = [];
		for (const [index, dir] of candidates.entries()) {
			if (!stats[index]?.isDirectory()) continue;
			if (directories.has(dir)) {
				watcher.unwatch(dir);
			} else if (rewatched.some((parent) => isInside(dir, parent))) {
				// A re-added ancestor's crawl already covers a dropped directory.
				continue;
			}
			// `_internal` reports the directory and its entries as new, the way
			// chokidar reports a directory created after `ready`.
			watcher.add(dir, undefined, true);
			rewatched.push(dir);
		}
	}

	watcher.on("raw", (event, filename, details) => {
		if (event !== "rename" || !filename) return;
		const { watchedPath } = details as { watchedPath?: string };
		if (!watchedPath) return;
		const candidate = path.join(watchedPath, filename);
		if (!directories.has(candidate)) return;
		pending.add(candidate);
		clearTimeout(timer);
		timer = setTimeout(reconcile, settleMs);
	});
	watcher.on("addDir", (dir) => pending.delete(dir));
	watcher.on("unlinkDir", (dir) => directories.delete(dir));

	return () => {
		disposed = true;
		clearTimeout(timer);
	};
}

function isInside(child: string, parent: string): boolean {
	return child.startsWith(`${parent}${path.sep}`);
}
