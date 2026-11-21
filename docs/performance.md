# Performance (NFR-PERF-01)

Target on a Raspberry Pi 4: page/API response < 500 ms (p95) with 5 000 invoices, PDF generation
< 3 s for a 3-page invoice, idle memory < 200 MB, peak < 512 MB.

## How it is measured

`node scripts/perf.mjs [baseUrl] [adminPassword]` against a running stack (default: the E2E
compose stack on port 8199). It seeds 5 000 invoices, measures p95 of 40 requests per API call,
renders a 45-position (3-page) draft preview 8 times, and reads container memory from cgroup v2
(`memory.current` when idle, `memory.peak` for the maximum since start).

The app container was limited like a Pi: `docker update --cpus 1 --memory 512m`. Node runs with
`NODE_OPTIONS=--max-old-space-size=160` (set in the Dockerfile).

## Results (2026-11-21, x86-64 host, container limited to 1 CPU / 512 MB)

| Measurement                                     | Result                | Budget              | Margin |
| ----------------------------------------------- | --------------------- | ------------------- | ------ |
| Invoice list, newest 50 (p95)                   | 11–16 ms              | 500 ms              | > 30×  |
| Invoice list, overdue filter (p95)              | 10–11 ms              | 500 ms              | > 40×  |
| Invoice search by customer name (p95)           | 21–22 ms              | 500 ms              | > 20×  |
| Invoice list sorted by amount (p95)             | 10–11 ms              | 500 ms              | > 40×  |
| Dashboard summary (p95)                         | 14–15 ms              | 500 ms              | > 30×  |
| Customer search (p95)                           | 7–8 ms                | 300 ms (FR-CUST-02) | > 35×  |
| PDF, 3 pages / 45 positions                     | 0.2–0.7 s             | 3 s                 | ≥ 4×   |
| Memory idle (fresh start)                       | 78 MiB (RSS 137 MiB)  | 200 MB              |        |
| Memory idle (after 2 full load runs)            | 111 MiB (RSS 170 MiB) | 200 MB              |        |
| Memory peak                                     | 129 MiB               | 512 MB              |        |
| JSON export of all data (5 000+ invoices, 6 MB) | 0.5 s                 | –                   |        |

"Memory" is the container's cgroup usage as Docker and Home Assistant report it; RSS includes the
memory-mapped Node binary.

## What this means for a Raspberry Pi 4

A Pi 4 core is roughly 3–4× slower than the x86 core used here. API calls keep a margin of more
than 20×, so they stay far below 500 ms. The PDF is the tightest value: expected around 1–2.5 s
on a Pi 4 – within the 3 s budget, faster on a Pi 5. Memory does not depend on CPU speed.
Under QEMU emulation (arm64 on x86, M7) the app worked but timings there are not meaningful.

**To confirm on real hardware** (part of the HA acceptance test in `docs/ha-release.md`): run
`node scripts/perf.mjs http://<ha>:8099/ <admin password>` with the direct port enabled – the
script needs the Docker CLI on the same machine for seeding and memory, or measure the PDF time
in the browser's network tab ("Vorschau (PDF)" of a 3-page draft).

## Notes

- A container that has served hours of benchmarks reached RSS ≈ 265 MiB with the earlier
  256 MB heap cap – most of it native memory the allocator keeps; lowering the heap cap to 160 MB
  keeps everyday usage well below 200 MB.
- `--optimize-for-size` cannot be set through `NODE_OPTIONS` (Node refuses to start) – not used.
