import type Anthropic from "@anthropic-ai/sdk";
import type { StoredFile } from "../../application/ports.ts";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_LIKE = /^(text\/|application\/(json|xml|javascript|x-yaml))/;
const MAX_TEXT = 60_000;

/**
 * Turn stored proofs into Claude content blocks: images are seen, PDFs are read,
 * text files are inlined; everything is wrapped as untrusted evidence.
 */
export function proofBlocks(proofs: StoredFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  proofs.forEach(({ proof, data }, i) => {
    const header = `<proof index="${i + 1}" kind="${proof.kind}" name="${escape(proof.name)}"${proof.mimeType ? ` type="${proof.mimeType}"` : ""}>`;
    const parts: string[] = [header];
    if (proof.note) parts.push(`Freelancer note: ${proof.note}`);
    if (proof.url) parts.push(`Link (not fetched — treat as a claim): ${proof.url}`);

    if (data && proof.mimeType && IMAGE_TYPES.has(proof.mimeType)) {
      blocks.push({ type: "text", text: parts.join("\n") });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: proof.mimeType as "image/png", data: data.toString("base64") },
      });
      blocks.push({ type: "text", text: "</proof>" });
      return;
    }
    if (data && proof.mimeType === "application/pdf") {
      blocks.push({ type: "text", text: parts.join("\n") });
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } });
      blocks.push({ type: "text", text: "</proof>" });
      return;
    }
    if (data && proof.mimeType && TEXT_LIKE.test(proof.mimeType)) {
      parts.push(data.toString("utf8").slice(0, MAX_TEXT));
    } else if (data) {
      parts.push(`(Binary file of ${data.length} bytes, type ${proof.mimeType ?? "unknown"} — content not inspectable)`);
    }
    parts.push("</proof>");
    blocks.push({ type: "text", text: parts.join("\n") });
  });
  return blocks;
}

const escape = (s: string) => s.replace(/"/g, "'");
