import fs from "node:fs";
export function acquirePublisher(file: string): (() => void) | null {
  const lock = file + ".publisher";
  const claim = () => {
    const descriptor = fs.openSync(lock, "wx", 0o600);
    try { fs.writeFileSync(descriptor, String(process.pid)); }
    catch (error) { fs.unlinkSync(lock); throw error; }
    finally { fs.closeSync(descriptor); }
  };
  try {
    claim();
  } catch (error: any) {
    if (error.code !== "EEXIST") return null;
    try {
      const stat = fs.lstatSync(lock);
      if (!stat.isFile()) return null;
      const pid = Number(fs.readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) return null;
      try {
        process.kill(pid, 0);
        return null;
      } catch (error: any) {
        if (error.code !== "ESRCH") return null;
      }
      if (fs.lstatSync(lock).ino !== stat.ino) return null;
      fs.unlinkSync(lock);
      claim();
    } catch {
      return null;
    }
  }
  const inode = fs.lstatSync(lock).ino;
  return () => {
    try {
      if (
        fs.lstatSync(lock).ino === inode &&
        fs.readFileSync(lock, "utf8") === String(process.pid)
      )
        fs.unlinkSync(lock);
    } catch {}
  };
}
