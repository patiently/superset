import { lstat } from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "chokidar";

const MAX_SETTLE_DELAYS = 10;

// chokidar 4.0.3 keeps the dead `fs.watch` of a directory recreated between
// two reads of its parent. The re-add uses `add()`'s private third argument.
export function rewatchRecreatedDirectories(
	watcher: FSWatcher,
	directories: Set<string>,
	settleMs: number,
) {
	const pending = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let firstQueuedAt = 0;
	let reconciling: Promise<unknown> = Promise.resolve();
	let disposed = false;

	function schedule() {
		const now = Date.now();
		if (timer === undefined) firstQueuedAt = now;
		else if (now - firstQueuedAt >= settleMs * MAX_SETTLE_DELAYS) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			reconciling = reconciling
				.then(reconcile)
				.catch((error) => watcher.emit("error", error));
		}, settleMs);
	}

	async function reconcile() {
		const candidates = [...pending].sort();
		pending.clear();
		const stats = await Promise.all(
			candidates.map((dir) => lstat(dir).catch(() => undefined)),
		);
		if (disposed) return;

		const rewatched: string[] = [];
		for (const [index, dir] of candidates.entries()) {
			if (!stats[index]?.isDirectory()) {
				directories.delete(dir);
				continue;
			}
			if (directories.has(dir)) {
				watcher.unwatch(dir);
			} else if (rewatched.some((parent) => isInside(dir, parent))) {
				continue;
			}
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
		schedule();
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
