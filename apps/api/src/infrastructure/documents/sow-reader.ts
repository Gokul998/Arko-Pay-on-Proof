import mammoth from "mammoth";
import type { SourceDocument } from "@arko/shared";
import { AppError } from "../../domain/errors.ts";
import type { SourceMaterial } from "../../application/ports.ts";

const IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_TEXT = 60_000;

const byExtension: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  docx: DOCX,
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  eml: "message/rfc822",
  csv: "text/csv",
  json: "application/json",
  rtf: "application/rtf",
};

/**
 * Turns a statement of work in any common format into something Claude can read:
 * PDFs and images go to Claude natively (it reads layout, tables and scans);
 * Word, HTML, RTF and e-mail are converted to text here.
 */
export async function readSourceDocument(doc: SourceDocument): Promise<SourceMaterial> {
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = (doc.mimeType && doc.mimeType !== "application/octet-stream" ? doc.mimeType : byExtension[ext]) ?? "";
  const data = Buffer.from(doc.dataBase64, "base64");
  if (data.length === 0) throw new AppError("VALIDATION_ERROR", "The uploaded file is empty", 400);

  if (mime === "application/pdf") return { kind: "pdf", name: doc.name, data: doc.dataBase64 };
  if (IMAGE.has(mime)) return { kind: "image", name: doc.name, mediaType: mime as "image/png", data: doc.dataBase64 };
  if (mime === DOCX || ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return text(doc.name, value);
  }
  if (mime === "text/html" || ext === "html" || ext === "htm") return text(doc.name, stripHtml(data.toString("utf8")));
  if (mime === "application/rtf" || ext === "rtf") return text(doc.name, stripRtf(data.toString("utf8")));
  if (mime.startsWith("text/") || mime === "message/rfc822" || mime === "application/json" || ["txt", "md", "eml", "csv", "json"].includes(ext)) {
    return text(doc.name, data.toString("utf8"));
  }
  throw new AppError(
    "UNSUPPORTED_MEDIA_TYPE",
    `"${doc.name}" isn't a supported format. Use PDF, Word (.docx), an image/scan, text, Markdown, HTML, RTF or an e-mail (.eml).`,
    415,
  );
}

function text(name: string, value: string): SourceMaterial {
  const clean = value.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < 20) throw new AppError("VALIDATION_ERROR", `Couldn't find readable text in "${name}"`, 400);
  return { kind: "text", name, text: clean.slice(0, MAX_TEXT) };
}

const stripHtml = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");

const stripRtf = (rtf: string) =>
  rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
