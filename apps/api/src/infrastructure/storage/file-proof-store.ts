import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Proof } from "@arko/shared";
import type { ProofStore, StoredFile } from "../../application/ports.ts";

/** Stores uploaded proof files on local disk, keyed by proof id. */
export class FileProofStore implements ProofStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  saveFile(proof: Proof, data: Buffer): void {
    writeFileSync(this.path(proof), data);
  }

  read(proof: Proof): StoredFile {
    const file = this.path(proof);
    return proof.kind === "file" && existsSync(file) ? { proof, data: readFileSync(file) } : { proof };
  }

  private path(proof: Proof): string {
    // Proof ids are generated server-side (no user input), so they are safe file names.
    return join(this.dir, proof.id);
  }
}
