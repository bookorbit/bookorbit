# Read-Aloud EPUB Generation

BookOrbit can combine a plain EPUB with one or more audiobook files and produce an EPUB 3 Media Overlays edition. Generation uses STAlign from `@storyteller-platform/align` with the QuartzNet15x5 CTC model.

The API server does not run machine learning work in its own process. It stores and authorizes jobs, validates sources and output, and publishes the generated EPUB. A separate worker performs audio preparation, QuartzNet inference, text alignment, and EPUB generation.

## Supported languages

QuartzNet15x5 models are available for Arabic, Armenian, Catalan, Chinese, English, Faroese, French, German, Icelandic, Italian, Japanese, Kazakh, Maltese, Polish, Portuguese, Russian, and Spanish.

BookOrbit does not silently switch to a different speech model. A user must select one of these languages before starting a job.

## How the worker runs a job

The worker is two kinds of process:

- A small control process answers BookOrbit over HTTP: health, starting a job, status, and cancellation. It runs one job at a time and never runs pipeline code, so it keeps answering while a job works.
- Each job runs in its own child process, which works through the stages in order: preparing audio, downloading the speech model (only the first time a language is used), generating emissions, marking up the EPUB, aligning, and validating the output.

Cancelling a job stops it at the next safe point. If it has not stopped after 30 seconds, the worker kills it. A job whose process exits unexpectedly is reported as crashed, and the worker stays up for the next job.

### Resuming

Each finished stage leaves a marker in the job's folder that records the inputs it used: the source files with their sizes and modification times, the language, the highlighting granularity, the model, and for alignment the chapter decisions. When BookOrbit retries a job, or resubmits it after the worker restarts, every stage whose inputs are unchanged is reused instead of run again. Emissions are also cached per track, so a run interrupted halfway through inference resumes with the tracks it already finished. Changing which chapters are included reruns only the alignment.

A job's folder is removed by BookOrbit when the job is published, cancelled or discarded, and kept for a while after a failure so a retry resumes.

## Docker deployment

Read-aloud generation is opt-in. Add the following values to the deployment `.env`:

```dotenv
COMPOSE_PROFILES=read-aloud
READ_ALOUD_WORKER_URL=http://read-aloud-worker:8787
READ_ALOUD_WORKER_TOKEN=<a-random-secret-of-at-least-16-characters>
READ_ALOUD_WORKER_IMAGE=ghcr.io/bookorbit/bookorbit-read-aloud-worker:latest
```

Generate the shared token with `openssl rand -hex 32`. The worker port is exposed only to the Compose network. The app and worker must use the same token.

To keep the token out of `.env`, set `READ_ALOUD_WORKER_TOKEN_FILE` to the path of a file that holds it, instead of `READ_ALOUD_WORKER_TOKEN`; setting both stops the containers at startup. Compose passes the same path to the app and the worker, and each reads the file when it starts, so the file must be mounted into both containers at that path and be readable by `PUID`. A container that cannot read the file refuses to start. For example, in a Compose override:

```yaml
services:
  app:
    volumes:
      - ./secrets/read-aloud-worker-token:/run/secrets/read-aloud-worker-token:ro
  read-aloud-worker:
    volumes:
      - ./secrets/read-aloud-worker-token:/run/secrets/read-aloud-worker-token:ro
```

```dotenv
READ_ALOUD_WORKER_TOKEN_FILE=/run/secrets/read-aloud-worker-token
```

The file holds only the token; a trailing newline is fine.

Then start or update the deployment normally:

```bash
docker compose up -d --wait
```

The worker image runs on the CPU. It mounts two folders:

- The book library, read-only, at `/books`.
- `data/app/read-aloud`, at `/data/read-aloud`. This holds job folders (`jobs/`), the speech model cache (`ghost-story/models/`), and temporary files (`tmp/read-aloud-worker/`, emptied when the worker starts). The worker cannot see the rest of BookOrbit's data folder.

The first job for each language downloads its model, about 190 MB for English, from Storyteller's model registry. Every file is checked against the registry before the model is used, and an interrupted download resumes on the next job instead of leaving a broken model behind. The worker therefore needs outbound HTTPS access the first time a language is used. Keep `data/app/read-aloud` persistent so the model is downloaded only once.

