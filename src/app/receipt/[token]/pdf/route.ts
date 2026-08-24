import { NextResponse } from "next/server";
import { resolveReceipt } from "@/lib/receipts/server";
import { receiptPdf, pdfFileName } from "@/lib/receipts/pdf";

export const dynamic = "force-dynamic";

/**
 * The receipt as a file.
 *
 * Same token as the page, so a customer who can see their receipt can
 * keep it, and nobody else can do either. Served inline: a phone opens
 * it in the PDF viewer, and "save" is then one tap in a place people
 * already know.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const receipt = await resolveReceipt(token);

  // The same nothing the page gives, for the same reason: a link that
  // is unknown, expired or revoked must be indistinguishable.
  if (!receipt) {
    return new NextResponse("This receipt is not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const pdf = await receiptPdf(receipt);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(receipt)}"`,
      // Never a shared cache: the URL is a credential.
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
