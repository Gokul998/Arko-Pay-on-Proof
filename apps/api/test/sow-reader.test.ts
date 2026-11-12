import { describe, expect, it } from "vitest";
import { readSourceDocument } from "../src/infrastructure/documents/sow-reader.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("SOW reader", () => {
  it("passes PDFs and images to Claude natively", async () => {
    expect((await readSourceDocument({ name: "sow.pdf", mimeType: "application/pdf", dataBase64: b64("%PDF-1.7") })).kind).toBe("pdf");
    expect((await readSourceDocument({ name: "scan.jpg", mimeType: "", dataBase64: b64("jpegdata") })).kind).toBe("image");
  });

  it("converts HTML and e-mail to text", async () => {
    const html = await readSourceDocument({
      name: "order.html",
      mimeType: "text/html",
      dataBase64: b64("<h1>Work order</h1><p>Phase 1: discovery — $2,000 due on delivery of the research report.</p><script>x()</script>"),
    });
    expect(html).toMatchObject({ kind: "text" });
    expect(html.kind === "text" && html.text).toContain("Phase 1: discovery");
    expect(html.kind === "text" && html.text).not.toContain("x()");
  });

  it("rejects unsupported formats with a helpful message", async () => {
    await expect(readSourceDocument({ name: "plan.xlsx", mimeType: "application/vnd.ms-excel", dataBase64: b64("zz") })).rejects.toThrow(/supported format/);
  });
});
