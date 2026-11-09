import { afterEach, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chokidarWatchBackend } from "./chokidar-backend";
import type { NativeWatchEvent } from "./types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
		await sleep(25);
	}
}

async function watchRoot(files: string[]) {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "recreate-")));
	cleanups.push(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "x"));
	for (const file of files) {
		const target = path.join(root, "x", file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, "a");
	}
	const events: NativeWatchEvent[] = [];
	const subscription = await chokidarWatchBackend.subscribe({
		rootPath: root,
		ignore: [],
		generation: 1,
		onEvents: (batch) => events.push(...batch),
		onError: () => {},
	});
	cleanups.push(() => subscription.unsubscribe());
	return { root, events };
}

const SHAPES = [
	{ shape: "an empty directory", files: [], writeDir: "." },
	{ shape: "a directory with a file", files: ["a.ts"], writeDir: "." },
	{ shape: "a nested directory", files: ["sub/a.ts"], writeDir: "sub" },
];

for (const { shape, files, writeDir } of SHAPES) {
	test(`watches ${shape} removed and recreated back to back`, async () => {
		const { root, events } = await watchRoot(files);
		const dir = path.join(root, "x");

		rmSync(dir, { recursive: true, force: true });
		mkdirSync(path.join(dir, writeDir), { recursive: true });
		await sleep(300);
		const file = path.join(dir, writeDir, "f.ts");
		await writeFile(file, "f");

		await waitFor(
			() => events.some((e) => e.type === "create" && e.path === file),
			`create ${path.relative(root, file)}`,
		);
	});
}
