import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FsWatchEvent } from "./types";
import { FsWatcherManager, type FsWatcherManagerOptions } from "./watch";
import type {
	NativeWatchBackend,
	NativeWatchRequest,
} from "./watch-backend";

interface FakeSubscription {
	request: NativeWatchRequest;
	disposed: boolean;
}

function createFakeBackend() {
	const subscriptions: FakeSubscription[] = [];
	const backend: NativeWatchBackend = {
		name: "fake",
		async subscribe(request) {
			const subscription: FakeSubscription = { request, disposed: false };
			subscriptions.push(subscription);
			return {
				async unsubscribe() {
					subscription.disposed = true;
				},
			};
		},
	};
	return {
		backend,
		subscriptions,
		live: () => subscriptions.filter((s) => !s.disposed),
	};
}

/** Rejects `failures` times, then resolves with `dirs`. */
function flakyListing(failures: number, dirs: string[]) {
	let calls = 0;
	const list = async (): Promise<string[]> => {
		calls += 1;
		if (calls <= failures) {
			throw new Error("git ls-files timed out");
		}
		return dirs;
	};
	return { list, calls: () => calls };
}

const tempRoots: string[] = [];
const managers: FsWatcherManager[] = [];

afterEach(async () => {
	await Promise.all(managers.splice(0).map((m) => m.close()));
	await Promise.all(
		tempRoots
			.splice(0)
			.map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })),
	);
});

async function createTempRoot(): Promise<string> {
	const tempPath = await fs.mkdtemp(
		path.join(os.tmpdir(), "watch-ignored-fallback-"),
	);
	const rootPath = await fs.realpath(tempPath);
	tempRoots.push(rootPath);
	return rootPath;
}

function createManager(options: FsWatcherManagerOptions): FsWatcherManager {
	const manager = new FsWatcherManager({
		debounceMs: 10,
		useDefaultIgnores: false,
		gitIgnoredRetryInitialMs: 20,
		gitIgnoredRetryMaxMs: 40,
		...options,
	});
	managers.push(manager);
	return manager;
}

const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean, label: string) {
	const deadline = Date.now() + 2_000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${label}`);
		}
		await sleep(10);
	}
}

describe("FsWatcherManager gitignored-dir listing failure", () => {
	it("prunes the well-known generated dirs when the listing fails", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(Number.POSITIVE_INFINITY, []);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
		});

		await manager.subscribe({ absolutePath: rootPath }, () => {});

		const ignore = fake.subscriptions[0]?.request.ignore ?? [];
		expect(ignore).toContain("**/node_modules/**");
		expect(ignore).toContain("**/build/**");
		expect(ignore).toContain("**/.gradle/**");
		expect(ignore).toContain("**/dist/**");
	});

	it("leaves generated dirs to git's answer when the listing succeeds", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: async () => ["node_modules"],
		});

		await manager.subscribe({ absolutePath: rootPath }, () => {});

		const ignore = fake.subscriptions[0]?.request.ignore ?? [];
		expect(ignore).toContain("node_modules/**");
		expect(ignore).not.toContain("**/node_modules/**");
		expect(ignore).not.toContain("**/dist/**");
	});

	it("re-attaches with git's list once a failed listing recovers, and tells listeners to refetch", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(2, ["node_modules"]);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
		});
		const events: FsWatchEvent[] = [];

		await manager.subscribe({ absolutePath: rootPath }, (batch) => {
			events.push(...batch.events);
		});
		await waitUntil(
			() =>
				fake.live().length === 1 &&
				fake.live()[0]?.request.ignore.includes("node_modules/**") === true,
			"re-attach with git's list",
		);

		const healed = fake.live()[0]?.request.ignore ?? [];
		expect(healed).not.toContain("**/node_modules/**");
		expect(healed).not.toContain("**/dist/**");
		expect(fake.subscriptions[0]?.disposed).toBe(true);
		expect(
			events.some(
				(event) =>
					event.kind === "overflow" && event.absolutePath === rootPath,
			),
		).toBe(true);
	});

	it("reports provisionally pruned paths as pruned until git answers", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(1, []);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
			gitIgnoredRetryInitialMs: 200,
		});
		const trackedBuildFile = path.join(rootPath, "dist", "vendored.js");

		await manager.subscribe({ absolutePath: rootPath }, () => {});
		expect(manager.isPathPruned(rootPath, trackedBuildFile)).toBe(true);

		await waitUntil(() => fake.subscriptions.length === 2, "heal");
		expect(manager.isPathPruned(rootPath, trackedBuildFile)).toBe(false);
	});

	it("keeps retrying with the fallback in place while the listing keeps failing", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(Number.POSITIVE_INFINITY, []);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
		});

		await manager.subscribe({ absolutePath: rootPath }, () => {});
		await waitUntil(() => listing.calls() >= 4, "retries");

		expect(fake.subscriptions).toHaveLength(1);
		expect(fake.live()[0]?.request.ignore).toContain("**/node_modules/**");
	});

	it("stops retrying once the manager is closed", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(Number.POSITIVE_INFINITY, []);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
		});

		await manager.subscribe({ absolutePath: rootPath }, () => {});
		await manager.close();
		const callsAtClose = listing.calls();
		await sleep(150);

		expect(listing.calls()).toBe(callsAtClose);
	});

	it("does not add the fallback when default ignores are already on", async () => {
		const fake = createFakeBackend();
		const rootPath = await createTempRoot();
		const listing = flakyListing(Number.POSITIVE_INFINITY, []);
		const manager = createManager({
			backend: fake.backend,
			listGitIgnoredDirs: listing.list,
			useDefaultIgnores: true,
		});

		await manager.subscribe({ absolutePath: rootPath }, () => {});

		const ignore = fake.subscriptions[0]?.request.ignore ?? [];
		expect(new Set(ignore).size).toBe(ignore.length);
	});
});