### Libraries in other folders

The worker reads books from the folders listed in `READ_ALOUD_LIBRARY_ROOTS` (comma-separated, default `/books`) and reports the ones it can read to BookOrbit. A book whose files are outside every readable folder shows that reason before a job starts instead of failing later.

A listed folder the worker cannot read, such as a network mount that is not up yet, is logged and left out. The worker checks it again on later health checks and before each job, so it is picked up once it becomes readable, without a restart.

If BookOrbit has libraries mounted somewhere other than `/books`, give the worker the same mounts at the same paths, read-only, in a Compose override, and list them:

```yaml
services:
  read-aloud-worker:
    volumes:
      - /srv/audiobooks:/audiobooks:ro
```

```dotenv
READ_ALOUD_LIBRARY_ROOTS=/books,/audiobooks
```

## Native worker

Run the worker natively to use an Apple Silicon GPU through MLX, or a native Linux NVIDIA setup. Docker Desktop on macOS runs Linux containers and cannot reach the Mac's GPU.

Prerequisites: Node.js 24 or later, pnpm, and `ffmpeg` with `ffprobe` version 7 or newer on the `PATH` (on macOS, `brew install ffmpeg`). Older releases such as the 5.1 in Debian 12 reject an option STAlign passes to `ffprobe`, and every job then fails while preparing audio.

Install the monorepo dependencies, then build the shared types and the worker:

```bash
pnpm install
pnpm --filter @bookorbit/types build
pnpm --filter @bookorbit/read-aloud-worker build
```

The worker must see book files at the same paths the BookOrbit server uses, and its job folder must be the server's `<APP_DATA_PATH>/read-aloud/jobs`:

```bash
READ_ALOUD_WORKER_TOKEN=<shared-token> \
READ_ALOUD_LIBRARY_ROOTS=/path/to/library \
READ_ALOUD_WORK_ROOT=/path/to/app-data/read-aloud/jobs \
pnpm --filter @bookorbit/read-aloud-worker start
```

`READ_ALOUD_LIBRARY_ROOTS` takes a comma-separated list. For a single folder, `READ_ALOUD_LIBRARY_ROOT=/path/to/library` works too; when both are set, `READ_ALOUD_LIBRARY_ROOTS` is used.

Configure the server with:

```dotenv
READ_ALOUD_WORKER_URL=http://127.0.0.1:8787
READ_ALOUD_WORKER_TOKEN=<shared-token>
```

A native worker listens on `127.0.0.1` only. To reach it from another machine or from a container, set `READ_ALOUD_WORKER_HOST=0.0.0.0` (or a specific address) and keep the port off untrusted networks; the token is the only protection. `PORT` changes the port from 8787.

Temporary files go to a `read-aloud-worker` folder inside `READ_ALOUD_TMP_DIR` (by default a `tmp` folder beside the job folder). The worker empties only that folder when it starts, so a shared folder such as `/tmp` is safe to use. On macOS the speech models are cached in `~/Library/Application Support/ghost-story/models`.

## Hardware acceleration

`READ_ALOUD_CTC_DEVICE` controls where QuartzNet runs:

| Value    | Runtime                                                                   |
| -------- | ------------------------------------------------------------------------- |
| `auto`   | MLX on native macOS with Apple Silicon, otherwise CPU                     |
| `cpu`    | Everywhere; the only option in the Docker image                           |
| `mlx`    | Native macOS on Apple Silicon, through Metal                              |
| `cuda`   | Native Linux x64 with CUDA 12 and cuDNN 9 installed; never chosen by auto |
| `webgpu` | Experimental; native worker with a GPU, not available on Linux arm64      |

An explicit setting that cannot run on the host stops the worker at startup instead of silently falling back to the CPU. With `cuda` or `webgpu`, the worker also opens a tiny bundled model on that device at startup and refuses to start, with the reason in its log, if ONNX Runtime cannot use it. The Docker image includes neither CUDA nor a GPU driver for WebGPU, so both stop it at startup.

Optional tuning values are `READ_ALOUD_CTC_DTYPE=fp16|fp32` and `READ_ALOUD_CTC_BATCH_SIZE=<1-64>`. Leave both unset or `auto` unless you have measured the target system. CPU always runs float32, and Storyteller chooses a batch size of one for CPU and two for a GPU.

