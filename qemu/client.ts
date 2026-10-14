import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Qemu = {
	diskPath: string | undefined;
	proc: ChildProcess | undefined;
	qmp: Socket | undefined;
};

export function assert(value: unknown, message: string): asserts value {
	if (!value) {
		throw new Error(message);
	}
}

export function newQemu(): Qemu {
	return { diskPath: undefined, proc: undefined, qmp: undefined };
}

export async function newDisk(
	vm: Qemu,
	path: string,
	size: string,
): Promise<void> {
	assert(vm.diskPath === undefined, "disk already created");
	await exec("qemu-img", ["create", "-f", "qcow2", path, size]);
	vm.diskPath = path;
}

export async function start(vm: Qemu): Promise<void> {
	assert(vm.diskPath !== undefined, "no disk");
	const socketPath = join(dirname(vm.diskPath), "qmp.sock");
	const proc = spawn(
		"qemu-system-x86_64",
		[
			"-display", "none",
			"-m", "128",
			"-drive", `file=${vm.diskPath},format=qcow2,if=virtio`,
			"-qmp", `unix:${socketPath},server=on,wait=off`,
		],
		{ stdio: "ignore" },
	);
	vm.proc = proc;
	const lifetime = new AbortController();
	let qmp: Socket | undefined;
	const failed = (error: Error) => {
		lifetime.abort(error);
		qmp?.destroy();
	};
	proc.once("error", failed);
	proc.once("exit", (code, signal) => failed(new Error(`QEMU exited: ${code ?? signal}`)));
	try {
		qmp = await connect(socketPath, lifetime.signal);
		vm.qmp = qmp;
		await command(qmp, "qmp_capabilities");
	} catch (error) {
		qmp?.destroy();
		if (proc.pid !== undefined && proc.exitCode === null && proc.signalCode === null) {
			const gone = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
			// This child belongs to the failed start: allow 500ms for SIGTERM,
			// then force termination. Await reaping before exposing the original error.
			const escalation = setTimeout(() => proc.kill("SIGKILL"), 500);
			try {
				proc.kill();
				await gone;
			} finally {
				clearTimeout(escalation);
			}
		}
		vm.proc = undefined;
		vm.qmp = undefined;
		throw error;
	}
}

export async function screendump(vm: Qemu, path: string): Promise<void> {
	assert(vm.qmp, "not started");
	await command(vm.qmp, "screendump", { filename: path });
}

export async function stop(vm: Qemu): Promise<void> {
	assert(vm.proc, "not started");
	const proc = vm.proc;
	vm.qmp?.destroy();
	if (proc.exitCode === null && proc.signalCode === null) {
		const gone = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
		proc.kill();
		await gone;
	}
	vm.proc = undefined;
	vm.qmp = undefined;
}

type QmpMessage = {
	id?: number;
	return?: unknown;
	error?: { desc: string };
};

function connect(path: string, signal: AbortSignal): Promise<Socket> {
	return new Promise((resolve, reject) => {
		let socket: Socket;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const aborted = () => {
			clearTimeout(retry);
			socket?.destroy();
			reject(signal.reason);
		};
		if (signal.aborted) return aborted();
		signal.addEventListener("abort", aborted, { once: true });
		const attempt = () => {
			socket = createConnection(path);
			socket.once("connect", () => {
				signal.removeEventListener("abort", aborted);
				socket.removeAllListeners("error");
				socket.on("error", () => {});
				resolve(socket);
			});
			socket.once("error", () => {
				socket.destroy();
				if (!signal.aborted) retry = setTimeout(attempt, 100);
			});
		};
		attempt();
	});
}

type QmpState = {
	nextId: number;
	pending: Map<number, { resolve: () => void; reject: (error: Error) => void }>;
};

const connections = new WeakMap<Socket, QmpState>();

function command(
	qmp: Socket,
	execute: string,
	args?: Record<string, unknown>,
): Promise<void> {
	if (qmp.destroyed || qmp.readableEnded) {
		return Promise.reject(new Error("QMP connection closed"));
	}
	let state = connections.get(qmp);
	if (!state) {
		state = { nextId: 0, pending: new Map() };
		connections.set(qmp, state);
		const pending = state.pending;
		const fail = (error: Error) => {
			for (const request of pending.values()) request.reject(error);
			pending.clear();
		};
		qmp.on("error", fail);
		qmp.on("end", () => fail(new Error("QMP connection ended")));
		qmp.on("close", () => fail(new Error("QMP connection closed")));
		let buffered = "";
		qmp.setEncoding("utf8");
		qmp.on("data", (chunk: string) => {
			buffered += chunk;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			try {
				for (const line of lines) {
					if (!line.trim()) continue;
					const message = JSON.parse(line) as QmpMessage;
					assert(message !== null && typeof message === "object" && !Array.isArray(message), "Invalid QMP message");
					if (message.id === undefined) continue;
					const request = pending.get(message.id);
					if (!request) continue;
					if (message.error) {
						const error = new Error(message.error.desc);
						pending.delete(message.id);
						request.reject(error);
					} else if ("return" in message) {
						pending.delete(message.id);
						request.resolve();
					}
				}
			} catch (error) {
				fail(error instanceof Error ? error : new Error("Invalid QMP message"));
				qmp.destroy();
			}
		});
	}
	const id = state.nextId++;
	const pending = state.pending;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		qmp.write(`${JSON.stringify({ execute, arguments: args, id })}\n`);
	});
}
