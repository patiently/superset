import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createChokidarWatchBackend } from "./chokidar-backend";
import type { NativeWatchEvent } from "./types";

const backend = createChokidarWatchBackend({ recreatedDirectorySettleMs: 10 });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function waitFor(check: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function watchRoot(files: string[]) {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "recreate-")));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	for (const file of files) {
		const target = path.join(root, file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, "a");
	}
	const events: NativeWatchEvent[] = [];
	const errors: unknown[] = [];
	const subscription = await backend.subscribe({
		rootPath: root,
		ignore: [],
		generation: 1,
		onEvents: (batch) => events.push(...batch),
		onError: (error) => errors.push(error),
	});
	cleanups.push(() => subscription.unsubscribe());
	return { root, events, errors };
}

const SHAPES = [
	{ shape: "a directory", files: ["x/a.ts"], watched: "x" },
	{ shape: "a nested directory", files: ["x/sub/a.ts"], watched: "x/sub" },
];

for (const { shape, files, watched } of SHAPES) {
	test(`watches ${shape} again after it is removed and recreated`, async () => {
		const { root, events, errors } = await watchRoot(files);
		const dir = path.join(root, watched);
		const created = (target: string) => () =>
			events.some((e) => e.type === "create" && e.path === target);

		rmSync(path.join(root, "x"), { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		await waitFor(created(dir), `recreate ${watched}`);

		// The re-add's crawl can report the first file. The second is written
		// after that, so only a live watch reports it.
		for (const name of ["f.ts", "g.ts"]) {
			const file = path.join(dir, name);
			await writeFile(file, name);
			await waitFor(created(file), `create ${watched}/${name}`);
		}
		expect(errors).toEqual([]);
	});
}
