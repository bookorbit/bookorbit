import { execFile } from "node:child_process";

/**
 * STAlign shells out to `ffmpeg` and `ffprobe` from the PATH and passes `ffprobe -output_format`,
 * which ffprobe 5.x rejects. Checking at startup turns that into a clear boot error instead of every
 * job failing in its first stage.
 */
export async function checkFfmpeg(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-version"], env);
  const help = await run("ffprobe", ["-hide_banner", "-h"], env);
  if (!/^-output_format\b/m.test(help)) {
    throw new Error("ffprobe is too old: STAlign needs ffmpeg and ffprobe 7 or newer (ffprobe has no -output_format option)");
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (!error) return resolve(stdout);
      const code = (error as NodeJS.ErrnoException).code;
      reject(
        new Error(
          code === "ENOENT"
            ? `${command} was not found on the PATH; install ffmpeg 7 or newer`
            : `${command} could not run (${error.message.split("\n")[0]})`,
        ),
      );
    });
  });
}