The worker health response reports its version (the release for the Docker image, the package version for a native worker), the configured device, the device in use, whether it was checked at startup, the library folders it can read, and the free space in its data folder.

## Disk space

Before each run the worker checks the free space in its data folder and fails the job with `insufficient_storage` if there is not enough. A run needs about four times the size of the selected audio, plus seven times the EPUB, plus the speech model's emissions (about 3 KB per second of audio, roughly 115 MB for a 10 hour book), plus a 512 MB margin. Stages already cached in the job folder do not count again. Publishing the result needs one more copy of the output on the library volume, which BookOrbit checks separately.

## Logs

The worker writes one line per event to its standard output, in the form `[event] [phase] key=value - message`, for example:

```text
[read_aloud.worker.stage] [end] jobId=... stage=generating_emissions durationMs=812345 tracks=24 cached=4 device=cpu - stage finished
```

Job, stage, cancellation and startup lines carry the job id and durations; STAlign's own messages appear as `[read_aloud.worker.stalign]` lines. Folder paths in messages are shortened to `<work>`, `<library>`, `<tmp>` and `<home>`. Read them with `docker compose logs read-aloud-worker`. BookOrbit also stores each job's activity (stage starts and finishes, cached stages, the model download, warnings and the failure reason) and shows it with the job.

## Jobs, review and publishing

- The entry point is Book Details, then Files, then Create read-aloud. The button is hidden when no worker is configured or the book can never qualify (no audiobook, or a single-file library). When the book cannot qualify right now, the reason is shown under the toolbar.
- The dialog picks the plain EPUB, the audio tracks in the book's own order (change it under "Change order"), and the spoken language. One job takes at most 2,000 audio files. Sentence highlighting is the default; word highlighting is under Advanced and is experimental.
- If the book already has a read-along, the dialog offers to replace it or keep both. Replace is the default when BookOrbit generated the existing one, and Keep both when it was imported, for example from Storyteller. A replacement overwrites the file in place, so reading progress, sessions and highlights tied to it are kept, and it happens only after the new output has been validated. Because the old content is gone for good, replacing needs the Delete books permission, like deleting a file does; without it the new read-along is always added as another file. The permission is checked again when the output is published, and a job whose publisher no longer has it adds a new file instead.
- Jobs run one at a time in the background and survive page navigation. The job card shows the current step, the track or chapter it is on, elapsed time, the place in the queue, and an activity log.
- A finished job shows how many sentences matched, how much of the audio was used and which chapters are not in the narration. Its chapter table stays available under Details after the work folder is removed.
- The person who started a job, and superusers, can cancel, discard, publish, retry or re-sync it. Others with access to the book see that it is running. A job can no longer be cancelled once its output is being added to the book, including after a restart interrupted that step.
- A job whose server stops under it is picked up again when the server is back, and if the worker is still running it, the server takes that run back rather than starting another. After 4 such interruptions the job fails instead, keeping its work for Retry.
- Before anything reaches the library, the server checks that the output contains a playable media overlay and reads the alignment report.
- Matching is judged on the text the narration covers, from the first chapter that clearly matched to the last. Unmatched front and back matter beyond those, such as the copyright page, contents, acknowledgments or a sample of another book, is listed as "not in the narration" and does not count against the result.
- Output with a lot of unmatched story text, or audio tracks that could not be aligned, waits for review. The review lists every chapter with its status and match rate. Chapters can be included or excluded and the alignment re-run, which reuses the earlier work and takes minutes rather than hours. The output can also be added as it is, or discarded. Unreviewed output gets a reminder after 7 days and is discarded after 14.
- A failed job keeps its work for 7 days, so Retry resumes where it stopped. "Start over" begins a new job with the same choices.
- The requester is notified when a read-along is ready, needs review, or fails, through the Read-aloud generation notification category.

Publishing copies the output into the book's folder as `<book>.readaloud.epub` (with a number added if that name is taken), staged next to its destination and renamed into place. The admin upload size limit does not apply; `READ_ALOUD_MAX_OUTPUT_BYTES` (default 20 GB) is the only cap. BookOrbit checks the library volume has room for the file first.

The source EPUB and audiobook are not modified.
